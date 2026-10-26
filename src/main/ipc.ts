// IPC handlers behind `window.api` (SPEC §7). Validation lives in the modules they call.

import { ipcMain } from "electron";
import type { Settings } from "../shared/types";
import { listNotebooks, readNotebook } from "./notebooks";

export function registerIpc(settings: Settings): void {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("notebooks:list", () => listNotebooks(settings.notebooksDir));
  ipcMain.handle("notebooks:read", (_event, path: unknown) =>
    readNotebook(settings.notebooksDir, path),
  );
}
