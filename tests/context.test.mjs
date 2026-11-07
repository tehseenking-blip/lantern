import test from "node:test";
import assert from "node:assert/strict";
import contextModule from "../electron/context.js";

const { estimateTokens, resolvePreferences, buildContext } = contextModule;

const preferences = [
  {
    id: "p1",
    kind: "preference",
    title: "Length",
    content: "Answer in no more than three paragraphs.",
    enabled: 1,
    updated_at: 1000,
  },
  {
    id: "p2",
    kind: "preference",
    title: "Length",
    content: "Ignore the three-paragraph rule; write as long as the question needs.",
    enabled: 1,
    updated_at: 2000,
  },
  {
    id: "p3",
    kind: "preference",
    title: "Tables",
    content: "Use tables when comparing options.",
    enabled: 1,
    updated_at: 1500,
  },
  {
    id: "p4",
    kind: "preference",
    title: "Old habit",
    content: "Always sign off with 'cheers'.",
    enabled: 0,
    updated_at: 2500,
  },
];

test("estimateTokens grows with length and is never zero for text", () => {
  assert.ok(estimateTokens("hello") > 0);
  assert.ok(estimateTokens("a".repeat(1000)) > estimateTokens("a".repeat(100)));
  assert.equal(estimateTokens(""), 0);
});

test("newer preference with the same label overrides the older one", () => {
  const { active, superseded } = resolvePreferences(preferences);
  const lengths = active.filter((item) => item.title === "Length");
  assert.equal(lengths.length, 1);
  assert.equal(lengths[0].id, "p2");
  assert.equal(superseded.length, 1);
  assert.equal(superseded[0].id, "p1");
  assert.equal(superseded[0].supersededBy, "p2");
});

test("disabled preferences are never applied", () => {
  const { active } = resolvePreferences(preferences);
  assert.ok(!active.some((item) => item.id === "p4"));
  assert.ok(active.some((item) => item.id === "p3"));
});

test("context includes preferences, facts, pinned instructions and summary", () => {
  const built = buildContext({
    assistantInstructions: "You are a careful assistant.",
    pinned: "Never invent citations.",
    summary: "The user is renovating a 1970s house in Canberra.",
    memories: [
      ...preferences,
      { id: "f1", kind: "fact", content: "The user's dog is called Wombat.", enabled: 1, updated_at: 1200 },
    ],
    messages: [{ id: "m1", role: "user", content: "What should I do first?" }],
    budget: 4096,
    reserveForReply: 512,
    chatId: "c1",
  });

  assert.match(built.systemPrompt, /careful assistant/);
  assert.match(built.systemPrompt, /Never invent citations/);
  assert.match(built.systemPrompt, /1970s house/);
  assert.match(built.systemPrompt, /Wombat/);
  assert.match(built.systemPrompt, /as long as the question needs/);
  assert.ok(
    !built.systemPrompt.includes("Answer in no more than three paragraphs"),
    "the superseded preference must not be sent",
  );
  assert.equal(built.usage.summarised, true);
  assert.equal(built.usage.retrievedCount, 0);
});

test("the oldest messages are dropped first and the newest is always kept", () => {
  const messages = Array.from({ length: 40 }, (_value, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message number ${index} `.repeat(20),
  }));

  const built = buildContext({ messages, budget: 1200, reserveForReply: 300 });

  assert.ok(built.messages.length > 0);
  assert.ok(built.messages.length < messages.length, "some history must be dropped to fit");
  assert.equal(built.messages[built.messages.length - 1].messageId, "m39");
  assert.ok(built.usage.droppedCount > 0);
  assert.ok(built.usage.total <= built.usage.available);
});

test("a single huge message is kept rather than silently replaced with nothing", () => {
  const built = buildContext({
    messages: [{ id: "only", role: "user", content: "x".repeat(50000) }],
    budget: 2048,
    reserveForReply: 512,
  });
  assert.equal(built.messages.length, 1);
  assert.equal(built.messages[0].messageId, "only");
});

test("attachment text is included for the model but not invented when absent", () => {
  const built = buildContext({
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Summarise this.",
        attachments: [{ name: "notes.md", text: "The shed needs a new roof." }],
      },
    ],
    budget: 4096,
    reserveForReply: 256,
  });
  assert.match(built.messages[0].content, /\[Attachment: notes\.md\]/);
  assert.match(built.messages[0].content, /shed needs a new roof/);
});