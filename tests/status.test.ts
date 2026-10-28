import { describe, expect, it } from "vitest";
import { messageOf } from "../src/renderer/src/state/errors";
import { formatDuration, statusLine } from "../src/renderer/src/state/status";

describe("statusLine", () => {
  it("shows a spinner and how to interact while running", () => {
    expect(statusLine({ cellId: "c1", state: "running", startedAt: 1000 })).toEqual({
      icon: "spinner",
      text: "running…",
      detail: null,
      tone: "run",
      hint: "Click the output to type. Ctrl+. stops.",
    });
  });

  it("shows the exit code, with the duration as a detail", () => {
    expect(
      statusLine({ cellId: "c1", state: "success", exitCode: 0, startedAt: 0, endedAt: 1200 }),
    ).toEqual({ icon: "ok", text: "exit 0", detail: "· 1.2s", tone: "ok", hint: null });
    expect(
      statusLine({ cellId: "c1", state: "failed", exitCode: 2, startedAt: 0, endedAt: 300 }),
    ).toEqual({ icon: "bad", text: "exit 2", detail: "· 0.3s", tone: "bad", hint: null });
  });

  it("leaves out the duration of a run that never started", () => {
    expect(statusLine({ cellId: "c1", state: "failed", exitCode: 1, endedAt: 5 })).toMatchObject({
      text: "exit 1",
      detail: null,
    });
  });

  it("shows queued and interrupted runs, and nothing when idle", () => {
    expect(statusLine({ cellId: "c1", state: "queued" })).toMatchObject({
      icon: "wait",
      text: "queued",
      tone: "idle",
      hint: "Runs when the command above ends.",
    });
    expect(statusLine({ cellId: "c1", state: "interrupted", startedAt: 0, endedAt: 2000 })).toEqual(
      { icon: "halt", text: "interrupted", detail: null, tone: "idle", hint: null },
    );
    expect(statusLine({ cellId: "c1", state: "idle" })).toBeNull();
  });
});

describe("formatDuration", () => {
  it("uses tenths of a second below a minute, then minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0.0s");
    expect(formatDuration(49)).toBe("0.0s");
    expect(formatDuration(1250)).toBe("1.3s");
    expect(formatDuration(59_949)).toBe("59.9s");
    expect(formatDuration(59_950)).toBe("1m 0s");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(-5)).toBe("0.0s");
  });
});

describe("messageOf", () => {
  it("drops the prefix Electron adds to errors from the main process", () => {
    const error = new Error("Error invoking remote method 'cell:run': Error: Shell session ended");
    expect(messageOf(error)).toBe("Shell session ended");
    expect(messageOf(new Error("plain"))).toBe("plain");
    expect(messageOf("text")).toBe("text");
  });
});
