// The open notebooks and their autosave, saved through the main process.
import { createNotebookStore } from "../state/notebook-store";

export const notebooks = createNotebookStore({
  save: (notebook) => window.api.saveNotebook(notebook),
});

// Before the window closes, save what is still waiting for its 500 ms (SPEC §8).
export function saveOnClose(): void {
  window.api.onFlushRequest(() => notebooks.flushAll());
}
