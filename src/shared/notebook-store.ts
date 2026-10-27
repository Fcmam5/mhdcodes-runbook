// The notebooks open in the window, as a Svelte store, with autosave (SPEC §8): a
// change is saved 500 ms after the last edit, or at once on flush (notebook switch,
// window close). Each notebook is kept as first opened, so its cell IDs stay stable
// for the run store (see App.svelte). Pure apart from the injected save: tested in Node.

import { writable, type Readable } from "svelte/store";
import type { Notebook } from "./types";

export interface NotebookStoreOptions {
  save: (notebook: Notebook) => Promise<void>;
  delayMs?: number; // default 500
}

export interface NotebookStore extends Readable<Record<string, Notebook>> {
  // Save errors by path, until a save of that notebook succeeds.
  errors: Readable<Record<string, string>>;
  // Keeps `notebook` unless one with its path is open already, and returns the kept one.
  open(notebook: Notebook): Notebook;
  get(path: string): Notebook | undefined;
  edit(path: string, change: (notebook: Notebook) => Notebook): void;
  // Saves the notebook now if it has unsaved changes. Resolves once it is saved.
  flush(path: string): Promise<void>;
  flushAll(): Promise<void>;
  // Renames a notebook: saves its pending edits, holds its autosave while `perform`
  // (main's rename) moves the file, then moves it to the new path, keeping its cells
  // (their IDs key the run state) and any edits made meanwhile. Resolves with the
  // moved notebook, or the renamed one from main if it wasn't open.
  rename(path: string, perform: () => Promise<Notebook>): Promise<Notebook>;
  // Deletes a notebook: holds its saves, waits for one in flight (so no save can
  // recreate the file after `perform` removes it), then drops it with its unsaved
  // edits. If `perform` fails, the notebook stays, and autosave goes on.
  remove(path: string, perform: () => Promise<void>): Promise<void>;
}

export function createNotebookStore({ save, delayMs = 500 }: NotebookStoreOptions): NotebookStore {
  const notebooks = writable<Record<string, Notebook>>({});
  const errors = writable<Record<string, string>>({});
  let current: Record<string, Notebook> = {};
  notebooks.subscribe((value) => {
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
    const notebook = current[path];
    if (!unsaved.has(path) || !notebook || held.has(path)) return;
    // Edits made while this save runs mark the notebook unsaved again.
    unsaved.delete(path);
    try {
      await save(notebook);
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
    if (current[path]) notebooks.update(({ [path]: _dropped, ...rest }) => rest);
  }

  return {
    subscribe: notebooks.subscribe,
    errors: { subscribe: errors.subscribe },
    open(notebook) {
      const kept = current[notebook.path];
      if (kept) return kept;
      notebooks.update((all) => ({ ...all, [notebook.path]: notebook }));
      return notebook;
    },
    get: (path) => current[path],
    edit(path, change) {
      const notebook = current[path];
      if (!notebook) return;
      const changed = change(notebook);
      if (changed === notebook) return;
      notebooks.update((all) => ({ ...all, [path]: changed }));
      unsaved.add(path);
      schedule(path);
    },
    flush,
    async rename(path, perform) {
      // Whatever was edited goes into the file before it moves. A failed save stops
      // the rename, so it can't leave those edits behind under the old name.
      await flush(path);
      held.add(path);
      let renamed: Notebook;
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
      notebooks.update((all) => ({ ...all, [to]: moved }));
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
