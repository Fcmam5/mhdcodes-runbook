// IPC handlers behind `window.api` (SPEC §7). Validation lives in the modules they call.

import { BrowserWindow, ipcMain } from "electron";
import type { Settings } from "../shared/types";
import { listNotebooks, readNotebook, resolveNotebookPath } from "./notebooks";
import type { SessionManager } from "./shell/manager";
import { OutputBatcher } from "./shell/output-batcher";

export function registerIpc(settings: Settings, sessions: SessionManager): void {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("notebooks:list", () => listNotebooks(settings.notebooksDir));
  ipcMain.handle("notebooks:read", (_event, path: unknown) =>
    readNotebook(settings.notebooksDir, path),
  );

  // Resolves once the run ends; its status arrives separately as a cell:status event.
  ipcMain.handle("cell:run", async (_event, path: unknown, cellId: unknown, source: unknown) => {
    const notebookPath = resolveNotebookPath(settings.notebooksDir, path);
    if (typeof cellId !== "string" || typeof source !== "string") {
      throw new Error("Invalid cell");
    }
    await sessions.run(notebookPath, cellId, source);
  });

  const output = new OutputBatcher((event) => broadcast("cell:output", event));
  sessions.on("output", (event) => output.push(event));
  sessions.on("status", (event) => {
    output.flush();
    broadcast("cell:status", event);
  });
  sessions.on("state", (event) => broadcast("session:state", event));
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}
