import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "./api";

// One ipcRenderer listener per channel, shared by every subscriber: each shell cell
// subscribes, and many listeners on one channel would trip Node's leak warning.
function channel<T>(name: string): (callback: (event: T) => void) => () => void {
  const callbacks = new Set<(event: T) => void>();
  ipcRenderer.on(name, (_event, payload: T) => {
    for (const callback of callbacks) callback(payload);
  });
  return (callback) => {
    callbacks.add(callback);
    return () => {
      callbacks.delete(callback);
    };
  };
}

// Expose a minimal, explicit API to the renderer. Never expose ipcRenderer itself.
const api: Api = {
  listNotebooks: () => ipcRenderer.invoke("notebooks:list"),
  readNotebook: (path) => ipcRenderer.invoke("notebooks:read", path),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  runCell: (notebookPath, cellId, source) =>
    ipcRenderer.invoke("cell:run", notebookPath, cellId, source),
  cancelCell: (notebookPath, cellId) => ipcRenderer.invoke("cell:cancel", notebookPath, cellId),
  sendInput: (notebookPath, data) => ipcRenderer.invoke("session:input", notebookPath, data),
  resizeSession: (notebookPath, cols, rows) =>
    ipcRenderer.invoke("session:resize", notebookPath, cols, rows),
  onCellOutput: channel("cell:output"),
  onCellStatus: channel("cell:status"),
  onSessionState: channel("session:state"),
};

contextBridge.exposeInMainWorld("api", api);
