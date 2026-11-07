import test from "node:test";
import assert from "node:assert/strict";
import retrievalModule from "../electron/retrieval.js";

const { rankPassages, meaningfulTerms, scorePassage } = retrievalModule;

const passages = [
  { message_id: "a", chat_id: "c1", chat_title: "Sourdough", content: "Feed the starter twice a day with rye flour.", created_at: 1000 },
  { message_id: "b", chat_id: "c1", chat_title: "Sourdough", content: "The car needs new brake pads before winter.", created_at: 2000 },
  { message_id: "c", chat_id: "c2", chat_title: "Garden", content: "Plant the tomatoes after the last frost.", created_at: 3000 },
];

test("stopwords are ignored when extracting meaningful terms", () => {
  const terms = meaningfulTerms("What is the best way to feed the starter?");
  assert.ok(terms.includes("feed"));
  assert.ok(terms.includes("starter"));
  assert.ok(!terms.includes("the"));
  assert.ok(!terms.includes("what"));
});

test("only passages that match are returned, best first", () => {
  const ranked = rankPassages({ passages, query: "how often should I feed the starter", limit: 2 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].message_id, "a");
  assert.ok(ranked[0].score > 0);
});

test("a repeated match outranks a single mention in a long passage", () => {
  const ranked = rankPassages({
    passages: [
      { message_id: "w1", chat_title: "A", content: "starter starter starter", created_at: 1 },
      {
        message_id: "w2",
        chat_title: "B",
        content:
          "a long passage about many things that mentions starter once and then continues with lots of " +
          "unrelated detail about the garden, the weather, the dog and the car",
        created_at: 2,
      },
    ],
    query: "starter",
    limit: 2,
  });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].message_id, "w1");
});

test("a query with no meaningful terms retrieves nothing", () => {
  assert.deepEqual(rankPassages({ passages, query: "what is it", limit: 5 }), []);
});

test("messages already in the live window are excluded", () => {
  const ranked = rankPassages({
    passages,
    query: "feed the starter",
    limit: 5,
    excludeMessageIds: ["a"],
  });
  assert.ok(!ranked.some((item) => item.message_id === "a"));
});

test("limit is respected and duplicates collapse", () => {
  const doubled = [...passages, { ...passages[0], message_id: "a2" }];
  const ranked = rankPassages({ passages: doubled, query: "feed starter rye", limit: 1 });
  assert.equal(ranked.length, 1);
});

test("scoring is stable for empty content", () => {
  assert.equal(scorePassage({ content: "" }, ["anything"]), 0);
  assert.equal(scorePassage(null, ["anything"]), 0);
});