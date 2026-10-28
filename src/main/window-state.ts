import { renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isNotFound } from "./settings";

// The window's size and position, remembered across launches (SPEC §9.4).
// x and y are missing when the position isn't known or wouldn't be on screen;
// the window is then centred.
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_SIZE = { width: 800, height: 500 };

const DEFAULT_SIZE = { width: 1200, height: 800 };

// How much of a restored window's top edge must be on a display for its position to
// be kept. The title bar sits along that edge, so the window can always be dragged.
// Less, and the display it was on is probably gone (an unplugged monitor).
const MIN_VISIBLE = { width: 100, height: 50 };

// Reads a stored state, or null if the text isn't one.
export function parseWindowState(text: string): WindowState | null {
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof stored !== "object" || stored === null) return null;
  const { x, y, width, height } = stored as Record<string, unknown>;
  if (!isInteger(width) || !isInteger(height)) return null;
  const state: WindowState = { width, height };
  if (isInteger(x) && isInteger(y)) {
    state.x = x;
    state.y = y;
  }
  return state;
}

// Fits a stored state to the displays there are now. The position is kept only when
// the window's top edge is on one of the work areas; otherwise the window is centred
// on the primary one. Either way the size is shrunk to fit that work area, but never
// below the minimum.
export function restoreWindowState(
  saved: WindowState | null,
  workAreas: Rect[],
  primary: Rect,
): WindowState {
  const size = saved ?? DEFAULT_SIZE;
  const position =
    saved?.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : null;
  const area = position && workAreas.find((each) => topEdgeOn({ ...position, ...size }, each));
  const fit = area ?? primary;
  const state: WindowState = {
    width: Math.max(MIN_SIZE.width, Math.min(size.width, fit.width)),
    height: Math.max(MIN_SIZE.height, Math.min(size.height, fit.height)),
  };
  return area && position ? { ...position, ...state } : state;
}

export async function loadWindowState(file: string): Promise<WindowState | null> {
  try {
    return parseWindowState(await readFile(file, "utf8"));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

// Synchronous, because it runs as the window closes and the app quits right after.
// Atomic like notebook saves: a failed write leaves the previous state, and no temp file.
export function saveWindowState(file: string, state: WindowState): void {
  const temp = `${file}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

// The window's top edge is on the area: at least MIN_VISIBLE.width of it, and at least
// MIN_VISIBLE.height of the area below it.
function topEdgeOn(window: Rect, area: Rect): boolean {
  const overlap =
    Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x);
  return (
    overlap >= MIN_VISIBLE.width &&
    window.y >= area.y &&
    window.y <= area.y + area.height - MIN_VISIBLE.height
  );
}
