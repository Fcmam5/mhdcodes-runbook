import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "./api";

// Expose a minimal, explicit API to the renderer. Never expose ipcRenderer itself.
const api: Api = {
  listNotebooks: () => ipcRenderer.invoke("notebooks:list"),
  readNotebook: (path) => ipcRenderer.invoke("notebooks:read", path),
  getSettings: () => ipcRenderer.invoke("settings:get"),
};

contextBridge.exposeInMainWorld("api", api);
