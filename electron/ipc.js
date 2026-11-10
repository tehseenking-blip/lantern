"use strict";

const fs = require("fs/promises");
const path = require("path");
const { app, ipcMain, safeStorage } = require("electron");

const db = require("./db");
const llm = require("./llm");
const { extractAttachment } = require("./attachments");
const { buildContext, estimateTokens } = require("./context");
const { rankPassages } = require("./retrieval");
const { formatChatMarkdown, formatChatJson, deriveTitle } = require("./exporter");

const streams = new Map();
let streamSeq = 0;
let deps = {};

const SUMMARY_PROMPT =
  "Summarise the conversation extract below into compact factual notes for future reference. Keep every name, " +
  "number, date, decision, preference, constraint and open question. Do not invent anything, do not add " +
  "commentary, and write in the language the conversation uses.\n\n";

function registerIpc(injected) {
  deps = injected;
  for (const [channel, handler] of Object.entries(HANDLERS)) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await handler(event, payload);
      } catch (error) {
        // Errors travel to the interface as a readable message, never as a stack.
        return { __error: String((error && error.message) || error) };
      }
    });
  }
}

function sendEvent(payload) {
  const win = deps.getWindow && deps.getWindow();
  if (win && !win.isDestroyed()) win.webContents.send("stream:event", payload);
}

function publicSettings() {
  const settings = db.getSettings();
  const secrets = settings.secrets || {};
  const { secrets: _omit, ...rest } = settings;
  return { ...rest, secretProviders: Object.keys(secrets) };
}

function apiKeyFor(providerId) {
  const settings = db.getSettings();
  const stored = (settings.secrets || {})[providerId];
  if (!stored) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch (_error) {
    return null;
  }
}

function providerFor(settings, providerId) {
  const list = Array.isArray(settings.providers) ? settings.providers : [];
  const found = list.find((item) => item.id === providerId);
  if (!found) throw new Error("This conversation’s local provider is unavailable. Choose its server in Model settings; Lantern will not switch providers automatically.");
  return found;
}

// Never pass a stored secret to an edited/unsaved server address.
function discoveryTarget(config = {}) {
  const settings = db.getSettings();
  const saved = settings.providers.find((item) => item.id === config.providerId);
  const kind = config.kind || saved?.kind || "ollama";
  const baseUrl = config.baseUrl || saved?.baseUrl || "";
  const apiKey = saved ? apiKeyFor(saved.id) : null;
  const root = kind === "ollama" ? llm.normaliseBase : llm.openAiRoot;
  if (apiKey && (kind !== saved.kind || root(baseUrl) !== root(saved.baseUrl))) {
    throw new Error("Save this address before testing with its stored access key.");
  }
  return { kind, baseUrl, apiKey };
}

function requireChat(chatId) {
  const chat = db.getChat(chatId);
  if (!chat) throw new Error("That conversation is no longer in the database.");
  return chat;
}

function stripMessage(message) {
  if (!message) return null;
  return {
    ...message,
    attachments: (message.attachments || []).map((file) => ({
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
    })),
  };
}

function requestMessages(systemPrompt, messages, instruction) {
  const system = instruction ? `${systemPrompt}\n\n${instruction}` : systemPrompt;
  const output = [];
  if (system && system.trim()) output.push({ role: "system", content: system });
  for (const message of messages) {
    if (!message.content || !message.content.trim()) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    output.push({ role: message.role, content: message.content });
  }
  return output;
}

/* ------------------------------------------------------------- generation */

async function summariseOlder({ chat, providerConfig, older, previousSummary }) {
  const transcript =
    (previousSummary ? `Existing summary:\n${previousSummary}\n\n` : "") +
    older.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n\n");
  const result = await llm.streamChat({
    kind: providerConfig.kind,
    baseUrl: providerConfig.baseUrl,
    model: chat.model,
    apiKey: apiKeyFor(providerConfig.id),
    messages: [
      { role: "system", content: "You compress conversations into precise notes." },
      { role: "user", content: `${SUMMARY_PROMPT}${transcript}` },
    ],
    options: {
      num_ctx: chat.num_ctx,
      num_predict: Math.min(640, chat.num_predict || 640),
      temperature: 0.2,
      top_p: 0.9,
    },
    onDelta: () => {},
  });
  return String(result.text || "").trim();
}

