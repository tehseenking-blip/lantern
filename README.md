# Lantern

A chat client for Windows that runs entirely on your own computer and talks to the
language models you already have installed.

Your conversations, attachments, saved preferences and search index live in one SQLite
file in your user profile. The only network connection the application ever makes is to
the model server address you configure — by default `127.0.0.1`, on your own machine.
There is no account, no cloud service, no telemetry and no cloud fallback.

**This is a source project, not an installer.** Nothing here has been run on Windows yet.
Expect to fix something small on the first launch; see *Troubleshooting*.

---

## Requirements

| | |
| --- | --- |
| Windows | 10 or 11, 64-bit |
| Node.js | 20 LTS or newer (the standard Windows installer) |
| A model server | Ollama, LM Studio, or anything speaking the OpenAI chat-completions API |
| Hardware | Whatever your model needs. A 7B model in 8-bit wants about 8 GB of RAM or VRAM; larger models want proportionally more |

No model files are included. Lantern never downloads, copies, renames or modifies them.

---

## Install and start

```bat
cd local-ai-chat
npm install
npm start
```

`npm install` rebuilds the SQLite engine against the Electron runtime automatically (the
`postinstall` step). `npm start` builds the interface once, then opens the window. There
is no dev server and no build step you need to remember afterwards.

Optional installer:

```bat
npm run dist
```

That produces an NSIS installer in `release\`, built by electron-builder. It is not signed,
so Windows will warn about an unknown publisher — that is expected for a private build.

To open DevTools while running: `set LANTERN_DEVTOOLS=1` before `npm start`.

---

## Connect your models

1. Start your model server first. Ollama normally listens on `http://127.0.0.1:11434`;
   LM Studio on `http://127.0.0.1:1234` (its OpenAI-compatible server must be started).
2. In Lantern, open **Settings → Local model servers** and check the address.
3. Press **Test connection**. It reports how many models the server offers.
4. Open a chat, press the model pill in the header, and choose a model from the list.

If discovery fails, the panel still accepts a model name typed exactly as your server
lists it — the minimum information needed when a server will not enumerate models.

Per conversation you can set: model, context length, longest reply, temperature, top-p,
its own instructions, pinned instructions, a project, and whether it may contribute
context to other chats.

**If the server is unreachable you get an error explaining exactly what failed.** There is
no code path in the Electron main process that contacts a hosted provider, so nothing can
silently fall back to one.

---

## What it does

- **Streaming answers** with a real stop button; regenerate, continue, edit and resend,
  copy, delete. Markdown, tables and code blocks with a copy button.
- **Sidebar** with chat history, search over titles and message text, projects, and a
  new-chat button. `Ctrl+N` starts a chat, `Esc` stops generation.
- **Automatic saving** of every message with its timestamp and model, and your last
  conversation is reopened on next launch.
- **Memory and preferences** in three separate kinds — writing preferences, personal
  facts, and conversation details — each inspectable, editable, pausable and deletable.
  Two preferences with the same label: the newer wins and the older is reported as
  superseded. Anything you say in a chat outranks a saved preference.
- **Long conversations** handled with a visible breakdown: recent window, saved
  preferences, memory, retrieved passages, summary, and pinned instructions, with a
  context meter showing what is being sent right now.
- **Attachments** read locally: plain text, Markdown, CSV, JSON, most code files, PDF and
  Word `.docx`. Anything else is refused with a message saying exactly that — nothing is
  ever uploaded.
- **Backup, restore, export.** One JSON backup of everything; per-chat export as Markdown
  or JSON; deletion of a chat removes its messages, attachments, search entries and
  memories saved against it.
- **Light and dark themes**, following Windows by default. System fonts only — no web fonts.

---

## How context actually works

Stored history and model context are different things, and the app keeps them apart:

- **History** is everything ever said, kept in SQLite forever, searchable, exportable.
- **Context** is the slice sent for this reply, assembled in this order: assistant
  instructions → project instructions → per-chat instructions → saved preferences →
  facts → conversation details → summary of older messages → retrieved passages →
  pinned instructions → as many recent messages as fit.

