import { useEffect, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

export default function ChatSettings({
  chat,
  settings,
  projects,
  onUpdateChat,
  onUpdateSettings,
  onSummarise,
  onClose,
}) {
  const providers = settings.providers || [];
  const [providerId, setProviderId] = useState(chat ? chat.provider : "");
  const [model, setModel] = useState(chat ? chat.model : "");
  const [numCtx, setNumCtx] = useState(chat ? chat.num_ctx : 8192);
  const [numPredict, setNumPredict] = useState(chat ? chat.num_predict : 1024);
  const [temperature, setTemperature] = useState(chat ? chat.temperature : 0.7);
  const [topP, setTopP] = useState(chat ? chat.top_p : 0.9);
  const [instructions, setInstructions] = useState(chat ? chat.instructions : "");
  const [pinned, setPinned] = useState(chat ? chat.pinned : "");
  const [projectId, setProjectId] = useState(chat && chat.project_id ? chat.project_id : "");
  const [contribute, setContribute] = useState(Boolean(chat && chat.contribute));
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [keyValue, setKeyValue] = useState("");

  const provider = providers.find((item) => item.id === providerId) || providers[0];
  const hasKey = (settings.secretProviders || []).includes(provider ? provider.id : "");

  useEffect(() => {
    if (!chat) return;
    const discover = async () => {
      if (!provider) return;
      setBusy(true);
      const result = await api.providers.models({ kind: provider.kind, baseUrl: provider.baseUrl });
      if (result.ok) {
        setModels(result.models);
        setStatus({ ok: true, text: `${result.models.length} model${result.models.length === 1 ? "" : "s"} found` });
      } else {
        setModels([]);
        setStatus({ ok: false, text: result.error });
      }
      setBusy(false);
    };
    discover();
  }, [chat && chat.id, providerId]);

  if (!chat) {
    return (
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Model settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="help">Start a conversation first, then choose the model it should use.</p>
      </aside>
    );
  }

  const apply = (patch) => onUpdateChat(patch);

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <h2>Model and generation</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="field">
        <label htmlFor="provider">Local server</label>
        <select
          id="provider"
          value={providerId}
          onChange={(event) => {
            setProviderId(event.target.value);
            apply({ provider: event.target.value });
          }}
        >
          {providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} — {item.baseUrl}
            </option>
          ))}
        </select>
        <p className="help">Addresses are edited in Settings. Nothing is ever sent anywhere except this address.</p>
      </div>

      <div className="field">
        <label htmlFor="model">Model</label>
        <div className="field-row">
          <select
            id="model"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              apply({ model: event.target.value });
            }}
          >
            <option value="">Choose a model…</option>
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.parameterSize ? ` (${item.parameterSize})` : ""}
              </option>
            ))}
            {model && !models.some((item) => item.id === model) && <option value={model}>{model} (typed)</option>}
          </select>
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              setBusy(true);
              const result = await api.providers.models({ kind: provider.kind, baseUrl: provider.baseUrl });
              if (result.ok) {
                setModels(result.models);
                setStatus({ ok: true, text: `${result.models.length} model${result.models.length === 1 ? "" : "s"} found` });
              } else {
                setStatus({ ok: false, text: result.error });
              }
              setBusy(false);
            }}
          >
            {busy ? "Checking…" : "Refresh"}
          </button>
        </div>
        <input
          type="text"
          value={model}
          placeholder="Or type a model name exactly as the server lists it"
          onChange={(event) => setModel(event.target.value)}
          onBlur={() => apply({ model })}
        />
        {status && <p className={status.ok ? "help ok" : "help bad"}>{status.text}</p>}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="numctx">Context length</label>
          <input
            id="numctx"
            type="number"
            min="512"
            step="512"
            value={numCtx}
            onChange={(event) => setNumCtx(Number(event.target.value))}
            onBlur={() => apply({ num_ctx: Number(numCtx) || 8192 })}
          />
        </div>
        <div className="field">
          <label htmlFor="numpredict">Longest reply</label>
          <input
            id="numpredict"
            type="number"
            min="64"
            step="64"
            value={numPredict}
            onChange={(event) => setNumPredict(Number(event.target.value))}
            onBlur={() => apply({ num_predict: Number(numPredict) || 1024 })}
          />
        </div>
      </div>
      <p className="help">
        The context length is what Lantern asks the model server for. The server still caps it at whatever that model
        was built for, and a larger window uses more memory. The reply length is a ceiling, not a target.
      </p>

      <div className="row">
        <div className="field">
          <label htmlFor="temperature">Temperature · {Number(temperature).toFixed(2)}</label>
          <input
            id="temperature"
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
            onMouseUp={() => apply({ temperature: Number(temperature) })}
          />
        </div>
        <div className="field">
          <label htmlFor="topp">Top-p · {Number(topP).toFixed(2)}</label>
          <input
            id="topp"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={topP}
            onChange={(event) => setTopP(Number(event.target.value))}
            onMouseUp={() => apply({ top_p: Number(topP) })}
          />
        </div>
      </div>

      <div className="divider" />

      <div className="field">
        <label htmlFor="instructions">Instructions for this conversation</label>
        <textarea
          id="instructions"
          rows={3}
          value={instructions}
          placeholder="e.g. You are reviewing a building contract. Be blunt about risks."
          onChange={(event) => setInstructions(event.target.value)}
          onBlur={() => apply({ instructions })}
        />
      </div>

      <div className="field">
        <label htmlFor="pinned">Pinned instructions</label>
        <textarea
          id="pinned"
          rows={2}
          value={pinned}
          placeholder="Always applied, even after the conversation is summarised."
          onChange={(event) => setPinned(event.target.value)}
          onBlur={() => apply({ pinned })}
        />
      </div>

      <div className="field">
        <label htmlFor="project">Project</label>
        <select
          id="project"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            apply({ project_id: event.target.value || null });
          }}
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <label className="switch">
        <input
          type="checkbox"
          checked={contribute}
          onChange={(event) => {
            setContribute(event.target.checked);
            apply({ contribute: event.target.checked });
          }}
        />
        Let this conversation contribute to other chats
      </label>

      <div className="field">
        <label htmlFor="key">Access key (only if your server asks for one)</label>
        <div className="field-row">
          <input
            id="key"
            type="password"
            value={keyValue}
            placeholder={hasKey ? "A key is stored" : "Not set"}
            onChange={(event) => setKeyValue(event.target.value)}
          />
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              if (!keyValue) return;
              await onUpdateSettings({ setSecret: { providerId: provider.id, value: keyValue } });
              setKeyValue("");
            }}
          >
            Save
          </button>
        </div>
        <p className="help">
          {hasKey
            ? "Stored in the Windows credential store, never in the database or a plain file."
            : "Kept by Windows for your account only. Leave empty for Ollama and LM Studio."}
        </p>
      </div>

      <div className="divider" />

      <div className="field">
        <label>Long conversations</label>
        <button type="button" className="button secondary" onClick={onSummarise}>
          Summarise earlier messages now
        </button>
        <p className="help">
          Uses the same local model. Original messages are never deleted — this only changes what the model is shown.
        </p>
      </div>

      {chat.summary && (
        <div className="card">
          <strong className="card-title">Current summary</strong>
          <p className="summary-text">{chat.summary}</p>
        </div>
      )}
    </aside>
  );
}