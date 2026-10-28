// The open runbooks and their autosave, saved through the main process.
import { readable, writable } from "svelte/store";
import { createRunbookStore } from "../state/runbook-store";

// When each runbook was last saved from this window, by path, for "Edited …". Before
// its first save here, a runbook's time comes from its file (the sidebar's summary).
export const savedAt = writable<Record<string, number>>({});

export const runbooks = createRunbookStore({
  save: async (runbook) => {
    await window.api.saveRunbook(runbook);
    savedAt.update((all) => ({ ...all, [runbook.path]: Date.now() }));
  },
});

// The time, updated every half minute: "Edited 2 minutes ago" keeps counting.
export const now = readable(Date.now(), (set) => {
  const timer = setInterval(() => set(Date.now()), 30_000);
  return () => clearInterval(timer);
});

// Before the window closes, save what is still waiting for its 500 ms (SPEC §8).
export function saveOnClose(): void {
  window.api.onFlushRequest(() => runbooks.flushAll());
}
