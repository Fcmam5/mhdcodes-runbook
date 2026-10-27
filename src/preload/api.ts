// The API exposed to the renderer as `window.api` (SPEC §7). Type-only so both sides can share it.
import type {
  CellRunStatus,
  Notebook,
  NotebookSummary,
  SessionState,
  Settings,
} from "../shared/types";

export interface CellOutputEvent {
  notebookPath: string;
  cellId: string;
  data: string;
}

export interface CellStatusEvent {
  notebookPath: string;
  status: CellRunStatus;
}

export interface SessionStateEvent {
  notebookPath: string;
  state: SessionState;
}

export interface Api {
  listNotebooks: () => Promise<NotebookSummary[]>;
  readNotebook: (path: string) => Promise<Notebook>;
  getSettings: () => Promise<Settings>;

  // Starts the notebook's session if needed; resolves when the run ends.
  runCell: (notebookPath: string, cellId: string, source: string) => Promise<void>;

  // Each returns an unsubscribe function.
  onCellOutput: (callback: (event: CellOutputEvent) => void) => () => void;
  onCellStatus: (callback: (event: CellStatusEvent) => void) => () => void;
  onSessionState: (callback: (event: SessionStateEvent) => void) => () => void;
}
