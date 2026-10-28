// The edits the runbook view makes (SPEC §9.3), as pure functions from a runbook to
// a new one. The old one is never changed, so a store holding it sees a new value.

import { createCell } from "../../../shared/runbook";
import type { Cell, CellType, Runbook } from "../../../shared/types";

export function setCellSource(runbook: Runbook, cellId: string, source: string): Runbook {
  return {
    ...runbook,
    cells: runbook.cells.map((cell) => (cell.id === cellId ? { ...cell, source } : cell)),
  };
}

// Inserts a new, empty cell at `index` (clamped to the list), and returns it too.
export function insertCell(
  runbook: Runbook,
  type: CellType,
  index: number,
): { runbook: Runbook; cell: Cell } {
  const cell = createCell(type);
  const at = Math.max(0, Math.min(index, runbook.cells.length));
  const cells = [...runbook.cells.slice(0, at), cell, ...runbook.cells.slice(at)];
  return { runbook: { ...runbook, cells }, cell };
}

export function deleteCell(runbook: Runbook, cellId: string): Runbook {
  return { ...runbook, cells: runbook.cells.filter((cell) => cell.id !== cellId) };
}

// A blank title keeps the old one: every runbook has a title (SPEC §4).
export function setTitle(runbook: Runbook, title: string): Runbook {
  const trimmed = title.trim();
  return trimmed === "" || trimmed === runbook.title ? runbook : { ...runbook, title: trimmed };
}

export function setTags(runbook: Runbook, text: string): Runbook {
  const tags = parseTags(text);
  const same = tags.length === runbook.tags.length && tags.every((t, i) => t === runbook.tags[i]);
  return same ? runbook : { ...runbook, tags };
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
