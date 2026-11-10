import { useState } from "react";
import { api } from "../api";

export default function ColibriHelp({ provider, activeProvider, onUpdate }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const testModel = async () => {
    setBusy(true);
    setResult(null);
    try {
      const answer = await api.providers.generateTest({
        providerId: provider.id, kind: provider.kind, baseUrl: provider.baseUrl,
      });
      setResult(answer);
    } catch (error) {
      setResult({ ok: false, error: error.message });
    } finally { setBusy(false); }
  };
  return (
    <div className="colibri-help">
      <p className="help">
        Colibri runs separately on this computer. Start it with an existing, supported model, then test the
        connection and choose its exact model ID in your conversation’s Model settings. Existing chats keep
        their current provider. LM Studio and Ollama remain available.
      </p>
      <details>
        <summary>Start Colibri on Windows</summary>
        <p className="help">From the JustVugg/colibri source folder, with its engine and model already installed:</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{'py -3 c\\coli serve --model "D:\\Models\\your-colibri-model" --host 127.0.0.1 --port 8000'}</pre>
        <p className="help">
          Replace the example model path. The Lantern source also includes scripts/start-colibri.ps1.
          Lantern does not download weights, install Colibri, or alter existing models. Colibri’s supported
          architectures are not the same as LM Studio’s; do not assume a Gemma model is compatible.
          Set COLI_API_KEY in Colibri and save the same key here when authentication is enabled.
        </p>
      </details>
      <div className="provider-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={testModel}>
          {busy ? "Waiting for the local model…" : "Test model response"}
        </button>
        <button type="button" className="button secondary" disabled={activeProvider === provider.id}
          onClick={() => onUpdate({ activeProvider: provider.id, lastModel: "" })}>
          {activeProvider === provider.id ? "Default for new chats" : "Use Colibri for new chats"}
        </button>
      </div>
      <p className="help">The response test sends only a fixed test sentence, not your chats, documents or memories. It stops after three minutes.</p>
      {result && <p role="status" className={result.ok ? "help ok" : "help bad"}>
        {result.ok ? `Model replied (${result.model}, ${(result.elapsedMs / 1000).toFixed(1)} s): ${result.text}` : result.error}
      </p>}
    </div>
  );
}