async function maybeSummarise({ chat, messages, settings, providerConfig }) {
  const threshold = (chat.num_ctx || 8192) * (settings.summariseAt || 0.65);
  const total = messages.reduce((sum, message) => sum + (message.token_estimate || estimateTokens(message.content)), 0);
  if (total < threshold) return null;
  const cutoff = Math.max(4, messages.length - 6);
  const older = messages.slice(0, cutoff);
  if (older.length < 4) return null;
  try {
    const summary = await summariseOlder({
      chat,
      providerConfig,
      older,
      previousSummary: chat.summary || "",
    });
    if (!summary) return null;
    const upto = older[older.length - 1].id;
    db.updateChat(chat.id, { summary, summary_upto: upto });
    return { summary, upto, count: older.length };
  } catch (error) {
    sendEvent({
      type: "notice",
      chatId: chat.id,
      text:
        `Summarising did not complete (${error.message}). Nothing was lost — the full messages were used instead. ` +
        "Summaries only shape what the model sees now; your stored history is untouched.",
    });
    return null;
  }
}

async function prepareTurn({ chat, settings, allowSummarise = true }) {
  const providerConfig = providerFor(settings, chat.provider);
  const allMessages = db.listMessages(chat.id);
  let currentChat = chat;
  let notice = null;

  const summarised = allowSummarise
    ? await maybeSummarise({ chat: currentChat, messages: allMessages, settings, providerConfig })
    : null;
  if (summarised) {
    currentChat = db.getChat(chat.id);
    notice =
      `This conversation is longer than the model's ${currentChat.num_ctx.toLocaleString("en-AU")}-token window, so the ` +
      `first ${summarised.count} messages were summarised to make room. All original messages are still stored and ` +
      "can be exported or retrieved in full.";
  }

  let history = allMessages;
  if (currentChat.summary_upto) {
    const index = allMessages.findIndex((message) => message.id === currentChat.summary_upto);
    if (index >= 0) history = allMessages.slice(index + 1);
  }

  const recentIds = history.slice(-12).map((message) => message.id);
  const lastUser = [...history].reverse().find((message) => message.role === "user");
  const retrieval = settings.retrieval || { enabled: true, limit: 6, otherChats: false };
  let retrieved = [];
  if (retrieval.enabled !== false && lastUser) {
    const passages = db.candidatePassages({
      chatId: currentChat.id,
      otherChats: Boolean(retrieval.otherChats),
      projectId: currentChat.project_id,
    });
    retrieved = rankPassages({
      passages,
      query: lastUser.content,
      limit: retrieval.limit || 6,
      excludeMessageIds: recentIds,
    });
  }

  const projects = db.listProjects();
  const project = currentChat.project_id ? projects.find((item) => item.id === currentChat.project_id) : null;

  const built = buildContext({
    assistantInstructions: settings.assistantInstructions || "",
    projectInstructions: project ? project.instructions : "",
    chatInstructions: currentChat.instructions || "",
    pinned: currentChat.pinned || "",
    summary: currentChat.summary || "",
    memories: db.listMemories({}),
    retrieved,
    messages: history,
    budget: currentChat.num_ctx,
    reserveForReply: currentChat.num_predict,
    chatId: currentChat.id,
  });

  return { chat: currentChat, built, providerConfig, notice };
}

function startGeneration({ chat, settings, instruction = null }) {
  return prepareTurn({ chat, settings }).then((prepared) => {
    const messages = requestMessages(prepared.built.systemPrompt, prepared.built.messages, instruction);
    const assistant = db.addMessage({
      chat_id: chat.id,
      role: "assistant",
      content: "",
      model: chat.model,
      settings: {
        num_ctx: chat.num_ctx,
        num_predict: chat.num_predict,
        temperature: chat.temperature,
        top_p: chat.top_p,
      },
      token_estimate: 0,
    });

    const streamId = `s${(streamSeq += 1)}`;
    const controller = new AbortController();
    streams.set(streamId, { controller, assistantId: assistant.id, chatId: chat.id });

    const streamPayload = {
      streamId,
      chatId: chat.id,
      assistantMessage: stripMessage(assistant),
      usage: prepared.built.usage,
      notice: prepared.notice,
      supersededPreferences: prepared.built.supersededPreferences.map((item) => item.title || item.content),
    };

    void runGeneration({
      streamId,
      chat,
      providerConfig: prepared.providerConfig,
      messages,
      controller,
      assistantId: assistant.id,
    });

    return streamPayload;
  });
}

