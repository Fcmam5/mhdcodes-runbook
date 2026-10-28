import { describe, expect, it } from "vitest";
import { messageOf } from "../src/renderer/src/state/errors";
import { formatDuration, statusLine } from "../src/renderer/src/state/status";

describe("statusLine", () => {
  it("shows a spinner while running", () => {
    expect(statusLine({ cellId: "c1", state: "running", startedAt: 1000 })).toEqual({
      icon: "spinner",
      text: "running…",
      tone: "neutral",
    });
  });

  it("shows the exit code and duration of a finished run", () => {
    expect(
      statusLine({ cellId: "c1", state: "success", exitCode: 0, startedAt: 0, endedAt: 1200 }),
    ).toEqual({ icon: "✓", text: "exit 0 · 1.2s", tone: "success" });
    expect(
      statusLine({ cellId: "c1", state: "failed", exitCode: 2, startedAt: 0, endedAt: 300 }),
    ).toEqual({ icon: "✗", text: "exit 2 · 0.3s", tone: "failure" });
  });

  it("leaves out the duration of a run that never started", () => {
    expect(statusLine({ cellId: "c1", state: "failed", exitCode: 1, endedAt: 5 })?.text).toBe(
      "exit 1",
    );
  });

  it("shows queued and interrupted runs, and nothing when idle", () => {
    expect(statusLine({ cellId: "c1", state: "queued" })?.text).toBe("queued");
    expect(
      statusLine({ cellId: "c1", state: "interrupted", startedAt: 0, endedAt: 2000 }),
    ).toMatchObject({ icon: "■", text: "interrupted · 2.0s" });
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
