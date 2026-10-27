// IPC handlers behind `window.api` (SPEC §7). Validation lives in the modules they call.

import { BrowserWindow, ipcMain, shell } from "electron";
import type { Settings } from "../shared/types";
import {
  createNotebook,
  deleteNotebook,
  listNotebooks,
  readNotebook,
  renameNotebook,
  resolveNotebookPath,
  saveNotebook,
} from "./notebooks";
import { NotebookIndex } from "./search";
import type { SessionManager } from "./shell/manager";
import { OutputBatcher } from "./shell/output-batcher";

export function registerIpc(settings: Settings, sessions: SessionManager): void {
  // Built on the first search, then kept current by the handlers below.
  const index = new NotebookIndex(settings.notebooksDir);

  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("notebooks:list", () => listNotebooks(settings.notebooksDir));
  ipcMain.handle("notebooks:read", (_event, path: unknown) =>
    readNotebook(settings.notebooksDir, path),
  );
  ipcMain.handle("notebooks:save", async (_event, notebook: unknown) => {
    index.update(await saveNotebook(settings.notebooksDir, notebook));
  });
  ipcMain.handle("notebooks:create", async (_event, title: unknown) => {
    const created = await createNotebook(settings.notebooksDir, title);
    index.update(created);
    return created;
  });
  ipcMain.handle("notebooks:search", (_event, query: unknown) =>
    index.search(typeof query === "string" ? query : ""),
  );
  ipcMain.handle("notebooks:rename", async (_event, path: unknown, title: unknown) => {
    const from = resolveNotebookPath(settings.notebooksDir, path);
    const renamed = await renameNotebook(settings.notebooksDir, from, title);
    index.rename(from, renamed);
    // A running cell keeps running in the renamed notebook (SPEC §6.6).
    sessions.rename(from, renamed.path);
    return renamed;
  });
  ipcMain.handle("notebooks:delete", async (_event, path: unknown) => {
    const deleted = await deleteNotebook(settings.notebooksDir, path, (p) => shell.trashItem(p));
    sessions.close(deleted);
    index.remove(deleted);
  });
  ipcMain.handle("notebooks:reveal", (_event, path: unknown) => {
    shell.showItemInFolder(resolveNotebookPath(settings.notebooksDir, path));
  });

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
