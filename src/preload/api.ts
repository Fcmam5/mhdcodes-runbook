// The API exposed to the renderer as `window.api` (SPEC §7). Type-only so both sides can share it.
import type {
  CellRunStatus,
  Notebook,
  NotebookSummary,
  SessionEnd,
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
  end?: SessionEnd; // with "dead": why the shell died on its own
}

export interface Api {
  listNotebooks: () => Promise<NotebookSummary[]>;
  readNotebook: (path: string) => Promise<Notebook>;
  getSettings: () => Promise<Settings>;

  // Starts the notebook's session if needed; resolves when the run ends.
  runCell: (notebookPath: string, cellId: string, source: string) => Promise<void>;
  // Stops the cell's run, or drops it from the queue.
  cancelCell: (notebookPath: string, cellId: string) => Promise<void>;
  // Keystrokes for the running cell; ignored when nothing is running.
  sendInput: (notebookPath: string, data: string) => Promise<void>;
  resizeSession: (notebookPath: string, cols: number, rows: number) => Promise<void>;
  // Kills the shell and starts a fresh one; the running cell ends interrupted.
  restartSession: (notebookPath: string) => Promise<void>;
  // Kills the shell; the next run starts a new one.
  closeSession: (notebookPath: string) => Promise<void>;

  // Each returns an unsubscribe function.
  onCellOutput: (callback: (event: CellOutputEvent) => void) => () => void;
  onCellStatus: (callback: (event: CellStatusEvent) => void) => () => void;
  onSessionState: (callback: (event: SessionStateEvent) => void) => () => void;
}
