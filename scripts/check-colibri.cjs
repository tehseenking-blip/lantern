"use strict";
// Opt-in real-server smoke test. Never invoked by the default offline unit suite.
const { discoverModels, streamChat } = require("../electron/llm");
(async () => {
  const baseUrl = process.env.COLIBRI_BASE_URL || "http://127.0.0.1:8000/v1";
  const apiKey = process.env.COLI_API_KEY || null;
  const models = await discoverModels({ kind: "colibri", baseUrl, apiKey });
  const model = process.env.COLIBRI_MODEL || models[0]?.id;
  if (!model || !models.some((item) => item.id === model)) throw new Error("No matching loaded model was discovered.");
  const start = performance.now();
  let firstTokenMs = null;
  const result = await streamChat({
    kind: "colibri", baseUrl, apiKey, model,
    messages: [{ role: "user", content: "Reply with one short sentence confirming that local chat works." }],
    options: { num_predict: 96, temperature: 0, enable_thinking: false },
    signal: AbortSignal.timeout(300000),
    onDelta() { firstTokenMs ??= Math.round(performance.now() - start); },
  });
  console.log(JSON.stringify({ ok: true, model, firstTokenMs, elapsedMs: Math.round(performance.now() - start), usage: result.usage, finishReason: result.finishReason, answer: result.text }, null, 2));
})().catch((error) => { console.error(`Colibri smoke test failed: ${error.message}`); process.exitCode = 1; });
