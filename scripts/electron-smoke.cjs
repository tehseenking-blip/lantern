"use strict";
// Real Electron, preload, IPC, renderer and SQLite; synthetic local inference only.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { app, BrowserWindow, safeStorage } = require("electron");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test-artifacts");
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-colibri-test-"));
app.setPath("userData", temporary);
app.commandLine.appendSwitch("disable-gpu");
const checks = [];
const requests = [];
let win, server, db, requiredKey = null;
const model = "colibri-fixture-model";
const reply = "Lantern local connection works. UTF-8: café ✓";
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error("Desktop smoke test exceeded 90 seconds"); app.exit(1); }, 90000);
function record(name) { checks.push(name); console.log(`PASS ${name}`); }
async function until(predicate, description, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await pause(60);
  }
  throw new Error(`Timed out: ${description}`);
}
const page = (source) => win.webContents.executeJavaScript(source, true);
const bodyHas = (text) => page(`document.body.innerText.includes(${JSON.stringify(text)})`);
async function click(selector) {
  await until(() => page(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), `selector ${selector}`);
  await page(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function clickText(text, selector = "button") {
  await until(() => page(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`), `button ${text}`);
  await page(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
}
async function main() {
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    let body;
    try { body = raw ? JSON.parse(raw) : null; } catch { res.writeHead(400).end(); return; }
    requests.push({ method: req.method, url: req.url, body, authenticated: !requiredKey || req.headers.authorization === `Bearer ${requiredKey}` });
    if (requiredKey && req.headers.authorization !== `Bearer ${requiredKey}`) { res.writeHead(401).end(); return; }
    if (req.url === "/v1/models" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ object: "list", data: [{ id: model, object: "model" }] }));
      return;
    }
    if (req.url !== "/v1/chat/completions" || req.method !== "POST" || body?.model !== model) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.flushHeaders();
    // This is a deliberately labelled protocol fixture, NOT a running language model.
    await pause(150);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply.slice(0, 18) }, finish_reason: null }] })}\n\n`);
    await pause(80);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply.slice(18) }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 10 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await app.whenReady();
  db = require("../electron/db");
  db.init(path.join(temporary, "lantern.db"));
  db.updateSettings({
    providers: [
      { id: "ollama", label: "Ollama", kind: "ollama", baseUrl: "http://127.0.0.1:11434" },
      { id: "lmstudio", label: "LM Studio", kind: "openai", baseUrl: "http://127.0.0.1:1234" },
    ], activeProvider: "lmstudio", lastModel: "legacy-model",
  });
  const legacy = db.createChat({ provider: "lmstudio", model: "legacy-model" });
  db.addMessage({ chat_id: legacy.id, role: "user", content: "Preserve this synthetic legacy conversation.", token_estimate: 10 });
  const migrated = db.getSettings();
  assert.equal(migrated.activeProvider, "lmstudio");
  assert.equal(migrated.lastModel, "legacy-model");
  assert.equal(migrated.providers.filter(p => p.id === "colibri").length, 1);
  record("Native SQLite migration preserves the existing provider, model and chat");
  const providers = migrated.providers.map(p => p.id === "colibri" ? { ...p, baseUrl } : p);
  const setup = { providers, lastChatId: legacy.id };
  if (safeStorage.isEncryptionAvailable()) {
    requiredKey = "synthetic-desktop-test-key";
    setup.secrets = { colibri: safeStorage.encryptString(requiredKey).toString("base64") };
  }
  db.updateSettings(setup);
  db.close();
  // Load the application's actual entrypoint, not an imitation of its IPC/bootstrap.
  require("../electron/main");
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return Boolean(win); }, "application window");
  await until(() => page("Boolean(window.lantern && document.querySelector('.sidebar'))").catch(() => false), "renderer and preload");
  await until(() => bodyHas("Preserve this synthetic legacy conversation."), "saved conversation loaded");
  record("Real app entrypoint, isolated preload, renderer and saved conversation load");
  const publicSettings = await page("window.lantern.settings.get()");
  assert.ok(!Object.hasOwn(publicSettings, "secrets"));
  assert.ok(!JSON.stringify(publicSettings).includes("synthetic-desktop-test-key"));
  record("Public settings do not reveal stored credentials");
  await clickText("Settings");
  await until(() => bodyHas("Colibri runs separately"), "Colibri help rendered");
  const card = ".provider-card:has(#base-colibri)";
  await clickText("Test connection", `${card} button`);
  await until(() => bodyHas("Connected. 1 model available."), "authenticated discovery");
  record("Colibri settings card discovers the exact fixture model through real IPC");
  await clickText("Test model response", `${card} button`);
  await until(() => bodyHas(`Model replied (${model}`), "generation diagnostic");
  const diagnostic = requests.find(r => r.method === "POST");
  assert.equal(diagnostic.body.messages.length, 1);
  assert.equal(diagnostic.body.messages[0].content, "Reply with the words: Lantern local connection works.");
  assert.equal(diagnostic.body.enable_thinking, false);
  record("Explicit response diagnostic sends only its fixed prompt, not saved history");
  fs.writeFileSync(path.join(output, "colibri-settings.png"), (await win.webContents.capturePage()).toPNG());
  await clickText("Use Colibri for new chats", `${card} button`);
  await until(() => bodyHas("Default for new chats"), "Colibri default saved");
  assert.equal(db.getChat(legacy.id).provider, "lmstudio");
  record("Selecting Colibri for new chats leaves existing conversations unchanged");
  await click(".new-chat");
  await click('[title="Model and generation settings"]');
  await until(() => page(`Boolean(document.querySelector('#model option[value="${model}"]'))`), "model dropdown discovery");
  await page(`(() => { const el = document.querySelector('#model'); el.value = ${JSON.stringify(model)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(() => page(`document.querySelector('.pill-text')?.textContent === ${JSON.stringify(model)}`), "model selection saved");
  await click('.drawer [aria-label="Close"]');
  await page(`(() => { const el = document.querySelector('.composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Desktop Colibri smoke test.'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(() => page("!document.querySelector('.send-btn').disabled"), "composer input");
  await click(".send-btn");
  await until(() => bodyHas(reply), "streaming answer displayed");
  await until(() => page("!document.querySelector('.stop-btn')"), "generation finished");
  const current = db.listChats({}).find(c => c.id !== legacy.id);
  assert.equal(current.provider, "colibri");
  assert.equal(current.model, model);
  assert.equal(db.listMessages(current.id).find(m => m.role === "assistant").content, reply);
  assert.ok(requests.every(r => r.authenticated));
  record("Model selection and streamed chat complete through the actual desktop UI");
  const blocked = await page(`fetch(${JSON.stringify(`${baseUrl}/models`)}).then(() => false, () => true)`);
  assert.equal(blocked, true);
  record("Renderer cannot bypass IPC to make network requests (CSP)");
  await page(`window.lantern.settings.update({lastChatId: ${JSON.stringify(current.id)}})`);
  win.webContents.reload();
  await until(() => page("document.readyState === 'complete'").catch(() => false), "reload complete");
  await until(() => bodyHas(reply).catch(() => false), "chat restored after reload");
  assert.equal(db.listMessages(current.id).length, 2);
  record("Completed chat persists across a renderer reload without duplication");
  fs.writeFileSync(path.join(output, "colibri-chat.png"), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, "desktop-smoke.json"), JSON.stringify({ status: "passed", checks, platform: process.platform, electron: process.versions.electron, authenticationTested: Boolean(requiredKey), inference: "synthetic localhost fixture; no real model or GPU", requests: requests.length }, null, 2));
}
main().then(() => cleanup(0)).catch(async error => {
  console.error(error.stack);
  fs.writeFileSync(path.join(output, "desktop-smoke.json"), JSON.stringify({ status: "failed", checks, error: error.message }, null, 2));
  if (win && !win.isDestroyed()) {
    try { fs.writeFileSync(path.join(output, "desktop-failure.png"), (await win.webContents.capturePage()).toPNG()); } catch {}
    try { console.error(await page("document.body.innerText")); } catch {}
  }
  cleanup(1);
});
function cleanup(code) {
  clearTimeout(deadline);
  server?.closeAllConnections();
  server?.close();
  db?.close();
  app.exit(code);
}
