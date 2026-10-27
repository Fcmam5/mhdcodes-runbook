// Runs and sessions in the renderer: the run store plus each cell's output pane, fed
// by the main process's events whether or not the notebook is shown (SPEC §6.6).
// Components read the store and call the actions below; they own none of this state,
// so switching notebooks loses nothing.

import { messageOf } from "../../../shared/errors";
import { createRunStore, type RunsByNotebook } from "../../../shared/run-store";
import { OutputPane } from "./output-pane";

export const runs = createRunStore();

// Output panes by notebook path, then cell ID. Created on a cell's first run and kept
// for the window's lifetime, so their output survives switching notebooks.
const panes = new Map<string, Map<string, OutputPane>>();
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

function isRunning(notebookPath: string, cellId: string): boolean {
  return latest[notebookPath]?.cells[cellId]?.status?.state === "running";
}

function key(notebookPath: string, cellId: string): string {
  return `${notebookPath}\0${cellId}`;
}

// The cell's pane, if it has run in this window.
export function existingPane(notebookPath: string, cellId: string): OutputPane | undefined {
  return panes.get(notebookPath)?.get(cellId);
}

// Frees everything kept for a deleted cell: its pane and its run-store entry.
export function forgetCell(notebookPath: string, cellId: string): void {
  forgotten.add(key(notebookPath, cellId));
  existingPane(notebookPath, cellId)?.dispose();
  panes.get(notebookPath)?.delete(cellId);
  runs.forgetCell(notebookPath, cellId);
}

function isForgotten(notebookPath: string, cellId: string): boolean {
  return forgotten.has(key(notebookPath, cellId));
}

export function paneFor(notebookPath: string, cellId: string): OutputPane {
  const existing = existingPane(notebookPath, cellId);
  if (existing) return existing;
  const pane = new OutputPane({
    // Only the running cell's pane types into the shell (SPEC §6.3.6).
    onInput: (data) => {
      if (isRunning(notebookPath, cellId)) void window.api.sendInput(notebookPath, data);
    },
    onResize: ({ cols, rows }) => {
      if (isRunning(notebookPath, cellId)) void window.api.resizeSession(notebookPath, cols, rows);
    },
  });
  let notebookPanes = panes.get(notebookPath);
  if (!notebookPanes) panes.set(notebookPath, (notebookPanes = new Map()));
  notebookPanes.set(cellId, pane);
  return pane;
}

// Subscribes to the main process's events, once, for the window's lifetime.
export function trackRuns(): void {
  window.api.onCellStatus((event) => {
    const { cellId, state } = event.status;
    if (isForgotten(event.notebookPath, cellId)) return;
    const pane =
      state === "running"
        ? paneFor(event.notebookPath, cellId)
        : existingPane(event.notebookPath, cellId);
    if (state === "running") pane?.clear();
    if (state === "success" || state === "failed" || state === "interrupted") pane?.hideCursor();
    pane?.setRunning(state === "running");
    runs.onStatus(event);
  });
  window.api.onCellOutput(({ notebookPath, cellId, data }) => {
    if (isForgotten(notebookPath, cellId)) return;
    const pane = existingPane(notebookPath, cellId);
    pane?.write(data);
    // A running cell may be waiting for input (a password, [Y/n]).
    if (isRunning(notebookPath, cellId)) pane?.offerFocus();
  });
  window.api.onSessionState((event) => runs.onSessionState(event));
}

// Runs a cell; resolves once the run has ended. Call it with the cell's pane already
// attached (paneFor + attach), so the shell can be sized to it first.
export async function runCell(notebookPath: string, cellId: string, source: string): Promise<void> {
  const id = key(notebookPath, cellId);
  stoppedEarly.delete(id);
  runs.setRequested(notebookPath, cellId, true);
  runs.setError(notebookPath, cellId, null);
  try {
    // Every pane in a notebook has the same width, so sizing the shell to this one
    // is right even if another cell is still running ahead of it.
    const { cols, rows } = paneFor(notebookPath, cellId).size;
    await window.api.resizeSession(notebookPath, cols, rows);
    // A Stop clicked meanwhile found nothing to cancel in main yet.
    if (stoppedEarly.has(id)) return;
    await window.api.runCell(notebookPath, cellId, source);
  } catch (cause) {
    if (!isForgotten(notebookPath, cellId)) runs.setError(notebookPath, cellId, messageOf(cause));
  } finally {
    stoppedEarly.delete(id);
    // The cell may have been deleted while its run went on.
    if (!isForgotten(notebookPath, cellId)) runs.setRequested(notebookPath, cellId, false);
  }
}

export function stopCell(notebookPath: string, cellId: string): void {
  stoppedEarly.add(key(notebookPath, cellId));
  window.api.cancelCell(notebookPath, cellId).catch((cause: unknown) => {
    if (!isForgotten(notebookPath, cellId)) runs.setError(notebookPath, cellId, messageOf(cause));
  });
}
