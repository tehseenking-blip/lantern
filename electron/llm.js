"use strict";

/** Local inference only. Never follow redirects, resolve arbitrary hosts or fall back. */
const DISCOVERY_TIMEOUT_MS = 8000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_FRAME_CHARS = 2 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 8 * 1024 * 1024;
const KINDS = new Set(["ollama", "openai", "colibri"]);

function normaliseBase(baseUrl) {
  const value = String(baseUrl || "").trim();
  if (!value) throw new Error("No server address is set for this provider.");
  let url;
  try { url = new URL(value); } catch (_) { throw new Error("Enter a complete local server address, such as http://127.0.0.1:8000/v1."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Local servers must use http or https.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Server addresses cannot contain credentials, query strings or fragments. Use the access-key field.");
  }
  const host = url.hostname.toLowerCase();
  if (!(host === "localhost" || host === "[::1]" || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(host))) {
    throw new Error("Lantern only connects to loopback addresses (localhost, 127.0.0.1 or [::1]). No request was sent.");
  }
  // No DNS lookup for localhost, so hosts-file changes cannot route chats away.
  if (host === "localhost") url.hostname = "127.0.0.1";
  return url.href.replace(/\/+$/, "");
}

function openAiRoot(baseUrl) {
  const base = normaliseBase(baseUrl);
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function requireKind(kind) {
  if (!KINDS.has(kind)) throw new Error("Choose a supported local provider: Colibri, LM Studio/OpenAI-compatible, or Ollama.");
}

function headersFor(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function networkError(error, url) {
  if (error && error.name === "AbortError") return new Error("Stopped.");
  if (error && error.name === "TimeoutError") return new Error(`${url} did not answer in time. The model may still be loading.`);
  // Do not echo low-level exceptions or server bodies: they can contain credentials/prompts.
  return new Error(`Could not reach ${url}. Start the local server and check its address, port and certificate. Redirects are blocked. Lantern did not fall back to any online service.`);
}

function httpError(response, url) {
  const status = response.status;
  if (status >= 300 && status < 400) return new Error("The local server tried to redirect the request. Redirects are blocked; use its direct loopback address.");
  if (status === 401 || status === 403) return new Error(`The local server refused access (${status}). Save its access key in Settings; Colibri uses COLI_API_KEY.`);
  if (status === 404) return new Error(`The local server answered 404 at ${url}. Check the API address and select the exact model ID returned by Refresh.`);
  if (status === 400 || status === 413 || status === 422) return new Error(`The local server rejected the request (${status}). Check the model ID, context size and generation settings. See its local log for details.`);
  if (status === 429 || status === 503) return new Error(`The local model server is busy or still loading (${status}). Wait for it to become ready, then retry.`);
  return new Error(`The local server answered ${status} at ${url}. See its local log for details.`);
}

async function requestJson(url, { apiKey = null, timeoutMs = DISCOVERY_TIMEOUT_MS, signal } = {}) {
  // Validate again at the network boundary, including auxiliary endpoints.
  const target = normaliseBase(url);
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(target, { headers: headersFor(apiKey), signal: requestSignal, redirect: "manual" });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response, target);
    }
    let raw = "";
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The local server returned an empty response.");
    try {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        if (raw.length > MAX_FRAME_CHARS) throw new Error("The local server returned an unexpectedly large model list.");
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try { return JSON.parse(raw); } catch (_) { throw new Error("The local server did not return valid JSON. Check the API address, not its web dashboard URL."); }
  } catch (error) {
    if (requestSignal.aborted || error instanceof TypeError) throw networkError(requestSignal.reason || error, target);
    throw error;
  }
}

async function discoverModels({ kind, baseUrl, apiKey = null, timeoutMs, signal }) {
  requireKind(kind);
  const url = kind === "ollama" ? `${normaliseBase(baseUrl)}/api/tags` : `${openAiRoot(baseUrl)}/models`;
  const payload = await requestJson(url, { apiKey, timeoutMs, signal });
  const list = kind === "ollama" ? payload?.models : Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(list)) throw new Error("The local server returned an invalid model list. Check the selected protocol.");
  const seen = new Set();
  return list.flatMap((item) => {
    const id = kind === "ollama" ? item?.name : item?.id;
    if (typeof id !== "string" || !id.trim() || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: id, size: item.size || 0, family: item.details?.family || "", parameterSize: item.details?.parameter_size || "" }];
  });
}

function buildBody({ kind, model, messages, options = {} }) {
  const body = { model, messages, stream: true };
  if (kind === "ollama") {
    body.options = {};
    for (const key of ["num_ctx", "num_predict", "temperature", "top_p"]) {
      if (Number.isFinite(options[key])) body.options[key] = options[key];
    }
  } else {
    body.stream_options = { include_usage: true };
    if (Number.isFinite(options.num_predict)) body.max_tokens = options.num_predict;
    if (Number.isFinite(options.temperature)) body.temperature = options.temperature;
    if (Number.isFinite(options.top_p)) body.top_p = options.top_p;
    if (kind === "colibri" && typeof options.enable_thinking === "boolean") body.enable_thinking = options.enable_thinking;
    // num_ctx is a client context budget. Colibri's actual context is set at server launch.
  }
  return body;
}

