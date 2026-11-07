export default function ContextMeter({ usage }) {
  if (!usage) return null;
  const percent = Math.min(100, Math.max(2, usage.percentUsed || 0));

  return (
    <details className="meter">
      <summary title="What this model is being shown right now">
        <span className="meter-bar">
          <span className="meter-fill" style={{ width: `${percent}%` }} />
        </span>
        <span>
          {usage.total.toLocaleString("en-AU")} / {usage.budget.toLocaleString("en-AU")}
        </span>
      </summary>
      <div className="meter-panel">
        <div className="meter-row">
          <span>System, preferences and memory</span>
          <strong>{usage.system.toLocaleString("en-AU")}</strong>
        </div>
        <div className="meter-row">
          <span>Recent messages sent</span>
          <strong>{usage.recent.toLocaleString("en-AU")}</strong>
        </div>
        <div className="meter-row">
          <span>Held back for the reply</span>
          <strong>{usage.reserveForReply.toLocaleString("en-AU")}</strong>
        </div>
        <div className="meter-row">
          <span>Earlier messages summarised</span>
          <strong>{usage.summarised ? "Yes" : "No"}</strong>
        </div>
        <div className="meter-row">
          <span>Messages left out of this send</span>
          <strong>{usage.droppedCount}</strong>
        </div>
        <div className="meter-row">
          <span>Retrieved passages</span>
          <strong>{usage.retrievedCount}</strong>
        </div>
        <p className="meter-note">
          Estimates, not exact tokens. Your whole history stays stored — this is only the slice sent to the model
          for this reply.
        </p>
      </div>
    </details>
  );
}