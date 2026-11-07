"use strict";

/**
 * Talks to local inference servers only. There is deliberately no cloud
 * provider in this file: if the configured server is unreachable, the request
 * fails loudly rather than falling back to anything remote.
 */

const DISCOVERY_TIMEOUT_MS = 8000;

function normaliseBase(baseUrl) {
  const value = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!value) throw new Error("No server address is set for this provider.");
  return value;
}

function openAiRoot(baseUrl) {
  const base = normaliseBase(baseUrl);
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function networkError(error, url) {
  const message = String((error && error.message) || error);
  if (error && error.name === "AbortError") return new Error("Stopped.");
  if (/ECONNREFUSED|fetch failed|Failed to fetch|ECONNRESET|ENOTFOUND|EHOSTUNREACH|socket hang up/i.test(message)) {
    return new Error(
      `Nothing is listening at ${url}. Start the model server, or correct the address in Settings. ` +
        "Lantern did not fall back to any online service.",
    );
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return new Error(`${url} did not answer in time. The model server may still be loading the model.`);
  }
  return new Error(`Could not reach ${url}: ${message}`);
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(error, url);
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 400);
    } catch (_error) {
      detail = "";
    }
    if (response.status === 404) {
      throw new Error(
        `${url} answered 404. The address is reachable but the endpoint is wrong` +
          (detail ? ` (${detail})` : "."),
      );
    }
    throw new Error(`${url} answered ${response.status}. ${detail}`.trim());
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${url} sent something that is not valid JSON.`);
  }
}

async function discoverModels({ kind, baseUrl }) {
  if (kind === "ollama") {
    const base = normaliseBase(baseUrl);
    const payload = await requestJson(`${base}/api/tags`);
    const models = Array.isArray(payload.models) ? payload.models : [];
    return models.map((model) => ({
      id: model.name,
      label: model.name,
      size: model.size || 0,
      family: (model.details && model.details.family) || "",
      parameterSize: (model.details && model.details.parameter_size) || "",
    }));
  }

  const root = openAiRoot(baseUrl);
  const payload = await requestJson(`${root}/models`);
  const models = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return models.map((model) => ({
    id: model.id,
    label: model.id,
    size: 0,
    family: "",
    parameterSize: "",
  }));
}

function buildOllamaBody({ model, messages, options }) {
  const body = { model, messages, stream: true, options: {} };
  if (Number.isFinite(options.num_ctx)) body.options.num_ctx = options.num_ctx;
  if (Number.isFinite(options.num_predict)) body.options.num_predict = options.num_predict;
  if (Number.isFinite(options.temperature)) body.options.temperature = options.temperature;
  if (Number.isFinite(options.top_p)) body.options.top_p = options.top_p;
  return body;
}

function buildOpenAiBody({ model, messages, options }) {
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (Number.isFinite(options.num_predict)) body.max_tokens = options.num_predict;
  if (Number.isFinite(options.temperature)) body.temperature = options.temperature;
  if (Number.isFinite(options.top_p)) body.top_p = options.top_p;
  return body;
}

/**
 * Streams a completion and calls onDelta with each text fragment.
 * Resolves with { text, usage }. Rejects on network failure or if aborted
 * after nothing was produced.
 */
async function streamChat({ kind, baseUrl, model, messages, options = {}, signal, onDelta, apiKey = null }) {
  if (!model) throw new Error("Choose a model before sending a message.");
  const url = kind === "ollama" ? `${normaliseBase(baseUrl)}/api/chat` : `${openAiRoot(baseUrl)}/chat/completions`;
  const body = kind === "ollama" ? buildOllamaBody({ model, messages, options }) : buildOpenAiBody({ model, messages, options });

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw networkError(error, url);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 500);
    } catch (_error) {
      detail = "";
    }
    if (response.status === 404) {
      throw new Error(
        `The server does not have a model called "${model}". Pick another model, or check that the name matches ` +
          `what is installed.${detail ? ` (${detail})` : ""}`,
      );
    }
    throw new Error(`${url} answered ${response.status}. ${detail}`.trim());
  }

  if (!response.body) throw new Error("The model server returned an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const usage = { prompt_tokens: 0, completion_tokens: 0 };

  const consume = (line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;
    let chunk;
    if (kind === "ollama") {
      try {
        chunk = JSON.parse(trimmedLine);
      } catch (_error) {
        return;
      }
      if (chunk.message && typeof chunk.message.content === "string" && chunk.message.content) {
        text += chunk.message.content;
        onDelta(chunk.message.content);
      }
      if (chunk.done) {
        usage.prompt_tokens = chunk.prompt_eval_count || 0;
        usage.completion_tokens = chunk.eval_count || 0;
      }
      return;
    }
    if (!trimmedLine.startsWith("data:")) return;
    const payload = trimmedLine.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      chunk = JSON.parse(payload);
    } catch (_error) {
      return;
    }
    const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    const piece = (delta && delta.content) || "";
    if (piece) {
      text += piece;
      onDelta(piece);
    }
    if (chunk.usage) {
      usage.prompt_tokens = chunk.usage.prompt_tokens || 0;
      usage.completion_tokens = chunk.usage.completion_tokens || 0;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
    }
    if (buffer.trim()) consume(buffer);
  } catch (error) {
    if (error && error.name === "AbortError") return { text, usage, stopped: true };
    throw networkError(error, url);
  }

  return { text, usage };
}

module.exports = { discoverModels, streamChat, normaliseBase, openAiRoot };