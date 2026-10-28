import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { createRunStore, isActive, NO_CELL_RUN } from "../src/renderer/src/state/run-store";

describe("run store", () => {
  it("keeps statuses per notebook and cell", () => {
    const runs = createRunStore();
    runs.onStatus({ notebookPath: "/a.md", status: { cellId: "c1", state: "running" } });
    runs.onStatus({ notebookPath: "/b.md", status: { cellId: "c1", state: "queued" } });
    runs.onStatus({
      notebookPath: "/a.md",
      status: { cellId: "c1", state: "success", exitCode: 0 },
    });
    const all = get(runs);
    expect(all["/a.md"]?.cells["c1"]?.status).toEqual({
      cellId: "c1",
      state: "success",
      exitCode: 0,
    });
    expect(all["/b.md"]?.cells["c1"]?.status?.state).toBe("queued");
  });

  it("tracks the session state and why it died, until a new one starts", () => {
    const runs = createRunStore();
    runs.onSessionState({ notebookPath: "/a.md", state: "starting" });
    runs.onSessionState({ notebookPath: "/a.md", state: "ready" });
    runs.onSessionState({
      notebookPath: "/a.md",
      state: "dead",
      end: { type: "exited", exitCode: 3 },
    });
    expect(get(runs)["/a.md"]).toMatchObject({
      session: "dead",
      end: { type: "exited", exitCode: 3 },
    });
    runs.onSessionState({ notebookPath: "/a.md", state: "starting" });
    expect(get(runs)["/a.md"]).toMatchObject({ session: "starting", end: null });
  });

  it("keeps a notice through later states until dismissed", () => {
    const runs = createRunStore();
    runs.onSessionState({
      notebookPath: "/a.md",
      state: "dead",
      end: { type: "start-failed", output: "oops" },
    });
    runs.onSessionState({ notebookPath: "/a.md", state: "dead" });
    expect(get(runs)["/a.md"]?.end).toEqual({ type: "start-failed", output: "oops" });
    runs.dismissEnd("/a.md");
    expect(get(runs)["/a.md"]?.end).toBeNull();
  });

  it("keeps a cell's request flag and error next to its status", () => {
    const runs = createRunStore();
    runs.setRequested("/a.md", "c1", true);
    runs.onStatus({ notebookPath: "/a.md", status: { cellId: "c1", state: "running" } });
    runs.setError("/a.md", "c1", "Shell didn't start");
    expect(get(runs)["/a.md"]?.cells["c1"]).toEqual({
      status: { cellId: "c1", state: "running" },
      requested: true,
      error: "Shell didn't start",
    });
  });

  it("drops a deleted cell's entry and keeps the others", () => {
    const runs = createRunStore();
    runs.onStatus({ notebookPath: "/a.md", status: { cellId: "c1", state: "success" } });
    runs.onStatus({ notebookPath: "/a.md", status: { cellId: "c2", state: "failed" } });
    runs.forgetCell("/a.md", "c1");
    expect(Object.keys(get(runs)["/a.md"]?.cells ?? {})).toEqual(["c2"]);
  });

  it("changes nothing when forgetting a cell it has no entry for", () => {
    const runs = createRunStore();
    const seen: unknown[] = [];
    const stop = runs.subscribe((value) => seen.push(value));
    runs.forgetCell("/a.md", "never-ran");
    stop();
    expect(seen).toEqual([{}]);
  });

  it("gives subscribers a new value on each change", () => {
    const runs = createRunStore();
    const seen: unknown[] = [];
    const stop = runs.subscribe((value) => seen.push(value));
    runs.setRequested("/a.md", "c1", true);
    runs.setRequested("/a.md", "c1", false);
    stop();
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
});

describe("isActive", () => {
  it("is true while requested, queued or running", () => {
    expect(isActive(NO_CELL_RUN)).toBe(false);
    expect(isActive({ ...NO_CELL_RUN, requested: true })).toBe(true);
    for (const state of ["queued", "running"] as const) {
      expect(isActive({ ...NO_CELL_RUN, status: { cellId: "c1", state } })).toBe(true);
    }
    for (const state of ["idle", "success", "failed", "interrupted"] as const) {
      expect(isActive({ ...NO_CELL_RUN, status: { cellId: "c1", state } })).toBe(false);
    }
  });
});
