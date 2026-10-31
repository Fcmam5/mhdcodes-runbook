// The edits the runbook view makes, as pure functions from a runbook to
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

// A blank title keeps the old one: every runbook has a title.
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

// A runbook read again from its file, with the cell IDs it had in the window wherever
// the cells still match. Cells without an {id=…} in the file get new IDs on every read,
// and output panes and run state are keyed by cell ID: an unchanged cell keeps its own.
// A cell matches by its file ID, or else by type and source, in order.
export function keepCellIds(open: Runbook, fresh: Runbook): Runbook {
  const openIds = new Set(open.cells.map((cell) => cell.id));
  // IDs the file has itself: they stay, so no other cell may take them.
  const taken = new Set(fresh.cells.filter((cell) => openIds.has(cell.id)).map((cell) => cell.id));
  const cells = fresh.cells.map((cell) => {
    if (openIds.has(cell.id)) return cell;
    const match = open.cells.find(
      (old) => !taken.has(old.id) && old.type === cell.type && old.source === cell.source,
    );
    if (!match) return cell;
    taken.add(match.id);
    return { ...cell, id: match.id };
  });
  return { ...fresh, cells };
}
