// Notebook storage: the files in the notebooks folder. No Electron imports, so it is
// tested against real temp folders.

import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse, serialize } from "../shared/notebook";
import type { Cell, Notebook, NotebookSummary } from "../shared/types";
import { WELCOME_FILE, WELCOME_NOTEBOOK } from "./welcome";

// Creates the folder if it is missing, and seeds the Welcome notebook if it is empty.
export async function ensureNotebooksDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  if (entries.length === 0) {
    // "wx": never overwrite, in case the file appeared in the meantime.
    await writeFile(join(dir, WELCOME_FILE), WELCOME_NOTEBOOK, { flag: "wx" });
  }
}

// The .md files directly inside the folder, sorted by title. Files that can't be
// read are left out rather than failing the whole list.
export async function listNotebooks(dir: string): Promise<NotebookSummary[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  // Symlinks are followed; broken ones and links to folders fail the read below.
  const files = entries.filter(
    (entry) =>
      (entry.isFile() || entry.isSymbolicLink()) &&
      isNotebookName(entry.name) &&
      !entry.name.startsWith("."),
  );

  const summaries = await Promise.all(
    files.map(async (entry): Promise<NotebookSummary | null> => {
      const path = join(dir, entry.name);
      try {
        const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        const { title, tags } = parse(text, path);
        return { path, title, tags, mtime: info.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  return summaries
    .filter((summary) => summary !== null)
    .toSorted((a, b) => compareText(a.title, b.title) || compareText(a.path, b.path));
}

export async function readNotebook(dir: string, path: unknown): Promise<Notebook> {
  const resolved = resolveNotebookPath(dir, path);
  return parse(await readFile(resolved, "utf8"), resolved);
}

// Saves of the same file, one after another, so two never share its temp file.
const saving = new Map<string, Promise<void>>();

// Writes the notebook to its file atomically (SPEC §8): to `<file>.tmp`, then renamed
// over the file, so a crash mid-write never leaves a half-written notebook. The value
// comes from the renderer, so its path and shape are checked first.
export async function saveNotebook(dir: string, value: unknown): Promise<void> {
  const notebook = toNotebook(value);
  const path = resolveNotebookPath(dir, notebook.path);
  const text = serialize({ ...notebook, path });
  const previous = saving.get(path) ?? Promise.resolve();
  const done = previous.catch(() => {}).then(() => writeAtomically(path, text));
  saving.set(path, done);
  try {
    await done;
  } finally {
    if (saving.get(path) === done) saving.delete(path);
  }
}

async function writeAtomically(path: string, text: string): Promise<void> {
  // Renaming onto a symlink would replace the link with a plain file, so write next
  // to the file it points to. A file that doesn't exist yet is written where it is.
  const target = await realpath(path).catch(() => path);
  const mode = await stat(target).then(
    (info) => info.mode & 0o777,
    () => 0o644,
  );
  const temp = `${target}.tmp`;
  try {
    await writeFile(temp, text, { mode });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function fail(): never {
  throw new Error("Invalid notebook");
}

function toNotebook(value: unknown): Notebook {
  if (typeof value !== "object" || value === null) return fail();
  const { path, title, tags, frontmatterRaw, lineEnding, cells } = value as Record<string, unknown>;
  if (typeof path !== "string" || typeof title !== "string") return fail();
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) return fail();
  if (frontmatterRaw !== null && typeof frontmatterRaw !== "string") return fail();
  if (lineEnding !== "\n" && lineEnding !== "\r\n") return fail();
  if (!Array.isArray(cells)) return fail();
  return {
    path,
    title,
    tags,
    frontmatterRaw,
    lineEnding,
    cells: cells.map((cell: unknown) => toCell(cell) ?? fail()),
  };
}

function toCell(value: unknown): Cell | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, type, source, info } = value as Record<string, unknown>;
  // The ID ends up in a `{id=…}` attribute: what parse() reads back must be all of it.
  if (typeof id !== "string" || !/^[^\s}]+$/.test(id)) return null;
  if (typeof source !== "string") return null;
  if (type === "markdown") return { id, type, source };
  if (type !== "shell") return null;
  // The info string is the rest of the fence's opening line.
  if (info !== undefined && (typeof info !== "string" || /[\r\n]/.test(info))) return null;
  return info === undefined ? { id, type, source } : { id, type, source, info };
}

// Every path from the renderer must point to a .md file inside the notebooks folder
// (SPEC §7). Only files directly inside it count, the same ones listNotebooks shows:
// a deeper path could pass through a symlinked folder that leads anywhere on disk.
// Returns the resolved path, or throws.
export function resolveNotebookPath(dir: string, path: unknown): string {
  if (typeof path !== "string" || path.includes("\0")) {
    throw new Error("Invalid notebook path");
  }
  const root = resolve(dir);
  const resolved = resolve(root, path);
  if (dirname(resolved) !== root || !isNotebookName(resolved)) {
    throw new Error(`Not a notebook in ${root}: ${path}`);
  }
  return resolved;
}

function isNotebookName(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}
