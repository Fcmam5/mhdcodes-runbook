// What the renderer knows about runs and sessions, per notebook path, as a Svelte store
// (SPEC §6.6). It lives outside the components, so it survives switching notebooks and
// keeps taking events for notebooks that aren't shown. Pure: tested in plain Node.

import { get, writable, type Readable } from "svelte/store";
import type { CellRunStatus, SessionEnd, SessionState } from "./types";

export interface CellRun {
  status: CellRunStatus | null; // null until the cell's first run
  requested: boolean; // Run was clicked and the request hasn't ended yet
  error: string | null; // a run request that failed, e.g. "Shell didn't start"
}

export interface NotebookRuns {
  session: SessionState | null; // null: no session yet
  end: SessionEnd | null; // why the session died on its own, until the next one starts
  cells: Record<string, CellRun>;
}

export type RunsByNotebook = Record<string, NotebookRuns>;

export const NO_CELL_RUN: CellRun = { status: null, requested: false, error: null };
export const NO_NOTEBOOK_RUNS: NotebookRuns = { session: null, end: null, cells: {} };

export interface RunStore extends Readable<RunsByNotebook> {
  onStatus(event: { notebookPath: string; status: CellRunStatus }): void;
  onSessionState(event: { notebookPath: string; state: SessionState; end?: SessionEnd }): void;
  setRequested(notebookPath: string, cellId: string, requested: boolean): void;
  setError(notebookPath: string, cellId: string, error: string | null): void;
  dismissEnd(notebookPath: string): void;
  // Drops a deleted cell's entry.
  forgetCell(notebookPath: string, cellId: string): void;
}

export function createRunStore(): RunStore {
  const store = writable<RunsByNotebook>({});
  const { subscribe, update } = store;

  // Each change makes new objects along the path, so subscribers see a new value.
  function updateNotebook(path: string, change: (runs: NotebookRuns) => NotebookRuns): void {
    update((all) => ({ ...all, [path]: change(all[path] ?? NO_NOTEBOOK_RUNS) }));
  }

  function updateCell(path: string, cellId: string, change: Partial<CellRun>): void {
    updateNotebook(path, (runs) => ({
      ...runs,
      cells: { ...runs.cells, [cellId]: { ...(runs.cells[cellId] ?? NO_CELL_RUN), ...change } },
    }));
  }

  return {
    subscribe,
    onStatus: ({ notebookPath, status }) => updateCell(notebookPath, status.cellId, { status }),
    onSessionState: ({ notebookPath, state, end }) =>
      updateNotebook(notebookPath, (runs) => ({
        ...runs,
        session: state,
        // A new session makes the notice about the old one out of date.
        end: end ?? (state === "starting" ? null : runs.end),
      })),
    setRequested: (path, cellId, requested) => updateCell(path, cellId, { requested }),
    setError: (path, cellId, error) => updateCell(path, cellId, { error }),
    dismissEnd: (path) => updateNotebook(path, (runs) => ({ ...runs, end: null })),
    forgetCell(path, cellId) {
      // Nothing to drop for a cell that never ran: don't create an empty entry for
      // its notebook, or tell subscribers about a change that didn't happen.
      if (!get(store)[path]?.cells[cellId]) return;
      updateNotebook(path, (runs) => {
        const { [cellId]: _forgotten, ...cells } = runs.cells;
        return { ...runs, cells };
      });
    },
  };
}

// Whether the cell's toolbar shows Stop rather than Run.
export function isActive(run: CellRun): boolean {
  return run.requested || run.status?.state === "running" || run.status?.state === "queued";
}
