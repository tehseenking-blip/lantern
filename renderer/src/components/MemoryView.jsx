import { useMemo, useState } from "react";
import Icon from "./Icon";

const KINDS = [
  { id: "preference", label: "Preferences", hint: "How you want answers written, applied in every chat." },
  { id: "fact", label: "Facts about me", hint: "Details worth remembering everywhere." },
  { id: "detail", label: "Conversation details", hint: "Temporary details tied to one chat." },
];

export default function MemoryView({ memories, chats, onCreate, onUpdate, onDelete }) {
  const [kind, setKind] = useState("preference");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [chatId, setChatId] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  const activeKind = KINDS.find((item) => item.id === kind);

  const superseded = useMemo(() => {
    const preferences = memories.filter((item) => item.kind === "preference");
    const newestByTitle = new Map();
    for (const item of [...preferences].sort((a, b) => b.updated_at - a.updated_at)) {
      const key = String(item.title || item.content || "").trim().toLowerCase();
      if (!newestByTitle.has(key)) newestByTitle.set(key, item.id);
    }
    const result = new Map();
    for (const item of preferences) {
      const key = String(item.title || item.content || "").trim().toLowerCase();
      const winner = newestByTitle.get(key);
      if (winner !== item.id) result.set(item.id, winner);
    }
    return result;
  }, [memories]);

  const visible = memories.filter((item) => item.kind === kind);

  const submit = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    await onCreate({ kind, title: title.trim(), content: content.trim(), chat_id: kind === "detail" ? chatId || null : null });
    setTitle("");
    setContent("");
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <h1>Memory and preferences</h1>
          <p>
            Three different things, kept apart on purpose. Preferences shape how you want answers written. Facts are
            details about you worth remembering. Conversation details are temporary and only apply to one chat. Every
            one of them is visible here, and every one can be paused or deleted.
          </p>
        </div>

        <div className="tabs" role="tablist">
          {KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={kind === item.id}
              className={`tab ${kind === item.id ? "is-active" : ""}`}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <p className="section-note">{activeKind.hint}</p>

        <form className="card form" onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label htmlFor="memory-title">Label (optional)</label>
              <input
                id="memory-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={kind === "preference" ? "e.g. Length" : "Short name"}
              />
            </div>
            {kind === "detail" && (
              <div className="field">
                <label htmlFor="memory-chat">Conversation</label>
                <select id="memory-chat" value={chatId} onChange={(event) => setChatId(event.target.value)}>
                  <option value="">Any conversation</option>
                  {chats.map((chat) => (
                    <option key={chat.id} value={chat.id}>
                      {chat.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="memory-content">
              {kind === "preference" ? "What should change about answers?" : "What should be remembered?"}
            </label>
            <textarea
              id="memory-content"
              rows={3}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={
                kind === "preference"
                  ? "Keep answers to three sentences unless I ask for detail."
                  : "I work in Australian English and prefer metric units."
              }
            />
          </div>
          <button type="submit" className="button" disabled={!content.trim()}>
            <Icon name="plus" size={14} />
            Add
          </button>
          {kind === "preference" && (
            <p className="help">
              Two preferences with the same label: the newer one is used and the older one is ignored. Anything you
              say in a chat outranks both.
            </p>
          )}
        </form>

        <div className="memory-list">
          {visible.length === 0 && <p className="empty-note">Nothing saved here yet.</p>}
          {visible.map((item) => {
            const chat = chats.find((entry) => entry.id === item.chat_id);
            const isSuperseded = superseded.has(item.id);
            return (
              <div className="memory-row" key={item.id}>
                <div className="memory-row-head">
                  <span className="memory-kind">{item.kind}</span>
                  {item.title && <strong className="memory-title">{item.title}</strong>}
                  {isSuperseded && <span className="badge">superseded by a newer one</span>}
                  {!item.enabled && <span className="badge">paused</span>}
                  {chat && <span className="badge">{chat.title}</span>}
                </div>

                {editingId === item.id ? (
                  <div className="memory-edit">
                    <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} />
                    <div className="msg-edit-actions">
                      <button
                        type="button"
                        className="button"
                        onClick={async () => {
                          await onUpdate(item.id, { content: draft.trim() });
                          setEditingId(null);
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="button secondary" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="memory-content">{item.content}</p>
                )}

                <div className="msg-actions">
                  <button type="button" onClick={() => onUpdate(item.id, { enabled: !item.enabled })}>
                    <Icon name={item.enabled ? "check" : "plus"} size={12} />
                    {item.enabled ? "Pause" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(item.id);
                      setDraft(item.content);
                    }}
                  >
                    <Icon name="edit" size={12} />
                    Edit
                  </button>
                  <button type="button" onClick={() => onDelete(item.id)}>
                    <Icon name="trash" size={12} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}