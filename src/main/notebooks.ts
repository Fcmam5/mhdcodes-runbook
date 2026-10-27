// Notebook storage: the files in the notebooks folder. No Electron imports, so it is
// tested against real temp folders.

import {
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
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

// Writes in progress per file (see queueWrite).
const saving = new Map<string, Promise<void>>();

// Writes the notebook to its file atomically (SPEC §8): to `<file>.tmp`, then renamed
// over the file, so a crash mid-write never leaves a half-written notebook. The value
// comes from the renderer, so its path and shape are checked first.
// Resolves with the notebook as saved, for the search index.
export async function saveNotebook(dir: string, value: unknown): Promise<Notebook> {
  const notebook = toNotebook(value);
  const saved = { ...notebook, path: resolveNotebookPath(dir, notebook.path) };
  await queueWrite(saved.path, serialize(saved));
  return saved;
}

// Creates an empty notebook named after its title (SPEC §8), never overwriting a file.
export async function createNotebook(dir: string, title: unknown): Promise<Notebook> {
  const clean = toTitle(title);
  for (const name of await freeNames(dir, clean)) {
    const notebook = emptyNotebook(join(resolve(dir), name), clean);
    try {
      // "wx": if the name was taken meanwhile, try the next one.
      await writeFile(notebook.path, serialize(notebook), { flag: "wx" });
      return notebook;
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
    }
  }
  throw new Error("No free file name for this title");
}

// Gives the notebook a new title and a file named after it, keeping its contents.
// Returns it as written; the caller keeps its own cells (their IDs key the run state).
export async function renameNotebook(
  dir: string,
  path: unknown,
  newTitle: unknown,
): Promise<Notebook> {
  const from = resolveNotebookPath(dir, path);
  const title = toTitle(newTitle);
  const notebook = parse(await readFile(from, "utf8"), from);
  let to = from;
  for (const name of await freeNames(dir, title, from)) {
    const candidate = join(resolve(dir), name);
    if (candidate === from || (await moveWithoutReplacing(from, candidate))) {
      to = candidate;
      break;
    }
  }
  // Title and path change together: for a file without frontmatter, serialize()
  // compares the title with the file name.
  const renamed = { ...notebook, path: to, title };
  await queueWrite(to, serialize(renamed));
  return renamed;
}

// Moves the notebook to the OS trash (SPEC §7). `trash` is Electron's shell.trashItem.
export async function deleteNotebook(
  dir: string,
  path: unknown,
  trash: (path: string) => Promise<void>,
): Promise<string> {
  const resolved = resolveNotebookPath(dir, path);
  await trash(resolved);
  return resolved;
}

// "Fix audio after update" → "fix-audio-after-update". Letters and digits of any
// script are kept, accents dropped (é → e); everything else becomes a single dash.
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "untitled" : slug;
}

// File names for a title in the order to try them: `slug.md`, `slug-2.md`, … skipping
// names already in the folder, compared case-insensitively like listNotebooks does.
// `own` is the notebook being renamed: its current name counts as free.
async function freeNames(dir: string, title: string, own?: string): Promise<string[]> {
  const taken = new Set(
    (await readdir(dir))
      .filter((name) => own === undefined || join(resolve(dir), name) !== own)
      .map((name) => name.toLowerCase()),
  );
  const slug = slugify(title);
  const names: string[] = [];
  for (let n = 1; names.length < 20 && n < 1000; n++) {
    const name = n === 1 ? `${slug}.md` : `${slug}-${n}.md`;
    if (!taken.has(name)) names.push(name);
  }
  return names;
}

// Renames `from` to `to` unless `to` exists; false if it does. A hard link fails on an
// existing name, where rename() would replace it. On filesystems without hard links
// (FAT on a USB stick), it falls back to checking first.
async function moveWithoutReplacing(from: string, to: string): Promise<boolean> {
  try {
    await link(from, to);
  } catch (error) {
    if (isCode(error, "EEXIST")) return false;
    if (!isCode(error, "EPERM") && !isCode(error, "ENOTSUP") && !isCode(error, "EXDEV")) {
      throw error;
    }
    if (
      await lstat(to).then(
        () => true,
        () => false,
      )
    )
      return false;
    await rename(from, to);
    return true;
  }
  await unlink(from);
  return true;
}

function emptyNotebook(path: string, title: string): Notebook {
  return { path, title, tags: [], frontmatterRaw: null, lineEnding: "\n", cells: [] };
}

function toTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (title === "") throw new Error("A notebook needs a title");
  return title;
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

// Writes of the same file run one after another, so two never share its temp file.
async function queueWrite(path: string, text: string): Promise<void> {
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
