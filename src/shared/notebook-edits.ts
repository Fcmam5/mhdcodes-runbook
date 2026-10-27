// The edits the notebook view makes (SPEC §9.3), as pure functions from a notebook to
// a new one. The old one is never changed, so a store holding it sees a new value.

import { createCell } from "./notebook";
import type { Cell, CellType, Notebook } from "./types";

export function setCellSource(notebook: Notebook, cellId: string, source: string): Notebook {
  return {
    ...notebook,
    cells: notebook.cells.map((cell) => (cell.id === cellId ? { ...cell, source } : cell)),
  };
}

// Inserts a new, empty cell at `index` (clamped to the list), and returns it too.
export function insertCell(
  notebook: Notebook,
  type: CellType,
  index: number,
): { notebook: Notebook; cell: Cell } {
  const cell = createCell(type);
  const at = Math.max(0, Math.min(index, notebook.cells.length));
  const cells = [...notebook.cells.slice(0, at), cell, ...notebook.cells.slice(at)];
  return { notebook: { ...notebook, cells }, cell };
}

export function deleteCell(notebook: Notebook, cellId: string): Notebook {
  return { ...notebook, cells: notebook.cells.filter((cell) => cell.id !== cellId) };
}

// A blank title keeps the old one: every notebook has a title (SPEC §4).
export function setTitle(notebook: Notebook, title: string): Notebook {
  const trimmed = title.trim();
  return trimmed === "" || trimmed === notebook.title ? notebook : { ...notebook, title: trimmed };
}

export function setTags(notebook: Notebook, text: string): Notebook {
  const tags = parseTags(text);
  const same = tags.length === notebook.tags.length && tags.every((t, i) => t === notebook.tags[i]);
  return same ? notebook : { ...notebook, tags };
}

// "audio, pipewire,, audio " → ["audio", "pipewire"]: trimmed, no empties, no repeats.
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
    ),
  ];
}
