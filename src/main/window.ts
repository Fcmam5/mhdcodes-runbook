// The app's one window: its options, remembered size and position, the save of
// pending edits before it closes, and where links open.

import { join } from "node:path";
import { app, BrowserWindow, ipcMain, screen, shell } from "electron";
import { externalUrl } from "../shared/links";
import { MIN_SIZE, restoreWindowState, saveWindowState, type WindowState } from "./window-state";

export function createWindow(saved: WindowState | null, windowStateFile: string): void {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const bounds = restoreWindowState(saved, workAreas, screen.getPrimaryDisplay().workArea);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // The page's background (zinc-950), so the window doesn't flash white before it paints.
    backgroundColor: "#09090b",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Shown once painted, or when the page fails to load: a window that stays hidden
  // would leave the app running with nothing on screen, holding the single-instance
  // lock, so it couldn't be opened again.
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) win.show();
  });

  // Remember the window's size and position for the next launch (SPEC §9.4). The
  // normal bounds, so a maximized window comes back at its unmaximized size. Being
  // maximized isn't restored: see DECISIONS.md.
  win.once("close", () => {
    const { x, y, width, height } = win.getNormalBounds();
    try {
      saveWindowState(windowStateFile, onWayland() ? { width, height } : { x, y, width, height });
    } catch (error) {
      console.error("Could not save the window state:", error);
    }
  });

  // Autosave waits 500 ms after an edit (SPEC §8), so ask the renderer to save what is
  // still pending before the window goes. A renderer that doesn't answer (crashed,
  // still loading) gets 3 s.
  let flushed = false;
  win.on("close", (event) => {
    if (flushed) return;
    event.preventDefault();
    const close = (): void => {
      if (flushed) return;
      flushed = true;
      clearTimeout(timer);
      ipcMain.removeListener("notebooks:flushed", onFlushed);
      win.close();
    };
    const onFlushed = (reply: Electron.IpcMainEvent): void => {
      if (reply.sender === win.webContents) close();
    };
    const timer = setTimeout(close, 3000);
    ipcMain.on("notebooks:flushed", onFlushed);
    win.webContents.send("notebooks:flush");
  });

  // Open http(s) links in the default browser instead of new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url);
    if (external) void shell.openExternal(external);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  const loaded =
    !app.isPackaged && devUrl
      ? win.loadURL(devUrl)
      : win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  loaded.catch((error: unknown) => console.error("Could not load the app's page:", error));
}

// On Wayland the position can't be read or set: the compositor places windows, and
// Electron reports a made-up position, which must not be saved. Electron picks
// Wayland when the session is one, unless told otherwise with --ozone-platform.
function onWayland(): boolean {
  const platform = app.commandLine.getSwitchValue("ozone-platform");
  if (platform) return platform === "wayland";
  return process.env["XDG_SESSION_TYPE"] === "wayland" || Boolean(process.env["WAYLAND_DISPLAY"]);
}
