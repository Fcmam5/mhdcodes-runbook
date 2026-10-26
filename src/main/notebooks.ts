// Notebook storage: the files in the notebooks folder. No Electron imports, so it is
// tested against real temp folders.

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse } from "../shared/notebook";
import type { Notebook, NotebookSummary } from "../shared/types";
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
