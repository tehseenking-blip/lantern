import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import MemoryView from "./components/MemoryView";
import SettingsView from "./components/SettingsView";

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
  const [info, setInfo] = useState(null);
  const [chats, setChats] = useState([]);
  const [projects, setProjects] = useState([]);
  const [memories, setMemories] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(null);
  const [view, setView] = useState("chat");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const refreshChats = useCallback(async () => {
    setChats(await api.chats.list({}));
  }, []);

  const openChat = useCallback(async (chatId) => {
    const [nextChat, nextMessages] = await Promise.all([api.chats.get(chatId), api.messages.list(chatId)]);
    setActiveChatId(chatId);
    setChat(nextChat);
    setMessages(nextMessages);
    setStreaming(null);
    setView("chat");
    api.settings.update({ lastChatId: chatId }).then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextSettings, nextProjects, nextChats, nextMemories, appInfo] = await Promise.all([
          api.settings.get(),
          api.projects.list(),
          api.chats.list({}),
          api.memories.list({}),
          api.app.info(),
        ]);
        if (cancelled) return;
        setSettings(nextSettings);
        setProjects(nextProjects);
        setChats(nextChats);
        setMemories(nextMemories);
        setInfo(appInfo);
        const preferred =
          nextSettings.lastChatId && nextChats.some((item) => item.id === nextSettings.lastChatId)
            ? nextSettings.lastChatId
            : nextChats[0] && nextChats[0].id;
        if (preferred) await openChat(preferred);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openChat]);

  useEffect(() => {
    if (!settings) return undefined;
    const root = document.documentElement;
    const apply = () => {
      const dark =
        settings.theme === "dark" ||
        (settings.theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    if (settings.theme !== "system") return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [settings]);

  useEffect(() => {
    const unsubscribe = api.stream.onEvent((event) => {
      if (event.type === "delta") {
        setStreaming((previous) =>
          previous && previous.streamId === event.streamId
            ? { ...previous, text: previous.text + event.delta }
            : previous,
        );
        return;
      }
      if (event.type === "done") {
        setMessages((previous) =>
          previous.map((message) => (message.id === event.message.id ? event.message : message)),
        );
        setStreaming(null);
        refreshChats();
        return;
      }
      if (event.type === "error") {
        setError(event.error);
        if (event.message) {
          setMessages((previous) =>
            previous.map((message) => (message.id === event.message.id ? event.message : message)),
          );
        } else if (event.assistantId) {
          setMessages((previous) => previous.filter((message) => message.id !== event.assistantId));
        }
        setStreaming(null);
        return;
      }
      if (event.type === "notice") setNotice(event.text);
    });
    return unsubscribe;
  }, [refreshChats]);

  const filteredChats = useMemo(() => {
    const term = search.trim().toLowerCase();
    return chats.filter((item) => {
      if (projectFilter && item.project_id !== projectFilter) return false;
      if (!term) return true;
      return (
        String(item.title || "").toLowerCase().includes(term) ||
        String(item.preview || "").toLowerCase().includes(term)
      );
    });
  }, [chats, search, projectFilter]);

  const startFromResult = useCallback(
    async (chatId, result) => {
      const fresh = await api.messages.list(chatId);
      setMessages(fresh);
      setStreaming({
        streamId: result.streamId,
        assistantId: result.assistantMessage.id,
        chatId,
        text: "",
        usage: result.usage,
      });
      if (result.notice) setNotice(result.notice);
      refreshChats();
    },
    [refreshChats],
  );

  const handleNewChat = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const created = await api.chats.create({ projectId: projectFilter });
      setChats((previous) => [created, ...previous]);
      setActiveChatId(created.id);
      setChat(created);
      setMessages([]);
      setStreaming(null);
      setView("chat");
    } catch (createError) {
      setError(createError.message);
    }
  }, [projectFilter]);

  const handleSend = useCallback(
    async (text, attachments) => {
      setError(null);
      try {
        let target = chat;
        if (!target || !activeChatId) {
          target = await api.chats.create({ projectId: projectFilter });
          setChat(target);
          setActiveChatId(target.id);
          setMessages([]);
          setChats((previous) => [target, ...previous]);
        }
        if (!target.model) {
          setError("This conversation has no model yet. Choose one in the model panel first.");
          return false;
        }
        const result = await api.messages.send({ chatId: target.id, content: text, attachments });
        await startFromResult(target.id, result);
        const refreshed = await api.chats.get(target.id);
        setChat(refreshed);
        return true;
      } catch (sendError) {
        setError(sendError.message);
        return false;
      }
    },
    [activeChatId, chat, projectFilter, startFromResult],
  );

  const handleStop = useCallback(async () => {
    if (!streaming) return;
    await api.messages.stop(streaming.streamId);
  }, [streaming]);

  const handleRegenerate = useCallback(async () => {
    if (!activeChatId) return;
    setError(null);
    try {
      const result = await api.messages.regenerate(activeChatId);
      await startFromResult(activeChatId, result);
    } catch (regenerateError) {
      setError(regenerateError.message);
    }
  }, [activeChatId, startFromResult]);

  const handleContinue = useCallback(async () => {
    if (!activeChatId) return;
    setError(null);
    try {
      const result = await api.messages.continue(activeChatId);
      await startFromResult(activeChatId, result);
    } catch (continueError) {
      setError(continueError.message);
    }
  }, [activeChatId, startFromResult]);

  const handleEdit = useCallback(
    async (messageId, content) => {
      setError(null);
      try {
        const result = await api.messages.edit({ messageId, content });
        await startFromResult(result.chatId, result);
        setChat(await api.chats.get(result.chatId));
      } catch (editError) {
        setError(editError.message);
      }
    },
    [startFromResult],
  );

  const handleDeleteMessage = useCallback(async (messageId) => {
    await api.messages.remove(messageId);
    setMessages((previous) => previous.filter((message) => message.id !== messageId));
    await refreshChats();
  }, [refreshChats]);

  const handleSummarise = useCallback(async () => {
    if (!activeChatId) return;
    setError(null);
    try {
      const result = await api.messages.summarise(activeChatId);
      setNotice(
        `Summarised ${result.count} earlier messages using your local model. They are still stored in full and can ` +
          "be exported at any time.",
      );
      setChat(await api.chats.get(activeChatId));
      setMessages(await api.messages.list(activeChatId));
    } catch (summariseError) {
      setError(summariseError.message);
    }
  }, [activeChatId]);

  const updateChat = useCallback(
    async (patch) => {
      if (!activeChatId) return;
      const updated = await api.chats.update({ chatId: activeChatId, patch });
      setChat(updated);
      if (patch.model) setSettings((previous) => ({ ...previous, lastModel: patch.model }));
      await refreshChats();
    },
    [activeChatId, refreshChats],
  );

  const updateSettings = useCallback(async (patch) => {
    const next = await api.settings.update(patch);
    setSettings(next);
  }, []);

  const handleDeleteChat = useCallback(
    async (chatId) => {
      await api.chats.remove(chatId);
      const remaining = chats.filter((item) => item.id !== chatId);
      setChats(remaining);
      if (activeChatId === chatId) {
        if (remaining[0]) await openChat(remaining[0].id);
        else {
          setActiveChatId(null);
          setChat(null);
          setMessages([]);
        }
      }
      setMemories(await api.memories.list({}));
    },
    [activeChatId, chats, openChat],
  );

  const handleExportChat = useCallback(async (chatId, format) => {
    try {
      const result = await api.chats.exportChat({ chatId, format });
      if (result.saved) setNotice(`Conversation exported to ${result.path}`);
    } catch (exportError) {
      setError(exportError.message);
    }
  }, []);

  const handleCreateProject = useCallback(async (name) => {
    const project = await api.projects.create({ name });
    setProjects((previous) => [project, ...previous]);
    return project;
  }, []);

  const handleDeleteProject = useCallback(
    async (projectId) => {
      await api.projects.remove(projectId);
      setProjects(await api.projects.list({}));
      if (projectFilter === projectId) setProjectFilter(null);
      await refreshChats();
    },
    [projectFilter, refreshChats],
  );

  const handleCreateMemory = useCallback(async (payload) => {
    await api.memories.create(payload);
    setMemories(await api.memories.list({}));
  }, []);

  const handleUpdateMemory = useCallback(async (memoryId, patch) => {
    await api.memories.update({ memoryId, patch });
    setMemories(await api.memories.list({}));
  }, []);

  const handleDeleteMemory = useCallback(async (memoryId) => {
    await api.memories.remove(memoryId);
    setMemories(await api.memories.list({}));
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        handleNewChat();
      }
      if (event.key === "Escape" && streaming) handleStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNewChat, handleStop, streaming]);

  if (!ready || !settings) {
    return (
      <div className="boot">
        <div className="boot-mark">L</div>
        <p>Opening your local library…</p>
      </div>
    );
  }

  const activeProvider = (settings.providers || []).find((item) => item.id === (chat && chat.provider));

  return (
    <div className="app">
      <Sidebar
        chats={filteredChats}
        projects={projects}
        activeChatId={activeChatId}
        activeProjectId={projectFilter}
        search={search}
        onSearch={setSearch}
        onProjectFilter={setProjectFilter}
        onNewChat={handleNewChat}
        onSelectChat={openChat}
        onDeleteChat={handleDeleteChat}
        onExportChat={handleExportChat}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        view={view}
        onView={setView}
        modelLabel={(chat && chat.model) || settings.lastModel || "No model selected"}
        providerLabel={activeProvider ? activeProvider.label : "No server"}
      />

      <main className="main">
        {error && (
          <div className="banner banner-error" role="alert">
            <span>{error}</span>
            <button type="button" className="banner-close" onClick={() => setError(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
        {notice && (
          <div className="banner banner-notice">
            <span>{notice}</span>
            <button type="button" className="banner-close" onClick={() => setNotice(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {view === "chat" && (
          <ChatView
            chat={chat}
            messages={messages}
            streaming={streaming}
            settings={settings}
            projects={projects}
            onSend={handleSend}
            onStop={handleStop}
            onRegenerate={handleRegenerate}
            onContinue={handleContinue}
            onEdit={handleEdit}
            onDeleteMessage={handleDeleteMessage}
            onUpdateChat={updateChat}
            onUpdateSettings={updateSettings}
            onSummarise={handleSummarise}
            onNewChat={handleNewChat}
          />
        )}

        {view === "memory" && (
          <MemoryView
            memories={memories}
            chats={chats}
            onCreate={handleCreateMemory}
            onUpdate={handleUpdateMemory}
            onDelete={handleDeleteMemory}
          />
        )}

        {view === "settings" && (
          <SettingsView settings={settings} info={info} onUpdate={updateSettings} />
        )}
      </main>
    </div>
  );
}