import { renameSync, writeFileSync } from "node:fs";
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

export const DEFAULT_SIZE = { width: 1200, height: 800 };
export const MIN_SIZE = { width: 800, height: 500 };

// How much of a restored window must be on some display for its position to be kept.
// Less, and the display it was on is probably gone (an unplugged monitor).
const MIN_VISIBLE = { width: 100, height: 50 };

export function defaultWindowState(): WindowState {
  return { ...DEFAULT_SIZE };
}

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

// Fits a stored state to the displays there are now: at least the minimum size, and
// the position dropped when too little of the window would be on any display.
export function restoreWindowState(saved: WindowState | null, workAreas: Rect[]): WindowState {
  if (!saved) return defaultWindowState();
  const state: WindowState = {
    width: Math.max(saved.width, MIN_SIZE.width),
    height: Math.max(saved.height, MIN_SIZE.height),
  };
  if (saved.x !== undefined && saved.y !== undefined) {
    const window = { x: saved.x, y: saved.y, width: state.width, height: state.height };
    if (workAreas.some((area) => visible(window, area))) {
      state.x = saved.x;
      state.y = saved.y;
    }
  }
  return state;
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
// Atomic like notebook saves: a crash mid-write leaves the previous state.
export function saveWindowState(file: string, state: WindowState): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

// At least MIN_VISIBLE of the window overlaps the area.
function visible(window: Rect, area: Rect): boolean {
  const width = Math.min(window.x + window.width, area.x + area.width) - Math.max(window.x, area.x);
  const height =
    Math.min(window.y + window.height, area.y + area.height) - Math.max(window.y, area.y);
  return width >= MIN_VISIBLE.width && height >= MIN_VISIBLE.height;
}
