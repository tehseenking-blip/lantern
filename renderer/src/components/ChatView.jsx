import { useEffect, useState } from "react";
import { api } from "../api";
import Composer from "./Composer";
import ContextMeter from "./ContextMeter";
import ChatSettings from "./ChatSettings";
import Icon from "./Icon";
import Message from "./Message";

const SUGGESTIONS = [
  "Summarise a long document I paste in, and keep the numbers exact.",
  "Draft a professional email in Australian English.",
  "Explain a difficult idea in plain language, using a table.",
  "Compare two options and tell me which you would choose.",
];

export default function ChatView({
  chat,
  messages,
  streaming,
  settings,
  projects,
  onSend,
  onStop,
  onRegenerate,
  onContinue,
  onEdit,
  onDeleteMessage,
  onUpdateChat,
  onUpdateSettings,
  onSummarise,
  onNewChat,
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (!chat) {
      setUsage(null);
      return undefined;
    }
    let cancelled = false;
    api.messages
      .usage(chat.id)
      .then((next) => {
        if (!cancelled) setUsage(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chat && chat.id, messages.length]);

  const effectiveUsage = (streaming && streaming.usage) || usage;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");

  return (
    <section className="chat">
      <header className="chat-head">
        <h1 className="chat-title">{chat ? chat.title : "A new conversation"}</h1>
        <div className="chat-head-right">
          <ContextMeter usage={effectiveUsage} />
          <button type="button" className="pill" onClick={() => setPanelOpen(true)} title="Model and generation settings">
            <Icon name="sliders" size={13} />
            <span className="pill-text">{chat && chat.model ? chat.model : "Choose a model"}</span>
          </button>
          <button type="button" className="icon-btn" onClick={onNewChat} title="New chat (Ctrl+N)">
            <Icon name="plus" size={16} />
          </button>
        </div>
      </header>

      <div className="thread">
        <div className="thread-inner">
          {chat && !chat.model && (
            <div className="callout">
              <Icon name="warn" size={16} />
              <div>
                <strong>No model chosen for this conversation.</strong> Lantern will not guess or reach for an
                online service — pick one from the server you run.
                <button type="button" className="button" onClick={() => setPanelOpen(true)}>
                  Choose a model
                </button>
              </div>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="empty">
              <div className="empty-mark">L</div>
              <h2>Off the network, on your desk.</h2>
              <p>
                Everything typed here stays in a file on this computer. Replies come from the local model server you
                configured, so how good they are depends on that model and on your hardware.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="suggestion"
                    onClick={() => onSend(suggestion, [])}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <Message
                key={message.id}
                message={message}
                isStreaming={Boolean(streaming && streaming.assistantId === message.id)}
                streamingText={streaming && streaming.assistantId === message.id ? streaming.text : ""}
                canRegenerate={Boolean(lastAssistant && lastAssistant.id === message.id && !streaming)}
                canContinue={Boolean(lastAssistant && lastAssistant.id === message.id)}
                onEdit={onEdit}
                onRegenerate={onRegenerate}
                onContinue={onContinue}
                onDelete={onDeleteMessage}
              />
            ))
          )}
        </div>
      </div>

      <Composer onSend={onSend} onStop={onStop} streaming={Boolean(streaming)} />

      {panelOpen && (
        <>
          <button type="button" className="scrim" aria-label="Close settings" onClick={() => setPanelOpen(false)} />
          <ChatSettings
            chat={chat}
            settings={settings}
            projects={projects}
            onUpdateChat={onUpdateChat}
            onUpdateSettings={onUpdateSettings}
            onSummarise={onSummarise}
            onClose={() => setPanelOpen(false)}
          />
        </>
      )}
    </section>
  );
}