/** Robust SSE/NDJSON streaming, including UTF-8 splits, usage, cancellation and errors. */
async function streamChat({ kind, baseUrl, model, messages, options = {}, signal, onDelta = () => {}, apiKey = null, idleTimeoutMs = IDLE_TIMEOUT_MS }) {
  requireKind(kind);
  if (typeof model !== "string" || !model.trim()) throw new Error("Choose a model before sending a message.");
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("A conversation must contain at least one message.");
  const url = kind === "ollama" ? `${normaliseBase(baseUrl)}/api/chat` : `${openAiRoot(baseUrl)}/chat/completions`;
  const body = buildBody({ kind, model, messages, options });
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  let reader;
  let text = "";
  let reasoningSeen = false;
  let terminal = false;
  let doneMarker = false;
  let finishReason = null;
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const abort = () => controller.abort(signal?.reason);
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, idleTimeoutMs);
    timer.unref?.();
  };
  if (signal?.aborted) throw networkError(signal.reason || { name: "AbortError" }, url);
  signal?.addEventListener("abort", abort, { once: true });
  resetTimer();
  try {
    let response;
    try {
      response = await fetch(url, { method: "POST", headers: headersFor(apiKey), body: JSON.stringify(body), signal: controller.signal, redirect: "manual" });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw networkError(error, url);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response, url);
    }
    const contentType = response.headers.get("content-type") || "";
    if (kind !== "ollama" && !contentType.toLowerCase().includes("text/event-stream")) {
      await response.body?.cancel();
      throw new Error("The local server did not return an event stream. Check its OpenAI-compatible streaming endpoint.");
    }
    if (!response.body) throw new Error("The model server returned an empty response.");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventData = [];
    let eventSize = 0;

    const consume = (payload) => {
      if (payload === "[DONE]") { terminal = true; doneMarker = true; return; }
      let chunk;
      try { chunk = JSON.parse(payload); } catch (_) { throw new Error("The local server sent malformed streaming JSON. The partial reply was not discarded."); }
      if (chunk?.error) throw new Error("The local model reported a generation error. Check its context limit and local log; any partial reply is preserved.");
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta;
      const piece = kind === "ollama" ? chunk?.message?.content : delta?.content;
      if (piece != null && typeof piece !== "string") throw new Error("The local server returned unsupported non-text content.");
      if (piece) {
        if (text.length + piece.length > MAX_OUTPUT_CHARS) throw new Error("The reply exceeded Lantern's safety size limit. Reduce the maximum reply length.");
        text += piece;
        onDelta(piece);
      }
      reasoningSeen ||= Boolean(delta?.reasoning_content || delta?.reasoning || chunk?.message?.thinking);
      if (kind === "ollama" && chunk?.done) {
        terminal = true;
        doneMarker = true;
        finishReason = chunk.done_reason || "stop";
        usage.prompt_tokens = chunk.prompt_eval_count || 0;
        usage.completion_tokens = chunk.eval_count || 0;
      }
      if (choice?.finish_reason) { terminal = true; finishReason = choice.finish_reason; }
      if (chunk?.usage) {
        usage.prompt_tokens = chunk.usage.prompt_tokens || 0;
        usage.completion_tokens = chunk.usage.completion_tokens || 0;
      }
    };
    const flushEvent = () => {
      if (eventData.length) consume(eventData.join("\n"));
      eventData = []; eventSize = 0;
    };
    const line = (raw) => {
      const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (kind === "ollama") { if (value.trim()) consume(value); return; }
      if (value === "") { flushEvent(); return; }
      if (!value.startsWith("data:")) return; // SSE comments, ids and named events.
      const data = value.slice(5).replace(/^ /, "");
      eventSize += data.length;
      if (eventSize > MAX_FRAME_CHARS) throw new Error("The local server sent an oversized streaming event.");
      eventData.push(data);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetTimer();
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const next = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (next.length > MAX_FRAME_CHARS) throw new Error("The local server sent an oversized streaming line.");
        line(next);
        if (doneMarker) break;
      }
      if (doneMarker) break;
      if (buffer.length > MAX_FRAME_CHARS) throw new Error("The local server sent an oversized streaming line.");
    }
    if (!doneMarker) {
      buffer += decoder.decode();
      if (buffer) line(buffer);
      if (kind !== "ollama") flushEvent();
    }
    if (!terminal) throw new Error("The local server disconnected before finishing. Any partial reply is preserved; retry when the server is ready.");
    if (!text.trim()) {
      throw new Error(reasoningSeen
        ? "The model produced reasoning but no answer. Increase Longest reply, or disable thinking in the Colibri server."
        : "The local model returned no answer. Check its model/template and try a larger reply budget.");
    }
    return { text, usage, finishReason };
  } catch (error) {
    if (timedOut) throw new Error("The local model stopped responding for too long. It may still be loading or reading weights from disk. Any partial reply is preserved; no online fallback was used.");
    if (signal?.aborted) {
      if (signal.reason?.name === "TimeoutError") throw networkError(signal.reason, url);
      if (text) return { text, usage, stopped: true, finishReason };
      throw new Error("Stopped.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    controller.abort();
  }
}

module.exports = { discoverModels, streamChat, normaliseBase, openAiRoot, buildBody, requestJson };
