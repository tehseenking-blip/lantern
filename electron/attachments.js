"use strict";

const fs = require("fs/promises");
const path = require("path");

const MAX_CHARS = 60000;

const PLAIN_TEXT = new Set([
  ".txt", ".md", ".markdown", ".mdx", ".json", ".jsonl", ".csv", ".tsv", ".log",
  ".yml", ".yaml", ".toml", ".ini", ".xml", ".html", ".htm", ".css", ".scss",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".sql", ".sh",
  ".bash", ".ps1", ".bat", ".gitignore", ".env", ".diff", ".patch",
]);

const MIME_HINTS = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function truncate(text) {
  const value = String(text || "").replace(/\r\n/g, "\n");
  if (value.length <= MAX_CHARS) return value;
  return `${value.slice(0, MAX_CHARS)}\n\n[Truncated: only the first ${MAX_CHARS} characters were read.]`;
}

function unsupportedMessage(extension) {
  const label = extension ? `"${extension}" files` : "That file type";
  return (
    `${label} cannot be read locally. Supported: plain text, Markdown, CSV, JSON, most code files, ` +
    "PDF and Word (.docx). Nothing was sent anywhere — remove the attachment or convert it to text."
  );
}

async function extractAttachment(filePath) {
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (error) {
    throw new Error(`Could not open ${path.basename(filePath)}: ${error.message}`);
  }
  if (stats.isDirectory()) throw new Error(`${path.basename(filePath)} is a folder, not a file.`);

  const extension = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  const mime = MIME_HINTS[extension] || "";

  if (PLAIN_TEXT.has(extension) || !extension) {
    const raw = await fs.readFile(filePath, "utf8");
    return { name, mime: mime || "text/plain", size: stats.size, text: truncate(raw) };
  }

  if (extension === ".pdf") {
    const pdfParse = require("pdf-parse");
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    const text = truncate(parsed.text || "");
    if (!text.trim()) {
      throw new Error(
        `${name} has no extractable text. It is probably a scanned page — plain local extraction cannot read images. ` +
          "Nothing was uploaded.",
      );
    }
    return { name, mime: mime || "application/pdf", size: stats.size, text };
  }

  if (extension === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return { name, mime: mime || "application/msword", size: stats.size, text: truncate(result.value || "") };
  }

  throw new Error(unsupportedMessage(extension));
}

module.exports = { extractAttachment, truncate, PLAIN_TEXT, MAX_CHARS };