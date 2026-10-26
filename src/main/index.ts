import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { externalUrl } from "../shared/links";
import { registerIpc } from "./ipc";
import { ensureNotebooksDir } from "./notebooks";
import { defaultSettings, loadSettings } from "./settings";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Open http(s) links in the default browser instead of new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url);
    if (external) void shell.openExternal(external);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

// Name the data folder after the app ID (~/.config/com.codiume.runbook) rather than
// the generic product name. Must match appId in electron-builder.yml, and must run
// before anything touches userData, including the single-instance lock below.
const APP_ID = "com.codiume.runbook";
app.setPath("userData", join(app.getPath("appData"), APP_ID));

// Block in-page navigation away from the app.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (url !== contents.getURL()) event.preventDefault();
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    // Any failure here must still end in a window: a windowless app never quits and
    // keeps the single-instance lock, so the app could not be started again.
    const settings = await loadSettings(join(app.getPath("userData"), "settings.json")).catch(
      (error: unknown) => {
        console.error("Could not load settings, using defaults:", error);
        return defaultSettings();
      },
    );
    await ensureNotebooksDir(settings.notebooksDir).catch((error: unknown) => {
      console.error("Could not prepare the notebooks folder:", error);
    });
    registerIpc(settings);

    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
