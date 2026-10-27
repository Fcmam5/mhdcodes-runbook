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

  function setError(path: string, message: string | null): void {
    errors.update((all) => {
      const { [path]: _old, ...rest } = all;
      return message === null ? rest : { ...rest, [path]: message };
    });
  }

  async function saveNow(path: string): Promise<void> {
    await saving.get(path);
    const notebook = current[path];
    if (!unsaved.has(path) || !notebook) return;
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
      clearTimeout(timers.get(path));
      timers.set(
        path,
        setTimeout(() => void flush(path).catch(() => {}), delayMs),
      );
    },
    flush,
    async flushAll() {
      const paths = [...new Set([...unsaved, ...saving.keys()])];
      await Promise.allSettled(paths.map((path) => flush(path)));
    },
  };
}
