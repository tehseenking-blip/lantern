import { useState } from "react";
import Icon from "./Icon";

function relativeDate(value) {
  if (!value) return "";
  const then = new Date(value);
  return then.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default function Sidebar({
  chats,
  projects,
  activeChatId,
  activeProjectId,
  search,
  onSearch,
  onProjectFilter,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onExportChat,
  onCreateProject,
  onDeleteProject,
  view,
  onView,
  modelLabel,
  providerLabel,
}) {
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");

  const submitProject = async (event) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) {
      setCreatingProject(false);
      return;
    }
    await onCreateProject(name);
    setProjectName("");
    setCreatingProject(false);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <span className="brand-mark">L</span>
          <span>
            <span className="brand-name">Lantern</span>
            <span className="brand-sub">Local chat</span>
          </span>
        </div>

        <button type="button" className="new-chat" onClick={onNewChat}>
          <Icon name="plus" size={15} />
          New chat
        </button>

        <label className="search">
          <Icon name="search" size={14} />
          <input
            type="text"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search your chats"
            aria-label="Search chats"
          />
        </label>
      </div>

      <div className="side-section">
        <div className="side-label">
          <span>Projects</span>
          <button
            type="button"
            className="icon-btn"
            title="New project"
            onClick={() => setCreatingProject((previous) => !previous)}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>

        {creatingProject && (
          <form className="inline-form" onSubmit={submitProject}>
            <input
              autoFocus
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
              onBlur={submitProject}
            />
          </form>
        )}

        <div className="project-list">
          <button
            type="button"
            className={`project-chip ${activeProjectId ? "" : "is-active"}`}
            onClick={() => onProjectFilter(null)}
          >
            All chats
          </button>
          {projects.map((project) => (
            <span key={project.id} className={`project-chip ${activeProjectId === project.id ? "is-active" : ""}`}>
              <button type="button" onClick={() => onProjectFilter(project.id)}>
                <Icon name="folder" size={12} />
                {project.name}
              </button>
              <button
                type="button"
                className="chip-remove"
                title="Delete project (chats are kept)"
                onClick={() => onDeleteProject(project.id)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="chat-list">
        {chats.length === 0 && <p className="list-note">{search ? "No chats match that search." : "No chats yet."}</p>}
        {chats.map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            className={`chat-item ${activeChatId === item.id && view === "chat" ? "is-active" : ""}`}
            onClick={() => onSelectChat(item.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectChat(item.id);
              }
            }}
          >
            <div className="chat-item-main">
              <div className="chat-title">{item.title}</div>
              <div className="chat-meta">
                {relativeDate(item.updated_at)} · {item.message_count} message{item.message_count === 1 ? "" : "s"}
              </div>
            </div>
            <div className="chat-item-actions">
              <button
                type="button"
                className="icon-btn"
                title="Export as Markdown"
                onClick={(event) => {
                  event.stopPropagation();
                  onExportChat(item.id, "markdown");
                }}
              >
                <Icon name="download" size={13} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Delete chat"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteChat(item.id);
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="side-foot">
        <button
          type="button"
          className={`foot-btn ${view === "memory" ? "is-active" : ""}`}
          onClick={() => onView("memory")}
        >
          <Icon name="book" size={15} />
          Memory and preferences
        </button>
        <button
          type="button"
          className={`foot-btn ${view === "settings" ? "is-active" : ""}`}
          onClick={() => onView("settings")}
        >
          <Icon name="gear" size={15} />
          Settings
        </button>
      </div>

      <div className="status">
        <span className={`status-dot ${modelLabel && modelLabel !== "No model selected" ? "is-on" : ""}`} />
        <span className="status-text">
          {providerLabel} · {modelLabel}
        </span>
      </div>
    </aside>
  );
}