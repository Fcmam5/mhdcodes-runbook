import { join } from "node:path";
import { app, BrowserWindow, nativeTheme } from "electron";
import { registerIpc } from "./ipc";
import { ensureNotebooksDir } from "./notebooks";
import { defaultSettings, loadSettings } from "./settings";
import { SessionManager } from "./shell/manager";
import { createWindow } from "./window";
import { loadWindowState } from "./window-state";

// Name the data folder after the app ID (~/.config/com.codiume.runbook) rather than
// the generic product name. Must match appId in electron-builder.yml, and must run
// before anything touches userData, including the single-instance lock below.
const APP_ID = "com.codiume.runbook";
app.setPath("userData", join(app.getPath("appData"), APP_ID));

// The app is dark only (DECISIONS.md); this also darkens native menus and dialogs.
nativeTheme.themeSource = "dark";

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

  const sessions = new SessionManager({
    rcfilePath: join(app.getPath("userData"), "rcfile.bash"),
  });

  // Kill the shells and remove the run scripts' temp folder before quitting (SPEC §6.3.9).
  let quitting = false;
  app.on("will-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void sessions
      .dispose()
      .catch((error: unknown) => console.error("Could not clean up shell sessions:", error))
      .finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    // Any failure here must still end in a window: a windowless app never quits and
    // keeps the single-instance lock, so the app could not be started again.
    // The window state is read meanwhile; nothing before the window needs it.
    const windowStateFile = join(app.getPath("userData"), "window-state.json");
    const windowState = loadWindowState(windowStateFile).catch((error: unknown) => {
      console.error("Could not load the window state:", error);
      return null;
    });
    const settings = await loadSettings(join(app.getPath("userData"), "settings.json")).catch(
      (error: unknown) => {
        console.error("Could not load settings, using defaults:", error);
        return defaultSettings();
      },
    );
    await ensureNotebooksDir(settings.notebooksDir).catch((error: unknown) => {
      console.error("Could not prepare the notebooks folder:", error);
    });
    registerIpc(settings, sessions);

    createWindow(await windowState, windowStateFile);
  });

  app.on("window-all-closed", () => app.quit());
}