async function runGeneration({ streamId, chat, providerConfig, messages, controller, assistantId }) {
  let text = "";
  try {
    const result = await llm.streamChat({
      kind: providerConfig.kind,
      baseUrl: providerConfig.baseUrl,
      model: chat.model,
      apiKey: apiKeyFor(providerConfig.id),
      messages,
      options: {
        num_ctx: chat.num_ctx,
        num_predict: chat.num_predict,
        temperature: chat.temperature,
        top_p: chat.top_p,
      },
      signal: controller.signal,
      onDelta: (delta) => {
        text += delta;
        sendEvent({ streamId, type: "delta", delta });
      },
    });

    const finalText = String(result.text || text);
    db.updateMessage(assistantId, { content: finalText, token_estimate: estimateTokens(finalText) });
    sendEvent({
      streamId,
      type: "done",
      message: stripMessage(db.getMessage(assistantId)),
      stopped: Boolean(result.stopped),
      serverUsage: result.usage,
    });
  } catch (error) {
    if (text.trim()) {
      db.updateMessage(assistantId, { content: text, token_estimate: estimateTokens(text) });
      sendEvent({
        streamId,
        type: "error",
        assistantId,
        error: String(error.message || error),
        message: stripMessage(db.getMessage(assistantId)),
        partial: true,
      });
    } else {
      db.removeMessage(assistantId);
      sendEvent({ streamId, type: "error", assistantId, error: String(error.message || error), partial: false });
    }
  } finally {
    streams.delete(streamId);
    db.touchChat(chat.id);
  }
}

/* ---------------------------------------------------------------- handlers */

