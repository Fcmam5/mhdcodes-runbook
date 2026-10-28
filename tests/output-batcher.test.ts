import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CellOutput, OutputBatcher } from "../src/main/shell/output-batcher";

describe("OutputBatcher", () => {
  let sent: CellOutput[];
  let batcher: OutputBatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    batcher = new OutputBatcher((output) => sent.push(output), 16);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("joins a cell's chunks into one message per interval", () => {
    batcher.push({ runbookPath: "/a.md", cellId: "c1", data: "hel" });
    batcher.push({ runbookPath: "/a.md", cellId: "c1", data: "lo" });
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(sent).toEqual([{ runbookPath: "/a.md", cellId: "c1", data: "hello" }]);

    batcher.push({ runbookPath: "/a.md", cellId: "c1", data: "again" });
    vi.advanceTimersByTime(16);
    expect(sent.map((output) => output.data)).toEqual(["hello", "again"]);
  });

  it("keeps cells and runbooks apart", () => {
    batcher.push({ runbookPath: "/a.md", cellId: "c1", data: "1" });
    batcher.push({ runbookPath: "/a.md", cellId: "c2", data: "2" });
    batcher.push({ runbookPath: "/b.md", cellId: "c1", data: "3" });
    batcher.push({ runbookPath: "/a.md", cellId: "c1", data: "4" });
    vi.advanceTimersByTime(16);
    expect(sent).toEqual([
      { runbookPath: "/a.md", cellId: "c1", data: "14" },
      { runbookPath: "/a.md", cellId: "c2", data: "2" },
      { runbookPath: "/b.md", cellId: "c1", data: "3" },
    ]);
  });

  it("sends held-back output at once on flush, and nothing twice", () => {
    batcher.push({ runbookPath: "/a.md", cellId: "c1", data: "x" });
    batcher.flush();
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(1);
  });

  it("does not modify the pushed objects", () => {
    const first = { runbookPath: "/a.md", cellId: "c1", data: "a" };
    batcher.push(first);
    batcher.push({ runbookPath: "/a.md", cellId: "c1", data: "b" });
    batcher.flush();
    expect(first.data).toBe("a");
  });
});
