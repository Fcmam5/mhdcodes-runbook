// The runbooks open in the window, as a Svelte store, with autosave (SPEC §8): a
// change is saved 500 ms after the last edit, or at once on flush (runbook switch,
// window close). Each runbook is kept as first opened, so its cell IDs stay stable
// for the run store (see App.svelte). Pure apart from the injected save: tested in Node.

import { writable, type Readable } from "svelte/store";
import type { Runbook } from "../../../shared/types";

export interface RunbookStoreOptions {
  save: (runbook: Runbook) => Promise<void>;
  delayMs?: number; // default 500
}

export interface RunbookStore extends Readable<Record<string, Runbook>> {
  // Save errors by path, until a save of that runbook succeeds.
  errors: Readable<Record<string, string>>;
  // Keeps `runbook` unless one with its path is open already, and returns the kept one.
  open(runbook: Runbook): Runbook;
  get(path: string): Runbook | undefined;
  edit(path: string, change: (runbook: Runbook) => Runbook): void;
  // Saves the runbook now if it has unsaved changes. Resolves once it is saved.
  flush(path: string): Promise<void>;
  flushAll(): Promise<void>;
  // Renames a runbook: saves its pending edits, holds its autosave while `perform`
  // (main's rename) moves the file, then moves it to the new path, keeping its cells
  // (their IDs key the run state) and any edits made meanwhile. Resolves with the
  // moved runbook, or the renamed one from main if it wasn't open.
  rename(path: string, perform: () => Promise<Runbook>): Promise<Runbook>;
  // Deletes a runbook: holds its saves, waits for one in flight (so no save can
  // recreate the file after `perform` removes it), then drops it with its unsaved
  // edits. If `perform` fails, the runbook stays, and autosave goes on.
  remove(path: string, perform: () => Promise<void>): Promise<void>;
}

export function createRunbookStore({ save, delayMs = 500 }: RunbookStoreOptions): RunbookStore {
  const runbooks = writable<Record<string, Runbook>>({});
  const errors = writable<Record<string, string>>({});
  let current: Record<string, Runbook> = {};
  runbooks.subscribe((value) => {
    current = value;
  });

  const unsaved = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // The save in flight per path; a flush waits for it, then saves again if needed.
  const saving = new Map<string, Promise<void>>();
  // Paths whose saves wait: the file is being renamed or deleted.
  const held = new Set<string>();

  function setError(path: string, message: string | null): void {
    errors.update((all) => {
      const { [path]: _old, ...rest } = all;
      return message === null ? rest : { ...rest, [path]: message };
    });
  }

  async function saveNow(path: string): Promise<void> {
    await saving.get(path);
    const runbook = current[path];
    if (!unsaved.has(path) || !runbook || held.has(path)) return;
    // Edits made while this save runs mark the runbook unsaved again.
    unsaved.delete(path);
    try {
      await save(runbook);
      setError(path, null);
    } catch (cause) {
      // Still unsaved: the next edit or flush tries again.
      unsaved.add(path);
      setError(path, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  function flush(path: string): Promise<void> {
    clearTimeout(timers.get(path));
    timers.delete(path);
    const done = saveNow(path);
    const tracked = done.catch(() => {});
    saving.set(path, tracked);
    void tracked.then(() => {
      if (saving.get(path) === tracked) saving.delete(path);
    });
    return done;
  }

  function schedule(path: string): void {
    clearTimeout(timers.get(path));
    timers.set(
      path,
      setTimeout(() => void flush(path).catch(() => {}), delayMs),
    );
  }

  function drop(path: string): void {
    clearTimeout(timers.get(path));
    timers.delete(path);
    unsaved.delete(path);
    setError(path, null);
    if (current[path]) runbooks.update(({ [path]: _dropped, ...rest }) => rest);
  }

  return {
    subscribe: runbooks.subscribe,
    errors: { subscribe: errors.subscribe },
    open(runbook) {
      const kept = current[runbook.path];
      if (kept) return kept;
      runbooks.update((all) => ({ ...all, [runbook.path]: runbook }));
      return runbook;
    },
    get: (path) => current[path],
    edit(path, change) {
      const runbook = current[path];
      if (!runbook) return;
      const changed = change(runbook);
      if (changed === runbook) return;
      runbooks.update((all) => ({ ...all, [path]: changed }));
      unsaved.add(path);
      schedule(path);
    },
    flush,
    async rename(path, perform) {
      // Whatever was edited goes into the file before it moves. A failed save stops
      // the rename, so it can't leave those edits behind under the old name.
      await flush(path);
      held.add(path);
      let renamed: Runbook;
      try {
        renamed = await perform();
      } catch (cause) {
        held.delete(path);
        if (unsaved.has(path)) schedule(path);
        throw cause;
      }
      held.delete(path);
      const open = current[path];
      if (!open) return renamed;
      const to = renamed.path;
      // Main read the file to rename it, so its cells have IDs of their own; ours stay.
      const moved = {
        ...open,
        path: to,
        title: renamed.title,
        frontmatterRaw: renamed.frontmatterRaw,
      };
      const pending = unsaved.has(path);
      drop(path);
      runbooks.update((all) => ({ ...all, [to]: moved }));
      if (pending) {
        unsaved.add(to);
        schedule(to);
      }
      return moved;
    },
    async remove(path, perform) {
      held.add(path);
      try {
        await saving.get(path);
        await perform();
      } catch (cause) {
        held.delete(path);
        if (unsaved.has(path)) schedule(path);
        throw cause;
      }
      drop(path);
      held.delete(path);
    },
    async flushAll() {
      const paths = [...new Set([...unsaved, ...saving.keys()])];
      await Promise.allSettled(paths.map((path) => flush(path)));
    },
  };
}
