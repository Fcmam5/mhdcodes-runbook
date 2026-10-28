import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunbookIndex, snippetFor } from "../src/main/search";
import type { Runbook } from "../src/shared/types";

describe("snippetFor", () => {
  it("shows the line with the first match", () => {
    const text = "Intro line\n\nRestart PipeWire with systemctl\nmore";
    expect(snippetFor(text, ["pipewire"])).toBe("Restart PipeWire with systemctl");
  });

  it("picks the earliest match on the first line that has one", () => {
    expect(snippetFor("no match\nb then a", ["a", "b"])).toBe("b then a");
  });

  it("cuts a long line around the match, marking the cuts", () => {
    const line = `${"x ".repeat(100)}needle${" y".repeat(100)}`;
    const snippet = snippetFor(line, ["needle"], 40);
    expect(snippet).toContain("needle");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(42);
  });

  it("keeps a match near the end of a long line in view", () => {
    const line = `${"a".repeat(200)} needle`;
    expect(snippetFor(line, ["needle"], 40).endsWith("needle")).toBe(true);
  });

  it("treats regex characters in a term as plain text", () => {
    expect(snippetFor("run c++ build", ["c++"])).toBe("run c++ build");
    expect(snippetFor("xaxb\nuse a.b here", ["a.b"])).toBe("use a.b here");
  });

  it("falls back to the first line with text when only the title matched", () => {
    expect(snippetFor("\n\n  First   real line \nsecond", ["title"])).toBe("First real line");
    expect(snippetFor("", ["title"])).toBe("");
  });
});

describe("RunbookIndex", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "runbook-search-"));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "audio.md"),
      "---\ntitle: Fix audio\ntags: [pipewire, sound]\n---\n\nAfter a kernel update.\n\n```bash\nsystemctl --user restart wireplumber\n```\n",
    );
    await writeFile(
      join(dir, "devbox.md"),
      "---\ntitle: New dev box\n---\n\nInstall git and node.\n",
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const paths = async (index: RunbookIndex, query: string): Promise<string[]> =>
    (await index.search(query)).map((result) => result.path.slice(dir.length + 1));

  it("finds runbooks by title, tags and cell content", async () => {
    const index = new RunbookIndex(dir);
    expect(await paths(index, "dev box")).toEqual(["devbox.md"]);
    expect(await paths(index, "sound")).toEqual(["audio.md"]);
    expect(await paths(index, "wireplumber")).toEqual(["audio.md"]);
    expect(await paths(index, "git")).toEqual(["devbox.md"]);
  });

  it("matches word prefixes and small typos, and needs every word", async () => {
    const index = new RunbookIndex(dir);
    expect(await paths(index, "wirepl")).toEqual(["audio.md"]);
    expect(await paths(index, "kernal")).toEqual(["audio.md"]);
    expect(await paths(index, "kernel node")).toEqual([]);
  });

  it("returns a snippet and the title with each result", async () => {
    const index = new RunbookIndex(dir);
    expect(await index.search("restart")).toEqual([
      {
        path: join(dir, "audio.md"),
        title: "Fix audio",
        snippet: "systemctl --user restart wireplumber",
      },
    ]);
  });

  it("returns nothing for an empty query", async () => {
    expect(await new RunbookIndex(dir).search("   ")).toEqual([]);
  });

  it("keeps a save made while it was still reading the folder", async () => {
    const index = new RunbookIndex(dir);
    const first = index.search("anything");
    // Saved before the loader got to the file: the loader's copy must not win.
    index.update({
      path: join(dir, "devbox.md"),
      title: "New dev box",
      tags: [],
      frontmatterRaw: null,
      lineEnding: "\n",
      cells: [{ id: "c1", type: "markdown", source: "now with zsh" }],
    });
    await first;
    expect(await paths(index, "zsh")).toEqual(["devbox.md"]);
    expect(await paths(index, "git")).toEqual([]);
  });

  it("stays current as runbooks are saved, renamed and deleted", async () => {
    const index = new RunbookIndex(dir);
    await index.search("anything"); // loads the folder
    const saved: Runbook = {
      path: join(dir, "devbox.md"),
      title: "New dev box",
      tags: [],
      frontmatterRaw: null,
      lineEnding: "\n",
      cells: [{ id: "c1", type: "shell", source: "brew install ripgrep", info: "bash" }],
    };
    index.update(saved);
    expect(await paths(index, "ripgrep")).toEqual(["devbox.md"]);
    expect(await paths(index, "git")).toEqual([]);

    index.rename(saved.path, { ...saved, path: join(dir, "laptop.md"), title: "Laptop" });
    expect(await paths(index, "ripgrep")).toEqual(["laptop.md"]);
    expect(await paths(index, "laptop")).toEqual(["laptop.md"]);

    index.remove(join(dir, "laptop.md"));
    expect(await paths(index, "ripgrep")).toEqual([]);
  });
});
