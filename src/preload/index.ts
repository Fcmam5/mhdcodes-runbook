import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "./api";

// Expose a minimal, explicit API to the renderer. Never expose ipcRenderer itself.
const api: Api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getAppVersion: () => ipcRenderer.invoke("app:get-version"),
};

contextBridge.exposeInMainWorld("api", api);
