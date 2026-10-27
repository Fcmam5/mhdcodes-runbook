// IPC handlers behind `window.api` (SPEC §7). Validation lives in the modules they call.

import { BrowserWindow, ipcMain } from "electron";
import type { Settings } from "../shared/types";
import { listNotebooks, readNotebook, resolveNotebookPath, saveNotebook } from "./notebooks";
import type { SessionManager } from "./shell/manager";
import { OutputBatcher } from "./shell/output-batcher";

export function registerIpc(settings: Settings, sessions: SessionManager): void {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("notebooks:list", () => listNotebooks(settings.notebooksDir));
  ipcMain.handle("notebooks:read", (_event, path: unknown) =>
    readNotebook(settings.notebooksDir, path),
  );
  ipcMain.handle("notebooks:save", (_event, notebook: unknown) =>
    saveNotebook(settings.notebooksDir, notebook),
  );

  // Resolves once the run ends; its status arrives separately as a cell:status event.
  ipcMain.handle("cell:run", async (_event, path: unknown, cellId: unknown, source: unknown) => {
    const notebookPath = resolveNotebookPath(settings.notebooksDir, path);
    if (typeof cellId !== "string" || typeof source !== "string") {
      throw new Error("Invalid cell");
    }
    await sessions.run(notebookPath, cellId, source);
  });
  ipcMain.handle("cell:cancel", (_event, path: unknown, cellId: unknown) => {
    const notebookPath = resolveNotebookPath(settings.notebooksDir, path);
    if (typeof cellId !== "string") throw new Error("Invalid cell");
    sessions.cancel(notebookPath, cellId);
  });
  ipcMain.handle("session:input", (_event, path: unknown, data: unknown) => {
    const notebookPath = resolveNotebookPath(settings.notebooksDir, path);
    if (typeof data !== "string") throw new Error("Invalid input");
    sessions.sendInput(notebookPath, data);
  });
  ipcMain.handle("session:restart", (_event, path: unknown) =>
    sessions.restart(resolveNotebookPath(settings.notebooksDir, path)),
  );
  ipcMain.handle("session:close", (_event, path: unknown) => {
    sessions.close(resolveNotebookPath(settings.notebooksDir, path));
  });
  ipcMain.handle("session:resize", (_event, path: unknown, cols: unknown, rows: unknown) => {
    const notebookPath = resolveNotebookPath(settings.notebooksDir, path);
    if (!isTerminalSize(cols) || !isTerminalSize(rows)) throw new Error("Invalid size");
    sessions.resize(notebookPath, cols, rows);
  });

  const output = new OutputBatcher((event) => broadcast("cell:output", event));
  sessions.on("output", (event) => output.push(event));
  sessions.on("status", (event) => {
    output.flush();
    broadcast("cell:status", event);
  });
  sessions.on("state", (event) => broadcast("session:state", event));
}

function isTerminalSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}
