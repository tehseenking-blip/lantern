"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("lantern", {
  app: {
    info: () => invoke("app:info"),
    openDataFolder: () => invoke("app:openDataFolder"),
  },
  settings: {
    get: () => invoke("settings:get"),
    update: (patch) => invoke("settings:update", patch),
  },
  providers: {
    test: (config) => invoke("providers:test", config),
    models: (config) => invoke("providers:models", config),
  },
  chats: {
    list: (query) => invoke("chats:list", query),
    get: (chatId) => invoke("chats:get", chatId),
    create: (payload) => invoke("chats:create", payload),
    update: (payload) => invoke("chats:update", payload),
    remove: (chatId) => invoke("chats:remove", chatId),
    exportChat: (payload) => invoke("chats:export", payload),
  },
  projects: {
    list: () => invoke("projects:list"),
    create: (payload) => invoke("projects:create", payload),
    update: (payload) => invoke("projects:update", payload),
    remove: (projectId) => invoke("projects:remove", projectId),
  },
  messages: {
    list: (chatId) => invoke("messages:list", chatId),
    usage: (chatId) => invoke("messages:usage", chatId),
    send: (payload) => invoke("messages:send", payload),
    stop: (streamId) => invoke("messages:stop", streamId),
    edit: (payload) => invoke("messages:edit", payload),
    regenerate: (chatId) => invoke("messages:regenerate", chatId),
    continue: (chatId) => invoke("messages:continue", chatId),
    summarise: (chatId) => invoke("messages:summarise", chatId),
    remove: (messageId) => invoke("messages:remove", messageId),
    setContent: (payload) => invoke("messages:setContent", payload),
  },
  memories: {
    list: (query) => invoke("memories:list", query),
    create: (payload) => invoke("memories:create", payload),
    update: (payload) => invoke("memories:update", payload),
    remove: (memoryId) => invoke("memories:remove", memoryId),
  },
  files: {
    pick: () => invoke("files:pick"),
  },
  data: {
    backup: () => invoke("data:backup"),
    restore: () => invoke("data:restore"),
    search: (query) => invoke("data:search", query),
    clearAll: () => invoke("data:clearAll"),
  },
  stream: {
    onEvent: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("stream:event", listener);
      return () => ipcRenderer.removeListener("stream:event", listener);
    },
  },
});