When the window fills past the threshold (65% by default), Lantern asks the same local
model to summarise the older messages and stores that summary. **The original messages
are never deleted or altered** — they stay searchable and are exported in full, and
exact passages can be retrieved from them. The interface says when a summary was used,
and when messages had to be left out of a send.

Token counts are estimates (about 3.6 characters per token) unless the server reports its
own counts. They are shown as estimates, never as billing.

There are no quotas of any kind: no message caps, no credits, no expiry. The real limits
are the model's context window, your RAM, and how long your machine takes to answer.

---

## Tests

```bat
npm test
```

Runs the Node test runner over the pure logic — context assembly and preference
precedence, retrieval ranking, export formatting, and attachment handling. These need no
Electron, no database and no model, and they pass on this project as written (23 tests).

Not covered by tests: anything needing the desktop runtime — the window, IPC, the SQLite
schema, streaming from a real model. Those are verified by using the app.

---

## Troubleshooting

**"The local database is not open" or a native module error on start.** The SQLite engine
did not rebuild. Run:

```bat
npx electron-rebuild -f -w better-sqlite3
```

If that fails, install the *Desktop development with C++* workload from Visual Studio
Build Tools, then repeat. Node 20 LTS is the least surprising version for this.

**"Nothing is listening at http://127.0.0.1:11434".** The model server is not running, or
it is on another port. Start it, run `ollama list` (or LM Studio's local server) to
confirm, and correct the address in Settings.

**A model name is rejected.** Servers are strict about names: Ollama wants `llama3.1:8b`,
not `llama3.1`. Use the model list in the panel to avoid typos.

**Replies stop early.** The longest-reply setting is a ceiling the server enforces. Raise
it, or press *Continue* — the app asks the model to carry on without repeating itself.

**The model is slow or the machine struggles.** Lower the context length and the reply
length. Fewer tokens in the window means less work per message.

**The window is blank.** Start with `LANTERN_DEVTOOLS=1` and read the console; a build
error appears there.

---

## Project layout

```
electron/
  main.js          window, security policy, lifecycle
  preload.js       the only bridge between the interface and the system
  db.js            SQLite schema and every query
  ipc.js           request handling, streaming orchestration
  context.js       context assembly (pure, tested)
  retrieval.js     local passage ranking (pure, tested)
  exporter.js      Markdown and JSON export (pure, tested)
  attachments.js   local text extraction
  llm.js           Ollama and OpenAI-compatible streaming clients
renderer/
  index.html       strict content security policy: no network access at all
  src/App.jsx      session state, streaming events, saving
  src/api.js       typed wrapper over the bridge
  src/components/  sidebar, conversation, messages, composer, settings, memory
  src/styles.css   both themes, system fonts only
tests/             node:test suites for the pure modules
```

Data lives at `%APPDATA%\Lantern\lantern.db` (press **Open folder** in Settings).

---

## Privacy and security

- The interface runs with context isolation, no Node access, a strict Content Security
  Policy and `connect-src 'none'` — it cannot reach the network even in principle.
- Only the main process talks to your model server, and only to the address configured.
- Optional server access keys are encrypted with the Windows credential store
  (DPAPI, via Electron's `safeStorage`), never written in plain text.
- Nothing listens on a port. There is no HTTP server, so there is nothing to expose.
- No analytics, no crash reporting, no remote fonts or assets.
- A backup file includes your stored access keys in their encrypted form; they are bound
  to the Windows account that created them and will not decrypt on another machine.

---

## Licence

MIT for the application code — see `LICENSE`. Third-party packages and their licences are
listed in `THIRD-PARTY-NOTICES.md`. Language models keep their own licences; connecting
this client to a model does not change them.

Nothing here grants exemption from the law, from model licences, or from the limits of
your own hardware. No local model is as capable as the largest hosted ones, and this
client does not pretend otherwise.