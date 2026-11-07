import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

export default function Composer({ onSend, onStop, streaming, placeholder }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [working, setWorking] = useState(false);
  const areaRef = useRef(null);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 240)}px`;
  }, [text]);

  const attach = async () => {
    setFileError(null);
    try {
      const result = await api.files.pick();
      if (result.files.length) {
        setAttachments((previous) => [...previous, ...result.files]);
      }
      if (result.errors.length) {
        setFileError(result.errors.map((item) => `${item.name}: ${item.error}`).join(" "));
      }
    } catch (error) {
      setFileError(error.message);
    }
  };

  const submit = async () => {
    if (streaming || working) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    setWorking(true);
    const sentAttachments = attachments;
    setText("");
    setAttachments([]);
    try {
      const accepted = await onSend(value, sentAttachments);
      if (accepted === false) {
        setText(value);
        setAttachments(sentAttachments);
      }
    } finally {
      setWorking(false);
      if (areaRef.current) areaRef.current.focus();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        {fileError && <p className="composer-error">{fileError}</p>}

        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((file, index) => (
              <span className="attach-chip" key={`${file.name}-${index}`}>
                <Icon name="clip" size={11} />
                {file.name}
                <button
                  type="button"
                  onClick={() => setAttachments((previous) => previous.filter((_item, i) => i !== index))}
                  aria-label={`Remove ${file.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          placeholder={placeholder || "Message your local model…"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />

        <div className="composer-bar">
          <button type="button" className="icon-btn" onClick={attach} title="Attach a file (stays on this computer)">
            <Icon name="clip" size={16} />
          </button>
          <span className="composer-hint">Enter sends · Shift+Enter for a new line</span>
          {streaming ? (
            <button type="button" className="stop-btn" onClick={onStop} title="Stop generating">
              <Icon name="stop" size={13} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="send-btn"
              onClick={submit}
              disabled={working || (!text.trim() && attachments.length === 0)}
              title="Send"
            >
              <Icon name="send" size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}