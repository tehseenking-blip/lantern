"use strict";

const crypto = require("crypto");
const Database = require("better-sqlite3");

let db = null;
let ftsAvailable = false;

const now = () => Date.now();
const newId = () => crypto.randomUUID();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  contribute INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'ollama',
  model TEXT NOT NULL DEFAULT '',
  num_ctx INTEGER NOT NULL DEFAULT 8192,
  num_predict INTEGER NOT NULL DEFAULT 1024,
  temperature REAL NOT NULL DEFAULT 0.7,
  top_p REAL NOT NULL DEFAULT 0.9,
  instructions TEXT NOT NULL DEFAULT '',
  pinned TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  summary_upto TEXT,
  contribute INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  model TEXT,
  settings TEXT,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  edited_at INTEGER
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  chat_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
`;

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, message_id UNINDEXED, chat_id UNINDEXED);

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(content, message_id, chat_id) VALUES (new.content, new.id, new.chat_id);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
  UPDATE messages_fts SET content = new.content WHERE message_id = new.id;
END;
`;

function init(filePath) {
  db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  try {
    db.exec(FTS_SCHEMA);
    ftsAvailable = true;
  } catch (_error) {
    ftsAvailable = false;
  }
  return filePath;
}

function close() {
  if (db) {
    try {
      db.close();
    } catch (_error) {
      /* already closed */
    }
    db = null;
  }
}

function requireDb() {
  if (!db) throw new Error("The local database is not open.");
  return db;
}

/* ---------------------------------------------------------------- settings */

const DEFAULT_SETTINGS = {
  theme: "system",
  assistantInstructions:
    "You are a careful, direct assistant working offline on this computer. Answer in Australian English. " +
    "Be accurate about what you know and say plainly when you do not know something.",
  providers: [
    { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434", kind: "ollama" },
    { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234", kind: "openai" },
  ],
  activeProvider: "ollama",
  lastModel: "",
  retrieval: { enabled: true, limit: 6, otherChats: false },
  summariseAt: 0.65,
  lastChatId: null,
};

function getSettings() {
  const rows = requireDb().prepare("SELECT key, value FROM settings").all();
  const stored = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch (_error) {
      stored[row.key] = row.value;
    }
  }
  return { ...DEFAULT_SETTINGS, ...stored };
}

function updateSettings(patch) {
  const statement = requireDb().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const write = requireDb().transaction((entries) => {
    for (const [key, value] of entries) statement.run(key, JSON.stringify(value));
  });
  write(Object.entries(patch || {}));
  return getSettings();
}

/* ---------------------------------------------------------------- projects */

function listProjects() {
  return requireDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM chats WHERE project_id = p.id) AS chat_count
       FROM projects p ORDER BY p.updated_at DESC`,
    )
    .all();
}

function createProject({ name, instructions = "" }) {
  const timestamp = now();
  const record = {
    id: newId(),
    name: String(name || "Untitled project").trim() || "Untitled project",
    instructions,
    contribute: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
  requireDb()
    .prepare(
      "INSERT INTO projects (id, name, instructions, contribute, created_at, updated_at) VALUES (@id, @name, @instructions, @contribute, @created_at, @updated_at)",
    )
    .run(record);
  return record;
}

function updateProject(id, patch) {
  const allowed = ["name", "instructions", "contribute"];
  const fields = Object.keys(patch || {}).filter((key) => allowed.includes(key));
  if (fields.length) {
    const assignments = fields.map((field) => `${field} = @${field}`).join(", ");
    requireDb()
      .prepare(`UPDATE projects SET ${assignments}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...pick(patch, fields), id, updated_at: now() });
  }
  return requireDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) || null;
}

function removeProject(id) {
  requireDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return { ok: true };
}

/* ------------------------------------------------------------------- chats */

function listChats({ search = "", projectId = null } = {}) {
  const clauses = [];
  const params = {};
  if (projectId) {
    clauses.push("c.project_id = @projectId");
    params.projectId = projectId;
  }
  if (search && search.trim()) {
    clauses.push("(c.title LIKE @term OR c.id IN (SELECT chat_id FROM messages WHERE content LIKE @term))");
    params.term = `%${search.trim()}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return requireDb()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count,
              (SELECT content FROM messages WHERE chat_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS preview
       FROM chats c ${where}
       ORDER BY c.updated_at DESC`,
    )
    .all(params);
}