const HANDLERS = {
  "app:info": () => ({
    name: "Lantern",
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dataPath: app.getPath("userData"),
    encryptedStore: safeStorage.isEncryptionAvailable(),
  }),

  "app:openDataFolder": () => deps.openPath(app.getPath("userData")),

  "settings:get": () => publicSettings(),

  "settings:update": async (_event, patch = {}) => {
    const current = db.getSettings();
    const secrets = { ...(current.secrets || {}) };
    let secretsChanged = false;

    if (patch.setSecret && patch.setSecret.providerId && patch.setSecret.value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          "Windows credential storage is unavailable, so the key was not saved. Lantern will not keep it in plain text.",
        );
      }
      secrets[patch.setSecret.providerId] = safeStorage.encryptString(String(patch.setSecret.value)).toString("base64");
      secretsChanged = true;
    }
    if (patch.clearSecret && patch.clearSecret.providerId) {
      delete secrets[patch.clearSecret.providerId];
      secretsChanged = true;
    }

    const next = { ...patch };
    delete next.secrets;
    delete next.secretProviders;
    if (next.providers) {
      if (!Array.isArray(next.providers)) throw new Error("Providers must be a list.");
      const ids = new Set();
      for (const provider of next.providers) {
        if (!provider || typeof provider.id !== "string" || !provider.id || ids.has(provider.id)) throw new Error("Each local provider must have a unique ID.");
        ids.add(provider.id);
        if (!["ollama", "openai", "colibri"].includes(provider.kind)) throw new Error("Unsupported local provider protocol.");
        llm.normaliseBase(provider.baseUrl);
      }
    }
    delete next.setSecret;
    delete next.clearSecret;
    if (secretsChanged) next.secrets = secrets;
    db.updateSettings(next);
    return publicSettings();
  },

  "providers:test": async (_event, config = {}) => {
    try {
      const models = await llm.discoverModels(discoveryTarget(config));
      return { ok: true, count: models.length, models: models.slice(0, 40) };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  },

  "providers:models": async (_event, config = {}) => {
    try {
      const models = await llm.discoverModels(discoveryTarget(config));
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: String(error.message || error), models: [] };
    }
  },

  "providers:generateTest": async (_event, config = {}) => {
    try {
      const target = discoveryTarget(config);
      const models = await llm.discoverModels(target);
      const model = config.model || models[0]?.id;
      if (!model || !models.some((item) => item.id === model)) throw new Error("No matching model is loaded. Start Colibri with a model, then Refresh.");
      const started = Date.now();
      const result = await llm.streamChat({
        ...target, model,
        messages: [{ role: "user", content: "Reply with the words: Lantern local connection works." }],
        options: { num_predict: 64, temperature: 0, enable_thinking: false },
        signal: AbortSignal.timeout(180000),
      });
      return { ok: true, model, text: result.text.slice(0, 400), elapsedMs: Date.now() - started, usage: result.usage };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  },

  "chats:list": (_event, query = {}) => db.listChats(query || {}),

  "chats:get": (_event, chatId) => db.getChat(chatId),

  "chats:create": (_event, payload = {}) => {
    const settings = db.getSettings();
    const chat = db.createChat({
      projectId: payload.projectId || null,
      provider: settings.activeProvider || "ollama",
      model: settings.lastModel || "",
    });
    db.updateSettings({ lastChatId: chat.id });
    return chat;
  },

  "chats:update": (_event, { chatId, patch } = {}) => {
    const chat = db.updateChat(chatId, patch || {});
    if (patch && patch.model) db.updateSettings({ lastModel: patch.model });
    return chat;
  },

  "chats:remove": (_event, chatId) => {
    db.removeChat(chatId);
    return { ok: true, chatId };
  },

  "chats:export": async (_event, { chatId, format = "markdown" } = {}) => {
    const chat = requireChat(chatId);
    const messages = db.listMessages(chatId);
    const safeName = String(chat.title || "conversation").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
    const extension = format === "json" ? "json" : "md";
    const choice = await deps.showSaveDialog({
      title: "Export conversation",
      defaultPath: path.join(app.getPath("documents"), `${safeName}.${extension}`),
      filters: [{ name: extension === "json" ? "JSON" : "Markdown", extensions: [extension] }],
    });
    if (choice.canceled || !choice.filePath) return { saved: false };
    const body =
      format === "json"
        ? JSON.stringify(formatChatJson({ chat, messages }), null, 2)
        : formatChatMarkdown({ chat, messages });
    await fs.writeFile(choice.filePath, body, "utf8");
    return { saved: true, path: choice.filePath };
  },

  "projects:list": () => db.listProjects(),
  "projects:create": (_event, payload) => db.createProject(payload || {}),
  "projects:update": (_event, { projectId, patch } = {}) => db.updateProject(projectId, patch || {}),
  "projects:remove": (_event, projectId) => db.removeProject(projectId),

  "messages:list": (_event, chatId) => db.listMessages(chatId).map(stripMessage),

  // Read-only: what would be sent right now, without running a summary.
  "messages:usage": async (_event, chatId) => {
    const chat = requireChat(chatId);
    const prepared = await prepareTurn({ chat, settings: db.getSettings(), allowSummarise: false });
    return prepared.built.usage;
  },

  "messages:send": async (_event, { chatId, content, attachments } = {}) => {
    const chat = requireChat(chatId);
    const trimmed = String(content || "").trim();
    const files = Array.isArray(attachments) ? attachments : [];
    if (!trimmed && !files.length) throw new Error("Write something, or attach a file, before sending.");
    if (!chat.model) throw new Error("Choose a model for this conversation first — nothing was sent anywhere.");

    const userMessage = db.addMessage({
      chat_id: chatId,
      role: "user",
      content: trimmed,
      token_estimate: estimateTokens(trimmed),
      attachments: files,
    });
    if (!chat.title || chat.title === "New chat") db.updateChat(chatId, { title: deriveTitle(trimmed || files[0].name) });

    const settings = db.getSettings();
    const stream = await startGeneration({ chat: db.getChat(chatId), settings });
    return { userMessage: stripMessage(userMessage), ...stream };
  },

  "messages:stop": (_event, streamId) => {
    const entry = streams.get(streamId);
    if (!entry) return { ok: false, reason: "Nothing is streaming under that id." };
    entry.controller.abort();
    return { ok: true };
  },

  "messages:regenerate": async (_event, chatId) => {
    const chat = requireChat(chatId);
    const messages = db.listMessages(chatId);
    const last = messages[messages.length - 1];
    if (!last) throw new Error("There is nothing to regenerate yet.");
    if (last.role === "assistant") db.removeMessage(last.id);
    const settings = db.getSettings();
    return startGeneration({ chat: db.getChat(chatId), settings });
  },

  "messages:continue": async (_event, chatId) => {
    const chat = requireChat(chatId);
    const messages = db.listMessages(chatId);
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") throw new Error("There is no answer to continue yet.");
    const settings = db.getSettings();
    return startGeneration({
      chat,
      settings,
      instruction:
        "Continue the previous answer from exactly where it stopped. Do not repeat any text already written, " +
        "do not restate the question, and do not start with a greeting or an apology.",
    });
  },

  "messages:edit": async (_event, { messageId, content } = {}) => {
    const message = db.getMessage(messageId);
    if (!message) throw new Error("That message no longer exists.");
    const text = String(content || "");
    db.updateMessage(messageId, { content: text, token_estimate: estimateTokens(text), edited_at: Date.now() });
    db.removeMessagesAfter(message.chat_id, message.created_at);
    const settings = db.getSettings();
    return startGeneration({ chat: requireChat(message.chat_id), settings });
  },

  "messages:setContent": (_event, { messageId, content } = {}) => {
    const text = String(content || "");
    return stripMessage(
      db.updateMessage(messageId, { content: text, token_estimate: estimateTokens(text), edited_at: Date.now() }),
    );
  },

  "messages:remove": (_event, messageId) => {
    db.removeMessage(messageId);
    return { ok: true };
  },

  "messages:summarise": async (_event, chatId) => {
    const chat = requireChat(chatId);
    const settings = db.getSettings();
    const providerConfig = providerFor(settings, chat.provider);
    const messages = db.listMessages(chatId);
    const cutoff = Math.max(2, messages.length - 4);
    const older = messages.slice(0, cutoff);
    if (older.length < 2) throw new Error("There is not enough conversation to summarise yet.");
    const summary = await summariseOlder({ chat, providerConfig, older, previousSummary: chat.summary || "" });
    if (!summary) throw new Error("The model returned an empty summary.");
    db.updateChat(chat.id, { summary, summary_upto: older[older.length - 1].id });
    return { summary, count: older.length };
  },

  "memories:list": (_event, query) => db.listMemories(query || {}),
  "memories:create": (_event, payload) => db.createMemory(payload || {}),
  "memories:update": (_event, { memoryId, patch } = {}) => db.updateMemory(memoryId, patch || {}),
  "memories:remove": (_event, memoryId) => db.removeMemory(memoryId),

  "files:pick": async () => {
    const choice = await deps.showOpenDialog({
      title: "Attach files",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Readable files", extensions: ["txt", "md", "csv", "json", "pdf", "docx", "log", "yml", "yaml"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (choice.canceled || !choice.filePaths.length) return { files: [], errors: [] };
    const files = [];
    const errors = [];
    for (const filePath of choice.filePaths) {
      try {
        files.push(await extractAttachment(filePath));
      } catch (error) {
        errors.push({ name: path.basename(filePath), error: String(error.message || error) });
      }
    }
    return { files, errors };
  },

  "data:backup": async () => {
    const choice = await deps.showSaveDialog({
      title: "Back up everything",
      defaultPath: path.join(
        app.getPath("documents"),
        `lantern-backup-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: "Lantern backup", extensions: ["json"] }],
    });
    if (choice.canceled || !choice.filePath) return { saved: false };
    const payload = db.dumpAll();
    await fs.writeFile(choice.filePath, JSON.stringify(payload, null, 2), "utf8");
    return { saved: true, path: choice.filePath, chats: payload.tables.chats.length };
  },

  "data:restore": async () => {
    const choice = await deps.showOpenDialog({
      title: "Restore from a Lantern backup",
      properties: ["openFile"],
      filters: [{ name: "Lantern backup", extensions: ["json"] }],
    });
    if (choice.canceled || !choice.filePaths.length) return { restored: false };
    const raw = await fs.readFile(choice.filePaths[0], "utf8");
    const parsed = JSON.parse(raw);
    const confirm = await deps.showMessage({
      type: "warning",
      buttons: ["Cancel", "Replace everything"],
      defaultId: 0,
      cancelId: 0,
      title: "Restore backup",
      message: "This replaces all current chats, projects, memories and settings with the backup's contents.",
      detail: `Backup created: ${parsed.exportedAt || "unknown"}\nChats in backup: ${
        parsed.tables && parsed.tables.chats ? parsed.tables.chats.length : 0
      }`,
    });
    if (confirm.response !== 1) return { restored: false };
    const result = db.replaceAll(parsed);
    return { restored: true, ...result };
  },

  "data:search": (_event, query) => db.searchMessages(query, 40),

  "data:clearAll": async () => {
    const confirm = await deps.showMessage({
      type: "warning",
      buttons: ["Cancel", "Delete everything"],
      defaultId: 0,
      cancelId: 0,
      title: "Delete all local data",
      message: "Every chat, attachment, project and saved memory will be deleted from this computer.",
      detail: "This cannot be undone. Take a backup first if you might want any of it.",
    });
    if (confirm.response !== 1) return { cleared: false };
    db.clearAll();
    return { cleared: true };
  },
};

module.exports = { registerIpc };