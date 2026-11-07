"use strict";

const path = require("path");
const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
const db = require("./db");
const { registerIpc } = require("./ipc");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: "#14130f",
    title: "Lantern",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  // The interface is loaded from disk. Nothing is ever fetched from a network.
  mainWindow.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));

  mainWindow.once("ready-to-show", () => mainWindow.show());

  // No in-app navigation, no pop-up windows, no external protocol handlers.
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  if (process.env.LANTERN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function bootstrap() {
  try {
    const dbPath = path.join(app.getPath("userData"), "lantern.db");
    db.init(dbPath);
  } catch (error) {
    dialog.showErrorBox(
      "Lantern could not open its local database",
      `${error && error.message ? error.message : error}\n\nThe database engine may not match this build. ` +
        'Run "npm run postinstall" (or "npx electron-rebuild -f -w better-sqlite3") in the project folder, then start Lantern again.',
    );
    app.quit();
    return;
  }

  registerIpc({
    getWindow: () => mainWindow,
    showSaveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
    showOpenDialog: (options) => dialog.showOpenDialog(mainWindow, options),
    showMessage: (options) => dialog.showMessageBox(mainWindow, options),
    openPath: (target) => shell.openPath(target),
  });

  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => db.close());