function getChat(id) {
  return requireDb().prepare("SELECT * FROM chats WHERE id = ?").get(id) || null;
}

function createChat(payload = {}) {
  const timestamp = now();
  const record = {
    id: newId(),
    title: "New chat",
    project_id: payload.projectId || null,
    provider: payload.provider || "ollama",
    model: payload.model || "",
    num_ctx: payload.num_ctx || 8192,
    num_predict: payload.num_predict || 1024,
    temperature: payload.temperature ?? 0.7,
    top_p: payload.top_p ?? 0.9,
    instructions: "",
    pinned: "",
    summary: "",
    summary_upto: null,
    contribute: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
  requireDb()
    .prepare(
      `INSERT INTO chats (id, title, project_id, provider, model, num_ctx, num_predict, temperature, top_p, instructions, pinned, summary, summary_upto, contribute, created_at, updated_at)
       VALUES (@id, @title, @project_id, @provider, @model, @num_ctx, @num_predict, @temperature, @top_p, @instructions, @pinned, @summary, @summary_upto, @contribute, @created_at, @updated_at)`,
    )
    .run(record);
  return record;
}

function updateChat(id, patch) {
  const allowed = [
    "title",
    "project_id",
    "provider",
    "model",
    "num_ctx",
    "num_predict",
    "temperature",
    "top_p",
    "instructions",
    "pinned",
    "summary",
    "summary_upto",
    "contribute",
  ];
  const fields = Object.keys(patch || {}).filter((key) => allowed.includes(key));
  if (fields.length) {
    const assignments = fields.map((field) => `${field} = @${field}`).join(", ");
    requireDb()
      .prepare(`UPDATE chats SET ${assignments}, updated_at = @updated_at WHERE id = @id`)
      .run({ ...pick(patch, fields), id, updated_at: now() });
  }
  return getChat(id);
}

function touchChat(id) {
  requireDb().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(now(), id);
}

function removeChat(id) {
  const statement = requireDb();
  statement.transaction(() => {
    statement.prepare("DELETE FROM attachments WHERE chat_id = ?").run(id);
    statement.prepare("DELETE FROM memories WHERE chat_id = ?").run(id);
    statement.prepare("DELETE FROM messages WHERE chat_id = ?").run(id);
    statement.prepare("DELETE FROM chats WHERE id = ?").run(id);
  })();
  return { ok: true };
}

/* ---------------------------------------------------------------- messages */

function listMessages(chatId) {
  const rows = requireDb()
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(chatId);
  if (!rows.length) return [];
  const attachments = requireDb()
    .prepare("SELECT * FROM attachments WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chatId);
  const byMessage = new Map();
  for (const file of attachments) {
    if (!byMessage.has(file.message_id)) byMessage.set(file.message_id, []);
    byMessage.get(file.message_id).push(file);
  }
  return rows.map((row) => ({
    ...row,
    settings: row.settings ? safeParse(row.settings) : null,
    attachments: byMessage.get(row.id) || [],
  }));
}

function addMessage(payload) {
  // Ordering inside a chat must be strictly increasing, so editing or
  // regenerating has an unambiguous "everything after this point".
  const previous = requireDb()
    .prepare("SELECT MAX(created_at) AS last FROM messages WHERE chat_id = ?")
    .get(payload.chat_id);
  const timestamp = Math.max(payload.created_at || now(), (previous.last || 0) + 1);
  const record = {
    id: payload.id || newId(),
    chat_id: payload.chat_id,
    role: payload.role,
    content: payload.content || "",
    model: payload.model || null,
    settings: payload.settings ? JSON.stringify(payload.settings) : null,
    token_estimate: payload.token_estimate || 0,
    created_at: timestamp,
    edited_at: null,
  };
  requireDb()
    .prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, settings, token_estimate, created_at, edited_at)
       VALUES (@id, @chat_id, @role, @content, @model, @settings, @token_estimate, @created_at, @edited_at)`,
    )
    .run(record);
  if (Array.isArray(payload.attachments)) {
    attachFiles(record.id, record.chat_id, payload.attachments);
  }
  touchChat(record.chat_id);
  return getMessage(record.id);
}

function getMessage(id) {
  const row = requireDb().prepare("SELECT * FROM messages WHERE id = ?").get(id);
  if (!row) return null;
  return {
    ...row,
    settings: row.settings ? safeParse(row.settings) : null,
    attachments: requireDb().prepare("SELECT * FROM attachments WHERE message_id = ?").all(id),
  };
}

function updateMessage(id, patch) {
  const allowed = ["content", "token_estimate", "edited_at", "settings", "model"];
  const fields = Object.keys(patch || {}).filter((key) => allowed.includes(key));
  if (fields.length) {
    const assignments = fields.map((field) => `${field} = @${field}`).join(", ");
    const values = { ...pick(patch, fields), id };
    if (values.settings && typeof values.settings !== "string") values.settings = JSON.stringify(values.settings);
    requireDb().prepare(`UPDATE messages SET ${assignments} WHERE id = @id`).run(values);
  }
  return getMessage(id);
}

function removeMessage(id) {
  requireDb().prepare("DELETE FROM attachments WHERE message_id = ?").run(id);
  requireDb().prepare("DELETE FROM messages WHERE id = ?").run(id);
  return { ok: true };
}

function removeMessagesAfter(chatId, createdAt) {
  const rows = requireDb()
    .prepare("SELECT id FROM messages WHERE chat_id = ? AND created_at > ?")
    .all(chatId, createdAt);
  const remove = requireDb().prepare("DELETE FROM messages WHERE id = ?");
  const removeFiles = requireDb().prepare("DELETE FROM attachments WHERE message_id = ?");
  requireDb().transaction(() => {
    for (const row of rows) {
      removeFiles.run(row.id);
      remove.run(row.id);
    }
  })();
  return { removed: rows.length };
}

function attachFiles(messageId, chatId, files) {
  const statement = requireDb().prepare(
    `INSERT INTO attachments (id, chat_id, message_id, name, mime, size, text, created_at)
     VALUES (@id, @chat_id, @message_id, @name, @mime, @size, @text, @created_at)`,
  );
  requireDb().transaction(() => {
    for (const file of files) {
      statement.run({
        id: newId(),
        chat_id: chatId,
        message_id: messageId,
        name: file.name || "attachment",
        mime: file.mime || "",
        size: file.size || 0,
        text: file.text || "",
        created_at: now(),
      });
    }
  })();
}

/* ---------------------------------------------------------------- memories */

function listMemories({ kind = null, includeDisabled = true } = {}) {
  const clauses = [];
  const params = {};
  if (kind) {
    clauses.push("kind = @kind");
    params.kind = kind;
  }
  if (!includeDisabled) clauses.push("enabled = 1");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return requireDb().prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC`).all(params);
}

