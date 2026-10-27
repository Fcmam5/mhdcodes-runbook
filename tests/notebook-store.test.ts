import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteCell,
  insertCell,
  parseTags,
  setCellSource,
  setTags,
  setTitle,
} from "../src/shared/notebook-edits";
import { createNotebookStore } from "../src/shared/notebook-store";
import type { Notebook } from "../src/shared/types";

function notebook(path = "/n/a.md"): Notebook {
  return {
    path,
    title: "A",
    tags: [],
    frontmatterRaw: null,
    lineEnding: "\n",
    cells: [
      { id: "m1", type: "markdown", source: "Hello" },
      { id: "s1", type: "shell", source: "echo hi", info: "bash" },
    ],
  };
}

describe("notebook edits", () => {
  it("change one cell's source and leave the rest alone", () => {
    const before = notebook();
    const after = setCellSource(before, "s1", "echo bye");
    expect(after.cells.map((cell) => cell.source)).toEqual(["Hello", "echo bye"]);
    expect(after.cells[0]).toBe(before.cells[0]);
    expect(before.cells[1]?.source).toBe("echo hi");
  });

  it("insert an empty cell at a position, clamped to the list", () => {
    const { notebook: after, cell } = insertCell(notebook(), "shell", 1);
    expect(after.cells.map((c) => c.id)).toEqual(["m1", cell.id, "s1"]);
    expect(cell).toMatchObject({ type: "shell", source: "", info: "bash" });
    const atEnd = insertCell(notebook(), "markdown", 99);
    expect(atEnd.notebook.cells.at(-1)).toBe(atEnd.cell);
  });

  it("delete a cell", () => {
    expect(deleteCell(notebook(), "m1").cells.map((c) => c.id)).toEqual(["s1"]);
  });

  it("set the title, keeping the old one for a blank title", () => {
    expect(setTitle(notebook(), "  New  ").title).toBe("New");
    const before = notebook();
    expect(setTitle(before, "   ")).toBe(before);
    expect(setTitle(before, "A")).toBe(before);
  });

  it("set tags from comma-separated text", () => {
    expect(parseTags(" audio, pipewire,,audio ,")).toEqual(["audio", "pipewire"]);
    expect(setTags(notebook(), "x, y").tags).toEqual(["x", "y"]);
    const before = notebook();
    expect(setTags(before, " , ")).toBe(before);
  });
});

describe("notebook store", () => {
  let saved: Notebook[];
  let failNext: boolean;
  const save = async (value: Notebook): Promise<void> => {
    await Promise.resolve();
    if (failNext) {
      failNext = false;
      throw new Error("disk full");
    }
    saved.push(value);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
    failNext = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a notebook as first opened", () => {
    const store = createNotebookStore({ save });
    const first = store.open(notebook());
    expect(store.open(notebook())).toBe(first);
    expect(get(store)["/n/a.md"]).toBe(first);
  });

  it("saves 500 ms after the last edit, once", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setTitle(n, "B"));
    await vi.advanceTimersByTimeAsync(300);
    store.edit("/n/a.md", (n) => setTitle(n, "C"));
    await vi.advanceTimersByTimeAsync(499);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved.map((n) => n.title)).toEqual(["C"]);
  });

  it("doesn't save an edit that changed nothing", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setTitle(n, "A"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual([]);
  });

  it("saves at once on flush, and nothing when there is nothing to save", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    await store.flush("/n/a.md");
    expect(saved).toEqual([]);
    store.edit("/n/a.md", (n) => setTitle(n, "B"));
    await store.flush("/n/a.md");
    expect(saved.map((n) => n.title)).toEqual(["B"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toHaveLength(1);
  });

  it("saves an edit made during a save once that save is done, not alongside it", async () => {
    let release: (() => void) | undefined;
    const titles: string[] = [];
    let inFlight = 0;
    const slowSave = async (value: Notebook): Promise<void> => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      titles.push(value.title);
      await new Promise<void>((resolve) => (release = resolve));
      inFlight -= 1;
    };
    const store = createNotebookStore({ save: slowSave });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setTitle(n, "B"));
    const first = store.flush("/n/a.md");
    await vi.waitFor(() => expect(titles).toEqual(["B"]));
    store.edit("/n/a.md", (n) => setTitle(n, "C"));
    const second = store.flush("/n/a.md");
    release?.();
    await first;
    await vi.waitFor(() => expect(titles).toEqual(["B", "C"]));
    release?.();
    await second;
  });

  it("saves only the latest version when edits come before the save starts", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setTitle(n, "B"));
    const first = store.flush("/n/a.md");
    store.edit("/n/a.md", (n) => setTitle(n, "C"));
    await Promise.all([first, store.flush("/n/a.md")]);
    expect(saved.map((n) => n.title)).toEqual(["C"]);
  });

  it("reports a failed save and tries again on the next flush", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setTitle(n, "B"));
    failNext = true;
    await expect(store.flush("/n/a.md")).rejects.toThrow("disk full");
    expect(get(store.errors)).toEqual({ "/n/a.md": "disk full" });
    await store.flush("/n/a.md");
    expect(saved.map((n) => n.title)).toEqual(["B"]);
    expect(get(store.errors)).toEqual({});
  });

  it("flushes every notebook with unsaved changes", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook("/n/a.md"));
    store.open(notebook("/n/b.md"));
    store.open(notebook("/n/c.md"));
    store.edit("/n/a.md", (n) => setTitle(n, "A2"));
    store.edit("/n/b.md", (n) => setTitle(n, "B2"));
    await store.flushAll();
    expect(saved.map((n) => n.path).toSorted()).toEqual(["/n/a.md", "/n/b.md"]);
  });
});
