// The open runbooks and their autosave, saved through the main process.
import { createRunbookStore } from "../state/runbook-store";

export const runbooks = createRunbookStore({
  save: (runbook) => window.api.saveRunbook(runbook),
});

// Before the window closes, save what is still waiting for its 500 ms (SPEC §8).
export function saveOnClose(): void {
  window.api.onFlushRequest(() => runbooks.flushAll());
}
