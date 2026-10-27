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

// What main returns for a rename: the file read back, so a cell without an {id=…}
// got an ID of its own.
function renamedTo(path: string, title: string): () => Promise<Notebook> {
  return async () => ({
    ...notebook(path),
    title,
    cells: [{ id: "main-id", type: "markdown", source: "Hello" }],
  });
}

describe("notebook store: rename and delete", () => {
  let saved: Notebook[];
  const save = async (value: Notebook): Promise<void> => {
    await Promise.resolve();
    saved.push(value);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves pending edits first, then moves the notebook, keeping its cells", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setCellSource(n, "s1", "echo edited"));
    const moved = await store.rename("/n/a.md", renamedTo("/n/b.md", "B"));
    expect(saved.map((n) => [n.path, n.cells[1]?.source])).toEqual([["/n/a.md", "echo edited"]]);
    expect(moved).toMatchObject({ path: "/n/b.md", title: "B" });
    expect(moved.cells.map((cell) => cell.id)).toEqual(["m1", "s1"]);
    expect(Object.keys(get(store))).toEqual(["/n/b.md"]);
  });

  it("holds saves while the file moves, and saves later edits under the new path", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    let finish: ((value: Notebook) => void) | undefined;
    const renaming = store.rename(
      "/n/a.md",
      () => new Promise<Notebook>((resolve) => (finish = resolve)),
    );
    await vi.waitFor(() => expect(finish).toBeDefined());
    store.edit("/n/a.md", (n) => setCellSource(n, "s1", "typed meanwhile"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual([]);
    finish?.({ ...notebook("/n/b.md"), title: "B" });
    await renaming;
    await vi.advanceTimersByTimeAsync(500);
    expect(saved.map((n) => [n.path, n.title, n.cells[1]?.source])).toEqual([
      ["/n/b.md", "B", "typed meanwhile"],
    ]);
  });

  it("leaves the notebook where it was when the rename fails", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    await expect(
      store.rename("/n/a.md", () => Promise.reject(new Error("name taken"))),
    ).rejects.toThrow("name taken");
    expect(Object.keys(get(store))).toEqual(["/n/a.md"]);
    store.edit("/n/a.md", (n) => setTitle(n, "Still saves"));
    await vi.advanceTimersByTimeAsync(500);
    expect(saved.map((n) => n.path)).toEqual(["/n/a.md"]);
  });

  it("renames a notebook that isn't open by just running the rename", async () => {
    const store = createNotebookStore({ save });
    const moved = await store.rename("/n/a.md", renamedTo("/n/b.md", "B"));
    expect(moved.path).toBe("/n/b.md");
    expect(get(store)).toEqual({});
  });

  it("deletes a notebook after a save in flight, dropping its unsaved edits", async () => {
    let release: (() => void) | undefined;
    const slowSave = async (value: Notebook): Promise<void> => {
      await new Promise<void>((resolve) => (release = resolve));
      saved.push(value);
    };
    const store = createNotebookStore({ save: slowSave });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setTitle(n, "Saving"));
    void store.flush("/n/a.md");
    await vi.waitFor(() => expect(release).toBeDefined());
    store.edit("/n/a.md", (n) => setTitle(n, "Never saved"));
    const deleted: string[] = [];
    const removing = store.remove("/n/a.md", async () => {
      // The save in flight must be done before the file goes.
      deleted.push(`deleted after ${saved.length} save`);
    });
    release?.();
    await removing;
    await vi.advanceTimersByTimeAsync(1000);
    expect(deleted).toEqual(["deleted after 1 save"]);
    expect(saved.map((n) => n.title)).toEqual(["Saving"]);
    expect(get(store)).toEqual({});
  });

  it("keeps a notebook, and its unsaved edits, when the delete fails", async () => {
    const store = createNotebookStore({ save });
    store.open(notebook());
    store.edit("/n/a.md", (n) => setTitle(n, "Kept"));
    await expect(
      store.remove("/n/a.md", () => Promise.reject(new Error("no trash"))),
    ).rejects.toThrow("no trash");
    await vi.advanceTimersByTimeAsync(500);
    expect(saved.map((n) => n.title)).toEqual(["Kept"]);
    expect(get(store)["/n/a.md"]?.title).toBe("Kept");
  });
});
