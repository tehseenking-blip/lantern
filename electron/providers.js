"use strict";

// This is a client integration, not a bundled engine or a model downloader.
const COLIBRI = Object.freeze({
  id: "colibri", label: "Colibri", kind: "colibri", baseUrl: "http://127.0.0.1:8000/v1",
});
const DEFAULT_PROVIDERS = Object.freeze([
  Object.freeze({ id: "ollama", label: "Ollama", kind: "ollama", baseUrl: "http://127.0.0.1:11434" }),
  Object.freeze({ id: "lmstudio", label: "LM Studio", kind: "openai", baseUrl: "http://127.0.0.1:1234" }),
  COLIBRI,
]);
const COLIBRI_REVISION = "0a5504a1dc64f86fcd0fe7db298b0448c730e7e6";

/** Add the new provider without resetting saved addresses, secrets or chat choices. */
function withColibri(providers) {
  const existing = Array.isArray(providers) ? providers : DEFAULT_PROVIDERS;
  const result = existing.filter((item) => item && typeof item === "object").map((item) => ({ ...item }));
  if (!result.some((item) => item.id === COLIBRI.id)) result.push({ ...COLIBRI });
  return result;
}

module.exports = { COLIBRI, COLIBRI_REVISION, DEFAULT_PROVIDERS, withColibri };
