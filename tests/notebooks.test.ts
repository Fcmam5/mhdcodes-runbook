import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureNotebooksDir,
  listNotebooks,
  readNotebook,
  resolveNotebookPath,
} from "../src/main/notebooks";
import { WELCOME_NOTEBOOK } from "../src/main/welcome";
import { parse, serialize } from "../src/shared/notebook";

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "runbook-test-"));
  dir = join(root, "Runbooks");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveNotebookPath", () => {
  it("accepts a .md file inside the folder", () => {
    expect(resolveNotebookPath("/home/u/Runbooks", "/home/u/Runbooks/a.md")).toBe(
      "/home/u/Runbooks/a.md",
    );
    expect(resolveNotebookPath("/home/u/Runbooks/", "/home/u/Runbooks/sub/../b.MD")).toBe(
      "/home/u/Runbooks/b.MD",
    );
  });

  it.each([
    ["outside the folder", "/home/u/other.md"],
    ["escaping with ..", "/home/u/Runbooks/../secrets.md"],
    ["a sibling folder sharing the prefix", "/home/u/Runbooks-old/a.md"],
    ["the folder itself", "/home/u/Runbooks"],
    ["not a .md file", "/home/u/Runbooks/a.txt"],
    ["in a subfolder", "/home/u/Runbooks/sub/a.md"],
    ["a .md folder name with another file", "/home/u/Runbooks/a.md/x.sh"],
    ["a NUL byte", "/home/u/Runbooks/a\0.md"],
  ])("rejects a path %s", (_reason, path) => {
    expect(() => resolveNotebookPath("/home/u/Runbooks", path)).toThrow();
  });

  it("accepts files directly inside a root folder", () => {
    expect(resolveNotebookPath("/", "/a.md")).toBe("/a.md");
  });

  it.each([undefined, null, 42, {}, ["/home/u/Runbooks/a.md"]])(
    "rejects a non-string path (%j)",
    (path) => {
      expect(() => resolveNotebookPath("/home/u/Runbooks", path)).toThrow();
    },
  );
});

describe("ensureNotebooksDir", () => {
  it("creates a missing folder and seeds Welcome.md", async () => {
    await ensureNotebooksDir(dir);
    expect(await readdir(dir)).toEqual(["Welcome.md"]);
    expect(await readFile(join(dir, "Welcome.md"), "utf8")).toBe(WELCOME_NOTEBOOK);
  });

  it("leaves a folder with files in it untouched", async () => {
    await mkdir(dir);
    await writeFile(join(dir, "notes.txt"), "x");
    await ensureNotebooksDir(dir);
    expect(await readdir(dir)).toEqual(["notes.txt"]);
  });

  it("does not seed Welcome.md again once the user deletes it", async () => {
    await ensureNotebooksDir(dir);
    await writeFile(join(dir, "mine.md"), "Mine\n");
    await rm(join(dir, "Welcome.md"));
    await ensureNotebooksDir(dir);
    expect(await readdir(dir)).toEqual(["mine.md"]);
  });
});

describe("listNotebooks", () => {
  it("lists .md files sorted by title, with tags and mtime", async () => {
    await mkdir(dir);
    await writeFile(join(dir, "zeta.md"), "---\ntitle: Alpha\ntags: [x]\n---\n");
    await writeFile(join(dir, "beta.md"), "Text\n");
    await writeFile(join(dir, "item10.md"), "");
    await writeFile(join(dir, "item9.md"), "");

    const list = await listNotebooks(dir);
    expect(list.map((nb) => [nb.title, nb.tags])).toEqual([
      ["Alpha", ["x"]],
      ["beta", []],
      ["item9", []],
      ["item10", []],
    ]);
    expect(list[0]?.path).toBe(join(dir, "zeta.md"));
    expect(list[0]?.mtime).toBeGreaterThan(0);
  });

  it("skips other files, hidden files, subfolders and unreadable entries", async () => {
    await mkdir(join(dir, "folder.md"), { recursive: true });
    await writeFile(join(dir, "a.md"), "");
    await writeFile(join(dir, "notes.txt"), "");
    await writeFile(join(dir, ".hidden.md"), "");
    await symlink(join(root, "missing.md"), join(dir, "broken.md"));
    await symlink(join(dir, "folder.md"), join(dir, "folder-link.md"));
    expect((await listNotebooks(dir)).map((nb) => nb.title)).toEqual(["a"]);
  });

  it("follows symlinked notebooks", async () => {
    await mkdir(dir);
    await writeFile(join(root, "shared.md"), "---\ntitle: Shared\n---\n");
    await symlink(join(root, "shared.md"), join(dir, "shared.md"));
    expect((await listNotebooks(dir)).map((nb) => nb.title)).toEqual(["Shared"]);
  });
});

describe("readNotebook", () => {
  it("reads and parses a notebook inside the folder", async () => {
    await ensureNotebooksDir(dir);
    const notebook = await readNotebook(dir, join(dir, "Welcome.md"));
    expect(notebook.title).toBe("Welcome to Runbook");
    expect(notebook.cells.length).toBeGreaterThan(0);
  });

  it("refuses a path through a symlinked folder", async () => {
    await mkdir(dir);
    await mkdir(join(root, "elsewhere"));
    await writeFile(join(root, "elsewhere", "private.md"), "secret\n");
    await symlink(join(root, "elsewhere"), join(dir, "ext"));
    await expect(readNotebook(dir, join(dir, "ext", "private.md"))).rejects.toThrow();
  });

  it("refuses a path outside the folder without reading it", async () => {
    await mkdir(dir);
    const outside = join(root, "outside.md");
    await writeFile(outside, "secret\n");
    await expect(readNotebook(dir, outside)).rejects.toThrow();
  });
});

describe("Welcome notebook", () => {
  const notebook = parse(WELCOME_NOTEBOOK, "/notebooks/Welcome.md");
  const shellSources = notebook.cells
    .filter((cell) => cell.type === "shell")
    .map((cell) => cell.source);

  it("shows markdown cells, cd + pwd persistence and a coloured echo", () => {
    expect(notebook.cells.some((cell) => cell.type === "markdown")).toBe(true);
    expect(shellSources).toEqual([
      "cd /tmp",
      "pwd",
      String.raw`echo -e "\e[32mgreen\e[0m, \e[33myellow\e[0m and \e[1;34mbold blue\e[0m"`,
    ]);
  });

  it("is already in saved form, so opening it never rewrites it", () => {
    expect(serialize(notebook)).toBe(WELCOME_NOTEBOOK);
  });
});
