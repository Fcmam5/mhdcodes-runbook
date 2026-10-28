// What the renderer knows about runs and sessions, per runbook path, as a Svelte store
// (SPEC §6.6). It lives outside the components, so it survives switching runbooks and
// keeps taking events for runbooks that aren't shown. Pure: tested in plain Node.

import { get, writable, type Readable } from "svelte/store";
import type { CellRunStatus, SessionEnd, SessionState } from "../../../shared/types";

export interface CellRun {
  status: CellRunStatus | null; // null until the cell's first run
  requested: boolean; // Run was clicked and the request hasn't ended yet
  error: string | null; // a run request that failed, e.g. "Shell didn't start"
}

export interface RunbookRuns {
  session: SessionState | null; // null: no session yet
  end: SessionEnd | null; // why the session died on its own, until the next one starts
  cells: Record<string, CellRun>;
}

export type RunsByRunbook = Record<string, RunbookRuns>;

export const NO_CELL_RUN: CellRun = { status: null, requested: false, error: null };
export const NO_RUNBOOK_RUNS: RunbookRuns = { session: null, end: null, cells: {} };

export interface RunStore extends Readable<RunsByRunbook> {
  onStatus(event: { runbookPath: string; status: CellRunStatus }): void;
  onSessionState(event: { runbookPath: string; state: SessionState; end?: SessionEnd }): void;
  setRequested(runbookPath: string, cellId: string, requested: boolean): void;
  setError(runbookPath: string, cellId: string, error: string | null): void;
  dismissEnd(runbookPath: string): void;
  // Drops a deleted cell's entry.
  forgetCell(runbookPath: string, cellId: string): void;
  // Moves a renamed runbook's entry to its new path.
  renameRunbook(from: string, to: string): void;
  // Drops a deleted runbook's entry.
  forgetRunbook(runbookPath: string): void;
}

export function createRunStore(): RunStore {
  const store = writable<RunsByRunbook>({});
  const { subscribe, update } = store;

  // Each change makes new objects along the path, so subscribers see a new value.
  function updateRunbook(path: string, change: (runs: RunbookRuns) => RunbookRuns): void {
    update((all) => ({ ...all, [path]: change(all[path] ?? NO_RUNBOOK_RUNS) }));
  }

  function updateCell(path: string, cellId: string, change: Partial<CellRun>): void {
    updateRunbook(path, (runs) => ({
      ...runs,
      cells: { ...runs.cells, [cellId]: { ...(runs.cells[cellId] ?? NO_CELL_RUN), ...change } },
    }));
  }

  return {
    subscribe,
    onStatus: ({ runbookPath, status }) => updateCell(runbookPath, status.cellId, { status }),
    onSessionState: ({ runbookPath, state, end }) =>
      updateRunbook(runbookPath, (runs) => ({
        ...runs,
        session: state,
        // A new session makes the notice about the old one out of date.
        end: end ?? (state === "starting" ? null : runs.end),
      })),
    setRequested: (path, cellId, requested) => updateCell(path, cellId, { requested }),
    setError: (path, cellId, error) => updateCell(path, cellId, { error }),
    dismissEnd: (path) => updateRunbook(path, (runs) => ({ ...runs, end: null })),
    forgetCell(path, cellId) {
      // Nothing to drop for a cell that never ran: don't create an empty entry for
      // its runbook, or tell subscribers about a change that didn't happen.
      if (!get(store)[path]?.cells[cellId]) return;
      updateRunbook(path, (runs) => {
        const { [cellId]: _forgotten, ...cells } = runs.cells;
        return { ...runs, cells };
      });
    },
    renameRunbook(from, to) {
      if (from === to || !get(store)[from]) return;
      update(({ [from]: moved, ...rest }) => (moved ? { ...rest, [to]: moved } : rest));
    },
    forgetRunbook(path) {
      if (!get(store)[path]) return;
      update(({ [path]: _forgotten, ...rest }) => rest);
    },
  };
}

// Whether the cell's toolbar shows Stop rather than Run.
export function isActive(run: CellRun): boolean {
  return run.requested || run.status?.state === "running" || run.status?.state === "queued";
}
