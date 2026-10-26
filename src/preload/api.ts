// The API exposed to the renderer as `window.api` (SPEC §7). Type-only so both sides can share it.
import type { Notebook, NotebookSummary, Settings } from "../shared/types";

export interface Api {
  listNotebooks: () => Promise<NotebookSummary[]>;
  readNotebook: (path: string) => Promise<Notebook>;
  getSettings: () => Promise<Settings>;
}
