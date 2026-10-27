import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureNotebooksDir,
  listNotebooks,
  readNotebook,
  createNotebook,
  deleteNotebook,
  renameNotebook,
  resolveNotebookPath,
  saveNotebook,
  slugify,
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

describe("saveNotebook", () => {
  const TEXT = "---\ntitle: Notes # keep me\n---\n\nHello\n\n```bash {id=abc12345}\necho hi\n```\n";

  async function opened(name = "notes.md", text = TEXT) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), text);
    return readNotebook(dir, join(dir, name));
  }

  it("writes the edited notebook, keeping the rest of the file as it was", async () => {
    const notebook = await opened();
    const [markdown, shell] = notebook.cells;
    await saveNotebook(dir, {
      ...notebook,
      title: "Renamed",
      cells: [{ ...markdown, source: "Hello again" }, shell],
    });
    expect(await readFile(notebook.path, "utf8")).toBe(
      "---\ntitle: Renamed # keep me\n---\n\nHello again\n\n```bash {id=abc12345}\necho hi\n```\n",
    );
  });

  it("leaves no temp file behind", async () => {
    const notebook = await opened();
    await saveNotebook(dir, notebook);
    expect(await readdir(dir)).toEqual(["notes.md"]);
  });

  it("keeps a symlinked notebook a symlink, and writes the file it points to", async () => {
    await mkdir(dir, { recursive: true });
    const real = join(root, "elsewhere.md");
    await writeFile(real, TEXT);
    await symlink(real, join(dir, "linked.md"));
    const notebook = await readNotebook(dir, join(dir, "linked.md"));
    await saveNotebook(dir, { ...notebook, title: "Through the link" });
    expect((await lstat(join(dir, "linked.md"))).isSymbolicLink()).toBe(true);
    expect(await readFile(real, "utf8")).toContain("title: Through the link");
  });

  it("keeps the file's permissions", async () => {
    const notebook = await opened();
    await chmod(notebook.path, 0o600);
    await saveNotebook(dir, { ...notebook, title: "Private" });
    expect((await stat(notebook.path)).mode & 0o777).toBe(0o600);
  });

  it("ends with the last of several overlapping saves", async () => {
    const notebook = await opened();
    await Promise.all(
      ["one", "two", "three"].map((title) => saveNotebook(dir, { ...notebook, title })),
    );
    expect(await readFile(notebook.path, "utf8")).toContain("title: three");
    expect(await readdir(dir)).toEqual(["notes.md"]);
  });

  it("refuses a path outside the notebooks folder", async () => {
    const notebook = await opened();
    await expect(
      saveNotebook(dir, { ...notebook, path: join(root, "outside.md") }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(["Runbooks"]);
  });

  it.each([
    ["not an object", null],
    ["tags that aren't strings", { tags: [1] }],
    ["an unknown line ending", { lineEnding: "\r" }],
    [
      "a cell ID that would break its {id=…}",
      { cells: [{ id: "a}b", type: "shell", source: "" }] },
    ],
    [
      "an info string spanning lines",
      { cells: [{ id: "a", type: "shell", source: "", info: "bash\nx" }] },
    ],
    ["an unknown cell type", { cells: [{ id: "a", type: "python", source: "" }] }],
  ])("refuses a notebook with %s", async (_name, change) => {
    const notebook = await opened();
    const value = change === null ? null : { ...notebook, ...change };
    await expect(saveNotebook(dir, value)).rejects.toThrow("Invalid notebook");
    expect(await readFile(notebook.path, "utf8")).toBe(TEXT);
  });
});

describe("slugify", () => {
  it.each([
    ["Fix audio after update", "fix-audio-after-update"],
    ["  Crème brûlée: notes!  ", "creme-brulee-notes"],
    ["Ünïcödé — and (more)", "unicode-and-more"],
    ["Привет мир", "привет-мир"],
    ["2026/10 release", "2026-10-release"],
    ["!!!", "untitled"],
    ["../../etc/passwd", "etc-passwd"],
  ])("%j → %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("keeps file names to 80 characters, without a trailing dash", () => {
    const slug = slugify(`${"a".repeat(79)} b`);
    expect(slug).toBe("a".repeat(79));
  });
});

