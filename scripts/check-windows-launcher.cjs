"use strict";
// No models/processes are started. Validate PowerShell path handling on Windows.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
if (process.platform !== "win32") throw new Error("Run this check on Windows.");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern path [brackets] & spaces "));
const launcher = path.resolve(__dirname, "start-colibri.ps1");
const model = path.join(dir, "model directory");
fs.mkdirSync(path.join(dir, "c"));
fs.mkdirSync(model);
fs.writeFileSync(path.join(dir, "c", "coli"), "# test placeholder; never executed\n");
function run(extra = [], checkout = dir, modelPath = model) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcher,
    "-CheckoutPath", checkout, "-ModelPath", modelPath, "-PrintCommand", ...extra], { encoding: "utf8", timeout: 15000 });
}
try {
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  let parsed = JSON.parse(result.stdout);
  assert.equal(parsed.host, "127.0.0.1"); assert.equal(parsed.port, 8000);
  assert.equal(parsed.model.toLowerCase(), model.toLowerCase());
  assert.equal(parsed.launcher.toLowerCase(), path.join(dir, "c", "coli").toLowerCase());
  console.log("PASS literal spaces, brackets and ampersands; loopback default");
  result = run(["-Port", "8123"]); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).port, 8123); console.log("PASS custom port");
  result = run(["-Port", "80"]); assert.notEqual(result.status, 0); console.log("PASS invalid port rejected");
  result = run([], dir, path.join(dir, "c", "coli")); assert.notEqual(result.status, 0); console.log("PASS file rejected as model directory");
  fs.unlinkSync(path.join(dir, "c", "coli"));
  result = run(); assert.notEqual(result.status, 0); console.log("PASS missing launcher rejected");
  fs.writeFileSync(path.join(dir, "coli"), "# test placeholder\n");
  result = run(); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).launcher.toLowerCase(), path.join(dir, "coli").toLowerCase());
  console.log("PASS release-directory launcher fallback");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
