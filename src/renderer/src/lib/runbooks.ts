// The open runbooks and their autosave, saved through the main process.
import { readable } from "svelte/store";
import { createRunbookStore } from "../state/runbook-store";

export const runbooks = createRunbookStore({
  save: (runbook, { force }) => window.api.saveRunbook(runbook, { force }),
});

// The time, updated every half minute: "Edited 2 minutes ago" keeps counting. Set
// again on each start, as nothing updates it while no runbook is shown.
export const now = readable(Date.now(), (set) => {
  set(Date.now());
  const timer = setInterval(() => set(Date.now()), 30_000);
  return () => clearInterval(timer);
});

// Before the window closes, save what is still waiting for its 500 ms (SPEC §8).
export function saveOnClose(): void {
  window.api.onFlushRequest(() => runbooks.flushAll());
}
