import { useEffect, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

export default function SettingsView({ settings, info, onUpdate }) {
  const [providers, setProviders] = useState(settings.providers || []);
  const [instructions, setInstructions] = useState(settings.assistantInstructions || "");
  const [keyInputs, setKeyInputs] = useState({});
  const [testResults, setTestResults] = useState({});
  const [status, setStatus] = useState(null);
  const [retrieval, setRetrieval] = useState(settings.retrieval || { enabled: true, limit: 6, otherChats: false });

  useEffect(() => {
    setProviders(settings.providers || []);
    setInstructions(settings.assistantInstructions || "");
    setRetrieval(settings.retrieval || { enabled: true, limit: 6, otherChats: false });
  }, [settings]);

  const updateProvider = (id, patch) => {
    setProviders((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const testConnection = async (provider) => {
    setTestResults((previous) => ({ ...previous, [provider.id]: { pending: true } }));
    const result = await api.providers.test({ kind: provider.kind, baseUrl: provider.baseUrl });
    setTestResults((previous) => ({
      ...previous,
      [provider.id]: result.ok
        ? { ok: true, text: `Connected. ${result.count} model${result.count === 1 ? "" : "s"} available.` }
        : { ok: false, text: result.error },
    }));
  };

  const runDataAction = async (action) => {
    setStatus(null);
    try {
      if (action === "backup") {
        const result = await api.data.backup();
        if (result.saved) setStatus(`Backed up ${result.chats} chats to ${result.path}`);
      }
      if (action === "restore") {
        const result = await api.data.restore();
        if (result.restored) {
          setStatus("Backup restored. Reloading…");
          window.setTimeout(() => window.location.reload(), 600);
        }
      }
      if (action === "clear") {
        const result = await api.data.clearAll();
        if (result.cleared) {
          setStatus("All local data deleted. Reloading…");
          window.setTimeout(() => window.location.reload(), 600);
        }
      }
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <h1>Settings</h1>
          <p>
            Everything on this page is stored in a single file on this computer. There is no account, no sync and no
            telemetry — the interface has no network access at all, and only the main process speaks to the model
            server you configure.
          </p>
        </div>

        {status && <div className="card status-card">{status}</div>}

        <section className="section">
          <h2>Appearance</h2>
          <p className="intro">Follow Windows, or pin a theme.</p>
          <div className="tabs">
            {["system", "light", "dark"].map((option) => (
              <button
                key={option}
                type="button"
                className={`tab ${settings.theme === option ? "is-active" : ""}`}
                onClick={() => onUpdate({ theme: option })}
              >
                {option === "system" ? "Match Windows" : option === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>Assistant instructions</h2>
          <p className="intro">
            Sent with every conversation, before any saved preferences. Keep it short — everything here costs context
            space in every message.
          </p>
          <textarea
            rows={5}
            className="wide-textarea"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <button type="button" className="button" onClick={() => onUpdate({ assistantInstructions: instructions })}>
            <Icon name="check" size={14} />
            Save instructions
          </button>
        </section>

        <section className="section">
          <h2>Local model servers</h2>
          <p className="intro">
            Only localhost addresses are useful here, and only the servers above are contacted. Nothing is ever
            installed, moved or downloaded by Lantern.
          </p>

          {providers.map((provider) => {
            const result = testResults[provider.id];
            const hasKey = (settings.secretProviders || []).includes(provider.id);
            return (
              <div className="card provider-card" key={provider.id}>
                <div className="provider-head">
                  <strong>{provider.label}</strong>
                  <span className="help">{provider.kind === "ollama" ? "Ollama API" : "OpenAI-compatible"}</span>
                </div>

                <div className="row">
                  <div className="field">
                    <label htmlFor={`base-${provider.id}`}>Address</label>
                    <input
                      id={`base-${provider.id}`}
                      type="text"
                      value={provider.baseUrl}
                      onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`kind-${provider.id}`}>Protocol</label>
                    <select
                      id={`kind-${provider.id}`}
                      value={provider.kind}
                      onChange={(event) => updateProvider(provider.id, { kind: event.target.value })}
                    >
                      <option value="ollama">Ollama</option>
                      <option value="openai">OpenAI-compatible (LM Studio, llama.cpp, …)</option>
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor={`key-${provider.id}`}>Access key (optional)</label>
                  <div className="field-row">
                    <input
                      id={`key-${provider.id}`}
                      type="password"
                      value={keyInputs[provider.id] || ""}
                      placeholder={hasKey ? "A key is stored in Windows" : "Not set"}
                      onChange={(event) =>
                        setKeyInputs((previous) => ({ ...previous, [provider.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="button secondary"
                      onClick={async () => {
                        const value = keyInputs[provider.id];
                        if (!value) return;
                        await onUpdate({ setSecret: { providerId: provider.id, value } });
                        setKeyInputs((previous) => ({ ...previous, [provider.id]: "" }));
                      }}
                    >
                      Save
                    </button>
                    {hasKey && (
                      <button
                        type="button"
                        className="button danger"
                        onClick={() => onUpdate({ clearSecret: { providerId: provider.id } })}
                      >
                        Forget
                      </button>
                    )}
                  </div>
                </div>

                <div className="provider-actions">
                  <button type="button" className="button" onClick={() => onUpdate({ providers })}>
                    Save addresses
                  </button>
                  <button type="button" className="button secondary" onClick={() => testConnection(provider)}>
                    {result && result.pending ? "Testing…" : "Test connection"}
                  </button>
                </div>

                {result && !result.pending && (
                  <p className={result.ok ? "help ok" : "help bad"}>{result.text}</p>
                )}
              </div>
            );
          })}
        </section>

        <section className="section">
          <h2>Long conversations</h2>
          <p className="intro">
            Stored history is unlimited — only the model window is limited. These settings control how Lantern fills
            that window.
          </p>

          <label className="switch">
            <input
              type="checkbox"
              checked={retrieval.enabled !== false}
              onChange={(event) => setRetrieval({ ...retrieval, enabled: event.target.checked })}
            />
            Retrieve relevant passages from my own past messages
          </label>

          <label className="switch">
            <input
              type="checkbox"
              checked={Boolean(retrieval.otherChats)}
              onChange={(event) => setRetrieval({ ...retrieval, otherChats: event.target.checked })}
            />
            Allow other chats (marked as contributing) to supply passages
          </label>

          <div className="field">
            <label htmlFor="retrieval-limit">Passages per reply · {retrieval.limit}</label>
            <input
              id="retrieval-limit"
              type="range"
              min="1"
              max="12"
              step="1"
              value={retrieval.limit}
              onChange={(event) => setRetrieval({ ...retrieval, limit: Number(event.target.value) })}
            />
          </div>

          <div className="field">
            <label htmlFor="summarise-at">Summarise when the window is {Math.round(settings.summariseAt * 100)}% full</label>
            <input
              id="summarise-at"
              type="range"
              min="0.4"
              max="0.9"
              step="0.05"
              value={settings.summariseAt}
              onChange={(event) => onUpdate({ summariseAt: Number(event.target.value) })}
            />
          </div>

          <button type="button" className="button" onClick={() => onUpdate({ retrieval })}>
            <Icon name="check" size={14} />
            Save context settings
          </button>
        </section>

        <section className="section">
          <h2>Your data</h2>
          <p className="intro">
            One database file, plus whatever you export. Backups are a single readable JSON file you can keep anywhere.
          </p>

          <div className="card">
            <p className="help">
              <strong>Location:</strong> {info ? info.dataPath : "…"}
            </p>
            <div className="provider-actions">
              <button type="button" className="button secondary" onClick={() => api.app.openDataFolder()}>
                <Icon name="folder" size={14} />
                Open folder
              </button>
              <button type="button" className="button secondary" onClick={() => runDataAction("backup")}>
                <Icon name="download" size={14} />
                Back up everything
              </button>
              <button type="button" className="button secondary" onClick={() => runDataAction("restore")}>
                Restore a backup
              </button>
              <button type="button" className="button danger" onClick={() => runDataAction("clear")}>
                <Icon name="trash" size={14} />
                Delete all local data
              </button>
            </div>
          </div>
        </section>

        <section className="section">
          <h2>About this build</h2>
          <p className="intro">
            Lantern {info ? info.version : ""} · Electron {info ? info.electron : ""} · Node {info ? info.node : ""} ·{" "}
            {info ? info.platform : ""}
          </p>
          <p className="help">
            Credential storage: {info && info.encryptedStore ? "available (Windows credential store)" : "unavailable on this system"}. No
            telemetry, no analytics, no remote assets, no cloud fallback. Response quality is entirely the model you
            chose and the hardware it runs on — no local model is as capable as the largest hosted ones, and none of
            them is claimed to be.
          </p>
        </section>
      </div>
    </div>
  );
}