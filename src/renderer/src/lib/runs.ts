// The renderer's run tracker (shared/run-tracker.ts), wired to window.api and to xterm
// output panes. Components import the store and the actions from here.

import { createRunTracker } from "../../../shared/run-tracker";
import { OutputPane } from "./output-pane";

const tracker = createRunTracker(window.api, (callbacks) => new OutputPane(callbacks));

export const { runs, existingPane, paneFor, runCell, stopCell, forgetCell } = tracker;

// Subscribes to the main process's events, once, for the window's lifetime.
export function trackRuns(): void {
  tracker.start();
}