function createMemory({ kind = "fact", title = "", content, chat_id = null }) {
  const timestamp = now();
  const record = {
    id: newId(),
    kind,
    title,
    content: String(content || "").trim(),
    chat_id,
    enabled: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
  requireDb()
    .prepare(
      `INSERT INTO memories (id, kind, title, content, chat_id, enabled, created_at, updated_at)
       VALUES (@id, @kind, @title, @content, @chat_id, @enabled, @created_at, @updated_at)`,
    )
    .run(record);
  return record;
}

function updateMemory(id, patch) {
  const allowed = ["kind", "title", "content", "enabled"];
  const fields = Object.keys(patch || {}).filter((key) => allowed.includes(key));
  if (fields.length) {
    const assignments = fields.map((field) => `${field} = @${field}`).join(", ");
    const values = { ...pick(patch, fields), id, updated_at: now() };
    if ("enabled" in values) values.enabled = values.enabled ? 1 : 0;
    requireDb().prepare(`UPDATE memories SET ${assignments}, updated_at = @updated_at WHERE id = @id`).run(values);
  }
  return requireDb().prepare("SELECT * FROM memories WHERE id = ?").get(id) || null;
}

function removeMemory(id) {
  requireDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
  return { ok: true };
}

/* ------------------------------------------------------------------ search */

function sanitiseFtsQuery(term) {
  return String(term || "")
    .replace(/["*():^]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word}"`)
    .join(" OR ");
}

function searchMessages(term, limit = 20) {
  const trimmed = String(term || "").trim();
  if (!trimmed) return [];
  if (ftsAvailable) {
    const query = sanitiseFtsQuery(trimmed);
    if (query) {
      try {
        return requireDb()
          .prepare(
            `SELECT m.id, m.chat_id, m.role, m.content, m.created_at, c.title AS chat_title
             FROM messages_fts f
             JOIN messages m ON m.id = f.message_id
             JOIN chats c ON c.id = m.chat_id
             WHERE messages_fts MATCH ?
             ORDER BY rank LIMIT ?`,
          )
          .all(query, limit);
      } catch (_error) {
        /* fall through to LIKE */
      }
    }
  }
  return requireDb()
    .prepare(
      `SELECT m.id, m.chat_id, m.role, m.content, m.created_at, c.title AS chat_title
       FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(`%${trimmed}%`, limit);
}

/**
 * Passages for retrieval. Chats whose "contribute" flag is on are eligible;
 * otherChats widens the pool beyond the current conversation.
 */
function candidatePassages({ chatId, otherChats = false, projectId = null }) {
  const params = { chatId };
  const conditions = ["m.role IN ('user', 'assistant')", "length(m.content) > 0"];
  if (!otherChats) {
    conditions.push("m.chat_id = @chatId");
  } else {
    conditions.push("(c.contribute = 1 OR m.chat_id = @chatId)");
    if (projectId) {
      conditions.push("(c.project_id = @projectId OR m.chat_id = @chatId)");
      params.projectId = projectId;
    }
  }
  return requireDb()
    .prepare(
      `SELECT m.id AS message_id, m.chat_id, m.role, m.content, m.created_at, c.title AS chat_title
       FROM messages m JOIN chats c ON c.id = m.chat_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.created_at DESC LIMIT 600`,
    )
    .all(params);
}

/* ------------------------------------------------------- backup / restore */

const TABLES = ["projects", "chats", "messages", "attachments", "memories", "settings"];

function dumpAll() {
  const data = { app: "lantern", version: 1, exportedAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    data.tables[table] = requireDb().prepare(`SELECT * FROM ${table}`).all();
  }
  return data;
}

function replaceAll(payload) {
  if (!payload || typeof payload !== "object" || !payload.tables) {
    throw new Error("That file is not a Lantern backup.");
  }
  const statement = requireDb();
  statement.transaction(() => {
    for (const table of ["attachments", "messages", "memories", "chats", "projects", "settings"]) {
      statement.prepare(`DELETE FROM ${table}`).run();
    }
    for (const table of TABLES) {
      const rows = Array.isArray(payload.tables[table]) ? payload.tables[table] : [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const placeholders = columns.map((column) => `@${column}`).join(", ");
        statement
          .prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
          .run(row);
      }
    }
  })();
  return { ok: true, chats: payload.tables.chats ? payload.tables.chats.length : 0 };
}

function clearAll() {
  const statement = requireDb();
  statement.transaction(() => {
    for (const table of ["attachments", "messages", "memories", "chats", "projects"]) {
      statement.prepare(`DELETE FROM ${table}`).run();
    }
  })();
  return { ok: true };
}

/* ------------------------------------------------------------------ utils */

function pick(source, keys) {
  const output = {};
  for (const key of keys) if (key in source) output[key] = source[key];
  return output;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  init,
  close,
  getSettings,
  updateSettings,
  listProjects,
  createProject,
  updateProject,
  removeProject,
  listChats,
  getChat,
  createChat,
  updateChat,
  touchChat,
  removeChat,
  listMessages,
  getMessage,
  addMessage,
  updateMessage,
  removeMessage,
  removeMessagesAfter,
  attachFiles,
  listMemories,
  createMemory,
  updateMemory,
  removeMemory,
  searchMessages,
  candidatePassages,
  dumpAll,
  replaceAll,
  clearAll,
  newId,
};