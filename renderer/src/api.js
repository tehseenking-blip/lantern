/**
 * Every call goes through the desktop bridge in preload.js. Errors arrive as
 * { __error } and are turned back into exceptions here, so components can use
 * ordinary try/catch.
 */

const bridge = window.lantern;

function wrapGroup(group) {
  const output = {};
  for (const [key, value] of Object.entries(group)) {
    if (typeof value !== "function") continue;
    output[key] = async (...args) => {
      const result = await value(...args);
      if (result && typeof result === "object" && !Array.isArray(result) && "__error" in result) {
        throw new Error(result.__error);
      }
      return result;
    };
  }
  return output;
}

export const api = {
  app: wrapGroup(bridge.app),
  settings: wrapGroup(bridge.settings),
  providers: wrapGroup(bridge.providers),
  chats: wrapGroup(bridge.chats),
  projects: wrapGroup(bridge.projects),
  messages: wrapGroup(bridge.messages),
  memories: wrapGroup(bridge.memories),
  files: wrapGroup(bridge.files),
  data: wrapGroup(bridge.data),
  stream: bridge.stream,
};