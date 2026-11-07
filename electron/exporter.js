"use strict";

/**
 * Readable exports. Pure functions so they can be tested without Electron.
 */

function formatTimestamp(value) {
  if (!value) return "unknown time";
  return new Date(value).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatChatMarkdown({ chat, messages = [], exportedAt = Date.now() }) {
  const lines = [];
  lines.push(`# ${chat && chat.title ? chat.title : "Conversation"}`);
  lines.push("");
  lines.push(`- Model: ${(chat && chat.model) || "not recorded"}`);
  lines.push(`- Provider: ${(chat && chat.provider) || "not recorded"}`);
  lines.push(`- Started: ${formatTimestamp(chat && chat.created_at)}`);
  lines.push(`- Exported: ${formatTimestamp(exportedAt)}`);
  lines.push(`- Messages: ${messages.length}`);
  if (chat && chat.pinned && chat.pinned.trim()) {
    lines.push("");
    lines.push("## Pinned instructions");
    lines.push("");
    lines.push(chat.pinned.trim());
  }
  if (chat && chat.summary && chat.summary.trim()) {
    lines.push("");
    lines.push("## Summary of earlier messages");
    lines.push("");
    lines.push(chat.summary.trim());
    lines.push("");
    lines.push("_The original messages appear in full below._");
  }
  lines.push("");
  lines.push("---");

  for (const message of messages) {
    const author = message.role === "user" ? "You" : message.role === "system" ? "System" : "Assistant";
    lines.push("");
    lines.push(`### ${author} — ${formatTimestamp(message.created_at)}`);
    lines.push("");
    lines.push(String(message.content || "").trim() || "_(empty)_");
    const files = Array.isArray(message.attachments) ? message.attachments : [];
    if (files.length) {
      lines.push("");
      lines.push("**Attachments**");
      for (const file of files) {
        lines.push(`- ${file.name} (${formatBytes(file.size)})`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function formatChatJson({ chat, messages = [], exportedAt = Date.now() }) {
  return {
    title: (chat && chat.title) || "Conversation",
    provider: (chat && chat.provider) || null,
    model: (chat && chat.model) || null,
    createdAt: chat && chat.created_at ? new Date(chat.created_at).toISOString() : null,
    exportedAt: new Date(exportedAt).toISOString(),
    settings: {
      contextLength: chat && chat.num_ctx,
      maxOutput: chat && chat.num_predict,
      temperature: chat && chat.temperature,
      topP: chat && chat.top_p,
    },
    pinnedInstructions: (chat && chat.pinned) || "",
    summary: (chat && chat.summary) || "",
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.created_at ? new Date(message.created_at).toISOString() : null,
      model: message.model || null,
      attachments: (message.attachments || []).map((file) => ({
        name: file.name,
        size: file.size,
        mime: file.mime,
      })),
    })),
  };
}

function deriveTitle(content) {
  const single = String(content || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!single) return "New chat";
  return single.length > 56 ? `${single.slice(0, 53)}…` : single;
}

module.exports = { formatChatMarkdown, formatChatJson, formatTimestamp, formatBytes, deriveTitle };