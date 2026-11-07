"use strict";

/**
 * Pure context assembly. No I/O, no Electron, no database: everything this
 * module needs arrives as arguments, which is what makes it testable.
 *
 * Two separate ideas are kept apart on purpose:
 *   - stored history: everything ever said, kept forever in SQLite
 *   - model context: the slice that fits in this model's window right now
 */

const CHARS_PER_TOKEN = 3.6;
const MESSAGE_OVERHEAD = 4;
const ATTACHMENT_CHAR_LIMIT = 8000;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / CHARS_PER_TOKEN) + MESSAGE_OVERHEAD;
}

/**
 * Preferences are applied newest-first. When two share a label the newer one
 * wins outright; the older is reported as superseded so the interface can say
 * so rather than pretending both are active.
 */
function resolvePreferences(memories) {
  const preferences = (memories || []).filter((item) => item.enabled && item.kind === "preference");
  const sorted = [...preferences].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const chosen = [];
  const superseded = [];
  const seen = new Map();
  for (const item of sorted) {
    const key = String(item.title || item.content || "")
      .trim()
      .toLowerCase();
    if (seen.has(key)) {
      superseded.push({ ...item, supersededBy: seen.get(key).id });
      continue;
    }
    seen.set(key, item);
    chosen.push(item);
  }
  return { active: chosen, superseded };
}

function renderMessageContent(message) {
  let text = String(message.content || "");
  const files = Array.isArray(message.attachments) ? message.attachments : [];
  for (const file of files) {
    const body = String(file.text || "").slice(0, ATTACHMENT_CHAR_LIMIT);
    if (!body.trim()) continue;
    text += `\n\n[Attachment: ${file.name}]\n${body}`;
  }
  return text;
}

function buildContext(input) {
  const {
    assistantInstructions = "",
    projectInstructions = "",
    chatInstructions = "",
    pinned = "",
    summary = "",
    memories = [],
    retrieved = [],
    messages = [],
    budget = 8192,
    reserveForReply = 0,
    chatId = null,
  } = input || {};

  const { active: preferences, superseded } = resolvePreferences(memories);
  const facts = memories.filter(
    (item) => item.enabled && item.kind === "fact" && (!item.chat_id || item.chat_id === chatId),
  );
  const details = memories.filter((item) => item.enabled && item.kind === "detail" && item.chat_id === chatId);

  const sections = [];
  if (String(assistantInstructions).trim()) sections.push(String(assistantInstructions).trim());
  if (String(projectInstructions).trim()) {
    sections.push(`Project instructions:\n${String(projectInstructions).trim()}`);
  }
  if (String(chatInstructions).trim()) {
    sections.push(`Instructions for this conversation:\n${String(chatInstructions).trim()}`);
  }
  if (preferences.length) {
    sections.push(
      "Saved preferences, newest first. If two conflict, the newer one wins. " +
        "If the user's latest message contradicts a preference, follow the latest message.\n" +
        preferences.map((item) => `- ${item.content}`).join("\n"),
    );
  }
  if (facts.length) {
    sections.push(
      "Facts the user asked you to remember:\n" + facts.map((item) => `- ${item.content}`).join("\n"),
    );
  }
  if (details.length) {
    sections.push(
      "Saved details for this conversation:\n" + details.map((item) => `- ${item.content}`).join("\n"),
    );
  }
  if (String(summary).trim()) {
    sections.push(
      "Earlier in this conversation, summarised. The original messages are still stored in full, " +
        "and exact wording can be retrieved if it matters:\n" +
        String(summary).trim(),
    );
  }
  if (retrieved.length) {
    sections.push(
      "Passages retrieved from this user's own earlier conversations. Use them only when relevant, " +
        "and say so if they are out of date.\n\n" +
        retrieved
          .map(
            (item) =>
              `--- from "${item.chat_title || "an earlier chat"}", ${new Date(item.created_at).toISOString().slice(0, 10)} ---\n${String(item.content).slice(0, 2000)}`,
          )
          .join("\n\n"),
    );
  }
  if (String(pinned).trim()) {
    sections.push(`Pinned instructions. These always apply:\n${String(pinned).trim()}`);
  }

  const systemPrompt = sections.join("\n\n");
  const systemTokens = estimateTokens(systemPrompt);
  const available = Math.max(512, budget - Math.max(0, reserveForReply));
  const availableForMessages = Math.max(256, available - systemTokens);

  const included = [];
  let messageTokens = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const content = renderMessageContent(message);
    const cost = estimateTokens(content);
    if (included.length > 0 && messageTokens + cost > availableForMessages) break;
    included.unshift({ role: message.role, content, messageId: message.id, created_at: message.created_at });
    messageTokens += cost;
  }
  const droppedCount = messages.length - included.length;

  const usage = {
    budget,
    reserveForReply,
    available,
    system: systemTokens,
    recent: messageTokens,
    total: systemTokens + messageTokens,
    preferenceCount: preferences.length,
    supersededCount: superseded.length,
    factCount: facts.length,
    detailCount: details.length,
    retrievedCount: retrieved.length,
    summarised: Boolean(String(summary).trim()),
    droppedCount,
    percentUsed: Math.min(100, Math.round(((systemTokens + messageTokens) / Math.max(1, budget)) * 100)),
  };

  return {
    systemPrompt,
    messages: included,
    usage,
    supersededPreferences: superseded,
  };
}

module.exports = {
  CHARS_PER_TOKEN,
  estimateTokens,
  resolvePreferences,
  renderMessageContent,
  buildContext,
};