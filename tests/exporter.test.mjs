import test from "node:test";
import assert from "node:assert/strict";
import exporterModule from "../electron/exporter.js";

const { formatChatMarkdown, formatChatJson, deriveTitle, formatBytes } = exporterModule;

const chat = {
  title: "Roof repair quotes",
  provider: "ollama",
  model: "llama3.1:8b",
  created_at: Date.UTC(2026, 2, 4, 1, 30),
  num_ctx: 8192,
  num_predict: 1024,
  temperature: 0.7,
  top_p: 0.9,
  pinned: "Always quote prices in Australian dollars.",
  summary: "The user has two quotes and prefers the second.",
};

const messages = [
  {
    role: "user",
    content: "I have two quotes: $4,200 and $3,850.",
    created_at: Date.UTC(2026, 2, 4, 1, 31),
    attachments: [{ name: "quote-a.pdf", size: 20480, mime: "application/pdf" }],
    id: "m1",
  },
  {
    role: "assistant",
    content: "Which one includes the flashing?",
    created_at: Date.UTC(2026, 2, 4, 1, 32),
    id: "m2",
  },
];

test("markdown export keeps both speakers, metadata and attachment names", () => {
  const markdown = formatChatMarkdown({ chat, messages, exportedAt: Date.UTC(2026, 2, 5) });
  assert.match(markdown, /# Roof repair quotes/);
  assert.match(markdown, /llama3\.1:8b/);
  assert.match(markdown, /### You/);
  assert.match(markdown, /### Assistant/);
  assert.match(markdown, /\$3,850/);
  assert.match(markdown, /quote-a\.pdf \(20 KB\)/);
  assert.match(markdown, /Always quote prices in Australian dollars/);
  assert.match(markdown, /The original messages appear in full below/);
});

test("markdown export never invents a summary that is not stored", () => {
  const markdown = formatChatMarkdown({ chat: { ...chat, summary: "" }, messages });
  assert.ok(!markdown.includes("Summary of earlier messages"));
});

test("json export is round-trippable and keeps ISO timestamps", () => {
  const payload = formatChatJson({ chat, messages, exportedAt: Date.UTC(2026, 2, 5) });
  const reparsed = JSON.parse(JSON.stringify(payload));
  assert.equal(reparsed.messages.length, 2);
  assert.equal(reparsed.messages[0].createdAt, "2026-03-04T01:31:00.000Z");
  assert.deepEqual(reparsed.messages[0].attachments, [{ name: "quote-a.pdf", size: 20480, mime: "application/pdf" }]);
});

test("titles are derived from the first message and stay short", () => {
  assert.equal(deriveTitle("  Hello\n\n there  "), "Hello there");
  assert.equal(deriveTitle(""), "New chat");
  assert.ok(deriveTitle("word ".repeat(40)).length <= 56);
});

test("byte sizes read for a person", () => {
  assert.equal(formatBytes(900), "900 B");
  assert.equal(formatBytes(20480), "20 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});