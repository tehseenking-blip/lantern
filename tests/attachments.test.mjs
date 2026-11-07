import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import attachmentsModule from "../electron/attachments.js";

const { extractAttachment, truncate } = attachmentsModule;

async function withTempFile(name, contents) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "lantern-test-"));
  const file = path.join(folder, name);
  await fs.writeFile(file, contents);
  return file;
}

test("plain text and markdown are read locally", async () => {
  const file = await withTempFile("notes.md", "# Shed\n\nThe roof needs replacing.");
  const result = await extractAttachment(file);
  assert.equal(result.name, "notes.md");
  assert.match(result.text, /roof needs replacing/);
  assert.ok(result.size > 0);
});

test("long text is truncated with a visible marker, not silently cut", () => {
  const text = truncate("a".repeat(70000));
  assert.ok(text.length < 70000);
  assert.match(text, /\[Truncated: only the first 60000 characters were read\.\]/);
});

test("an unsupported format is refused clearly and mentions nothing was uploaded", async () => {
  const file = await withTempFile("photo.heic", "not really an image");
  await assert.rejects(
    () => extractAttachment(file),
    (error) => {
      assert.match(error.message, /cannot be read locally/);
      assert.match(error.message, /Nothing was sent anywhere/);
      return true;
    },
  );
});

test("a missing file reports its own name", async () => {
  await assert.rejects(
    () => extractAttachment(path.join(os.tmpdir(), "lantern-does-not-exist.txt")),
    /Could not open lantern-does-not-exist\.txt/,
  );
});