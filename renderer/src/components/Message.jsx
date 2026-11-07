import { useState } from "react";
import Markdown from "./Markdown";
import Icon from "./Icon";

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Message({
  message,
  streamingText,
  isStreaming,
  canRegenerate,
  canContinue,
  onEdit,
  onRegenerate,
  onContinue,
  onDelete,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [copied, setCopied] = useState(false);

  const isUser = message.role === "user";
  const body = isStreaming ? streamingText : message.content;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (_error) {
      setCopied(false);
    }
  };

  const saveEdit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== message.content) await onEdit(message.id, next);
  };

  return (
    <article className={`msg ${isUser ? "msg-user" : "msg-assistant"}`}>
      <div className={`msg-avatar ${isUser ? "user" : ""}`}>{isUser ? "You" : "L"}</div>
      <div className="msg-main">
        <div className="msg-role">
          {isUser ? "You" : "Assistant"}
          {message.edited_at ? " · edited" : ""}
          {message.model && !isUser ? ` · ${message.model}` : ""}
        </div>

        {editing ? (
          <div className="msg-edit">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={6} />
            <div className="msg-edit-actions">
              <button type="button" className="button" onClick={saveEdit}>
                Save and resend
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="msg-body">
            {body ? <Markdown>{body}</Markdown> : isStreaming ? <span className="thinking">Contacting your model…</span> : null}
            {isStreaming && <span className="caret" />}
          </div>
        )}

        {!editing && message.attachments && message.attachments.length > 0 && (
          <div className="msg-attachments">
            {message.attachments.map((file) => (
              <span className="attach-chip" key={file.id}>
                <Icon name="clip" size={11} />
                {file.name}
                <span className="attach-size">{formatBytes(file.size)}</span>
              </span>
            ))}
          </div>
        )}

        {!editing && (
          <div className="msg-actions">
            <button type="button" onClick={copy} title="Copy this message">
              <Icon name={copied ? "check" : "copy"} size={12} />
              {copied ? "Copied" : "Copy"}
            </button>
            {isUser && (
              <button type="button" onClick={() => setEditing(true)} title="Edit and resend">
                <Icon name="edit" size={12} />
                Edit
              </button>
            )}
            {!isUser && canRegenerate && (
              <button type="button" onClick={onRegenerate} title="Ask again from the last message">
                <Icon name="refresh" size={12} />
                Regenerate
              </button>
            )}
            {!isUser && canContinue && !isStreaming && (
              <button type="button" onClick={onContinue} title="Continue this answer">
                <Icon name="arrow" size={12} />
                Continue
              </button>
            )}
            <button type="button" onClick={() => onDelete(message.id)} title="Delete this message">
              <Icon name="trash" size={12} />
              Delete
            </button>
          </div>
        )}
      </div>
    </article>
  );
}