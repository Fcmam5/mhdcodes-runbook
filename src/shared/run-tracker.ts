// Runs and sessions in the renderer: the run store plus each cell's output pane, fed
// by the main process's events whether or not the notebook is shown (SPEC §6.6).
// Components read the store and call the actions; they own none of this state, so
// switching notebooks loses nothing.
//
// The API and the pane are injected (window.api and OutputPane in the renderer), so
// this is tested in plain Node with fakes.

import type { CellOutputEvent, CellStatusEvent, SessionStateEvent } from "../preload/api";
import { messageOf } from "./errors";
import { createRunStore, type RunsByNotebook, type RunStore } from "./run-store";

// What the tracker needs from an output pane.
export interface TrackedPane {
  readonly size: { cols: number; rows: number };
  clear(): void;
  write(data: string): void;
  hideCursor(): void;
  setRunning(running: boolean): void;
  offerFocus(): void;
  dispose(): void;
}

export interface PaneCallbacks {
  onInput: (data: string) => void;
  onResize: (size: { cols: number; rows: number }) => void;
}

// The part of window.api the tracker uses.
export interface RunApi {
  runCell(notebookPath: string, cellId: string, source: string): Promise<void>;
  cancelCell(notebookPath: string, cellId: string): Promise<void>;
  sendInput(notebookPath: string, data: string): Promise<void>;
  resizeSession(notebookPath: string, cols: number, rows: number): Promise<void>;
  onCellOutput(callback: (event: CellOutputEvent) => void): () => void;
  onCellStatus(callback: (event: CellStatusEvent) => void): () => void;
  onSessionState(callback: (event: SessionStateEvent) => void): () => void;
}

export interface RunTracker<P extends TrackedPane> {
  runs: RunStore;
  // The cell's pane, if it has run in this window.
  existingPane(notebookPath: string, cellId: string): P | undefined;
  paneFor(notebookPath: string, cellId: string): P;
  // Subscribes to the main process's events, once, for the window's lifetime.
  start(): void;
  // Runs a cell; resolves once the run has ended. Call it with the cell's pane already
  // attached (paneFor + attach), so the shell can be sized to it first.
  runCell(notebookPath: string, cellId: string, source: string): Promise<void>;
  stopCell(notebookPath: string, cellId: string): void;
  // Frees everything kept for a deleted cell: its pane and its run-store entry.
  forgetCell(notebookPath: string, cellId: string): void;
}

// A NUL can't appear in a path, so it can't make two keys collide.
function key(notebookPath: string, cellId: string): string {
  return `${notebookPath}\0${cellId}`;
}

export function createRunTracker<P extends TrackedPane>(
  api: RunApi,
  createPane: (callbacks: PaneCallbacks) => P,
): RunTracker<P> {
  const runs = createRunStore();
  // Output panes by notebook path, then cell ID. Created on a cell's first run and
  // kept for the window's lifetime, so their output survives switching notebooks.
  const panes = new Map<string, Map<string, P>>();
  // Cells whose Stop came before their run request reached main (see runCell).
  const stoppedEarly = new Set<string>();
  // Deleted cells. Their run may still be ending, or a background job they started may
  // still print; their events are dropped so nothing is recreated for them. Cell IDs
  // are never reused, so the set only grows by one per deleted cell that had run.
  const forgotten = new Set<string>();

  // The store's latest value, for the checks on every keystroke and output chunk.
  let latest: RunsByNotebook = {};
  runs.subscribe((all) => {
    latest = all;
  });

  const isRunning = (notebookPath: string, cellId: string): boolean =>
    latest[notebookPath]?.cells[cellId]?.status?.state === "running";
  const isForgotten = (notebookPath: string, cellId: string): boolean =>
    forgotten.has(key(notebookPath, cellId));

  function existingPane(notebookPath: string, cellId: string): P | undefined {
    return panes.get(notebookPath)?.get(cellId);
  }

  function paneFor(notebookPath: string, cellId: string): P {
    const existing = existingPane(notebookPath, cellId);
    if (existing) return existing;
    const pane = createPane({
      // Only the running cell's pane types into the shell (SPEC §6.3.6).
      onInput: (data) => {
        if (isRunning(notebookPath, cellId)) void api.sendInput(notebookPath, data);
      },
      onResize: ({ cols, rows }) => {
        if (isRunning(notebookPath, cellId)) void api.resizeSession(notebookPath, cols, rows);
      },
    });
    let notebookPanes = panes.get(notebookPath);
    if (!notebookPanes) panes.set(notebookPath, (notebookPanes = new Map()));
    notebookPanes.set(cellId, pane);
    return pane;
  }

  return {
    runs,
    existingPane,
    paneFor,

    start() {
      api.onCellStatus((event) => {
        const { cellId, state } = event.status;
        if (isForgotten(event.notebookPath, cellId)) return;
        const pane =
          state === "running"
            ? paneFor(event.notebookPath, cellId)
            : existingPane(event.notebookPath, cellId);
        if (state === "running") pane?.clear();
        if (state === "success" || state === "failed" || state === "interrupted") {
          pane?.hideCursor();
        }
        pane?.setRunning(state === "running");
        runs.onStatus(event);
      });
      api.onCellOutput(({ notebookPath, cellId, data }) => {
        if (isForgotten(notebookPath, cellId)) return;
        const pane = existingPane(notebookPath, cellId);
        pane?.write(data);
        // A running cell may be waiting for input (a password, [Y/n]).
        if (isRunning(notebookPath, cellId)) pane?.offerFocus();
      });
      api.onSessionState((event) => runs.onSessionState(event));
    },

    async runCell(notebookPath, cellId, source) {
      const id = key(notebookPath, cellId);
      stoppedEarly.delete(id);
      runs.setRequested(notebookPath, cellId, true);
      runs.setError(notebookPath, cellId, null);
      try {
        // Every pane in a notebook has the same width, so sizing the shell to this one
        // is right even if another cell is still running ahead of it.
        const { cols, rows } = paneFor(notebookPath, cellId).size;
        await api.resizeSession(notebookPath, cols, rows);
        // A Stop clicked meanwhile found nothing to cancel in main yet.
        if (stoppedEarly.has(id)) return;
        await api.runCell(notebookPath, cellId, source);
      } catch (cause) {
        if (!isForgotten(notebookPath, cellId)) {
          runs.setError(notebookPath, cellId, messageOf(cause));
        }
      } finally {
        stoppedEarly.delete(id);
        // The cell may have been deleted while its run went on.
        if (!isForgotten(notebookPath, cellId)) runs.setRequested(notebookPath, cellId, false);
      }
    },

    stopCell(notebookPath, cellId) {
      stoppedEarly.add(key(notebookPath, cellId));
      api.cancelCell(notebookPath, cellId).catch((cause: unknown) => {
        if (!isForgotten(notebookPath, cellId)) {
          runs.setError(notebookPath, cellId, messageOf(cause));
        }
      });
    },

    forgetCell(notebookPath, cellId) {
      const pane = existingPane(notebookPath, cellId);
      // Only a cell that has run can still get events: its pane is created when Run is
      // clicked, before the request goes out.
      if (pane) forgotten.add(key(notebookPath, cellId));
      pane?.dispose();
      panes.get(notebookPath)?.delete(cellId);
      runs.forgetCell(notebookPath, cellId);
    },
  };
}