describe("createNotebook", () => {
  it("creates an empty notebook named after its title", async () => {
    await mkdir(dir, { recursive: true });
    const notebook = await createNotebook(dir, "  Fix audio after update ");
    expect(notebook).toMatchObject({ title: "Fix audio after update", tags: [], cells: [] });
    expect(notebook.path).toBe(join(dir, "fix-audio-after-update.md"));
    expect(await readFile(notebook.path, "utf8")).toBe(
      "---\ntitle: Fix audio after update\ntags: []\n---\n",
    );
    expect(await readNotebook(dir, notebook.path)).toMatchObject({
      title: "Fix audio after update",
    });
  });

  it("adds -2, -3, … when the name is taken, ignoring case", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "Notes.md"), "keep me");
    const second = await createNotebook(dir, "Notes");
    const third = await createNotebook(dir, "notes");
    expect([second.path, third.path]).toEqual([join(dir, "notes-2.md"), join(dir, "notes-3.md")]);
    expect(await readFile(join(dir, "Notes.md"), "utf8")).toBe("keep me");
  });

  it("refuses a blank title", async () => {
    await mkdir(dir, { recursive: true });
    await expect(createNotebook(dir, "   ")).rejects.toThrow("needs a title");
    expect(await readdir(dir)).toEqual([]);
  });
});

async function file(name: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), text);
  return join(dir, name);
}

describe("renameNotebook", () => {
  it("renames the file after the new title and updates the title in it", async () => {
    const path = await file("old.md", "---\ntitle: Old # comment\ntags: [a]\n---\n\nBody\n");
    const renamed = await renameNotebook(dir, path, "Brand new");
    expect(renamed).toMatchObject({ path: join(dir, "brand-new.md"), title: "Brand new" });
    expect(await readdir(dir)).toEqual(["brand-new.md"]);
    expect(await readFile(renamed.path, "utf8")).toBe(
      "---\ntitle: Brand new # comment\ntags: [a]\n---\n\nBody\n",
    );
  });

  it("gives a file without frontmatter one with the new title", async () => {
    const path = await file("plain.md", "Body\n");
    const renamed = await renameNotebook(dir, path, "Plain notes");
    expect(await readFile(renamed.path, "utf8")).toBe(
      "---\ntitle: Plain notes\ntags: []\n---\n\nBody\n",
    );
  });

  it("never replaces another notebook", async () => {
    const path = await file("a.md", "---\ntitle: A\n---\n");
    await file("b.md", "other");
    const renamed = await renameNotebook(dir, path, "B");
    expect(renamed.path).toBe(join(dir, "b-2.md"));
    expect(await readFile(join(dir, "b.md"), "utf8")).toBe("other");
  });

  it("keeps the file where it is when the name doesn't change", async () => {
    const path = await file("notes.md", "---\ntitle: notes\n---\n");
    const renamed = await renameNotebook(dir, path, "Notes");
    expect(renamed.path).toBe(path);
    expect(await readFile(path, "utf8")).toBe("---\ntitle: Notes\n---\n");
  });

  it("keeps a symlinked notebook a symlink", async () => {
    await mkdir(dir, { recursive: true });
    const real = join(root, "elsewhere.md");
    await writeFile(real, "---\ntitle: Linked\n---\n");
    await symlink(real, join(dir, "linked.md"));
    const renamed = await renameNotebook(dir, join(dir, "linked.md"), "Moved link");
    expect((await lstat(renamed.path)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, "utf8")).toBe("---\ntitle: Moved link\n---\n");
  });

  it("refuses a blank title or a path outside the folder", async () => {
    const path = await file("a.md", "x");
    await expect(renameNotebook(dir, path, " ")).rejects.toThrow("needs a title");
    await expect(renameNotebook(dir, join(root, "a.md"), "B")).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["a.md"]);
  });
});

describe("deleteNotebook", () => {
  it("hands the resolved path to the trash", async () => {
    const trashed: string[] = [];
    const path = await deleteNotebook(dir, join(dir, "sub/../a.md"), async (p) => {
      trashed.push(p);
    });
    expect(trashed).toEqual([join(dir, "a.md")]);
    expect(path).toBe(join(dir, "a.md"));
  });

  it("refuses a path outside the folder, without trashing anything", async () => {
    const trashed: string[] = [];
    await expect(
      deleteNotebook(dir, "/etc/hosts.md", async (p) => {
        trashed.push(p);
      }),
    ).rejects.toThrow();
    expect(trashed).toEqual([]);
  });
});
