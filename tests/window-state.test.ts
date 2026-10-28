import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadWindowState,
  parseWindowState,
  restoreWindowState,
  saveWindowState,
} from "../src/main/window-state";

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };
const RIGHT_SCREEN = { x: 1920, y: 0, width: 2560, height: 1440 };

describe("parseWindowState", () => {
  it("reads size and position", () => {
    const text = JSON.stringify({ x: 10, y: 20, width: 1000, height: 700 });
    expect(parseWindowState(text)).toEqual({ x: 10, y: 20, width: 1000, height: 700 });
  });

  it("leaves the position out unless both x and y are integers", () => {
    expect(parseWindowState(JSON.stringify({ x: 10, width: 1000, height: 700 }))).toEqual({
      width: 1000,
      height: 700,
    });
    expect(
      parseWindowState(JSON.stringify({ x: 1.5, y: 2, width: 1000, height: 700 })),
    ).not.toHaveProperty("x");
  });

  it.each([
    ["broken JSON", "{ nope"],
    ["a non-object", "[]"],
    ["null", "null"],
    ["a missing height", JSON.stringify({ width: 1000 })],
    ["a non-number width", JSON.stringify({ width: "1000", height: 700 })],
  ])("returns null for %s", (_reason, text) => {
    expect(parseWindowState(text)).toBeNull();
  });
});

describe("restoreWindowState", () => {
  it("defaults to 1200×800, centred, when nothing is stored", () => {
    expect(restoreWindowState(null, [SCREEN], SCREEN)).toEqual({ width: 1200, height: 800 });
  });

  it("fits the default size to a small primary display", () => {
    const small = { x: 0, y: 0, width: 1024, height: 600 };
    expect(restoreWindowState(null, [small], small)).toEqual({ width: 1024, height: 600 });
  });

  it("keeps a stored size and position that is on screen", () => {
    const saved = { x: 2000, y: 100, width: 1400, height: 900 };
    expect(restoreWindowState(saved, [SCREEN, RIGHT_SCREEN], SCREEN)).toEqual(saved);
  });

  it("grows a stored size to the 800×500 minimum", () => {
    const saved = { x: 0, y: 0, width: 300, height: 200 };
    expect(restoreWindowState(saved, [SCREEN], SCREEN)).toMatchObject({
      width: 800,
      height: 500,
    });
  });

  it("shrinks a stored size to the display it opens on", () => {
    const saved = { x: 2000, y: 0, width: 2400, height: 1350 };
    expect(restoreWindowState(saved, [SCREEN, RIGHT_SCREEN], SCREEN)).toEqual(saved);
    expect(restoreWindowState(saved, [SCREEN], SCREEN)).toEqual({ width: 1920, height: 1080 });
  });

  it("never shrinks below the minimum, even on a smaller display", () => {
    const tiny = { x: 0, y: 0, width: 640, height: 480 };
    expect(restoreWindowState(null, [tiny], tiny)).toEqual({ width: 800, height: 500 });
  });

  it("drops the position when the display it was on is gone", () => {
    const saved = { x: 2000, y: 100, width: 1400, height: 900 };
    expect(restoreWindowState(saved, [SCREEN], SCREEN)).toEqual({ width: 1400, height: 900 });
  });

  it("drops the position when only a sliver of the window would show", () => {
    const saved = { x: 1880, y: 100, width: 1000, height: 700 };
    expect(restoreWindowState(saved, [SCREEN], SCREEN)).not.toHaveProperty("x");
  });

  it("drops the position when the top edge is above the display", () => {
    const saved = { x: 100, y: -800, width: 1000, height: 900 };
    expect(restoreWindowState(saved, [SCREEN], SCREEN)).not.toHaveProperty("x");
  });

  it("drops the position when the top edge is at the display's bottom", () => {
    const saved = { x: 100, y: 1060, width: 1000, height: 700 };
    expect(restoreWindowState(saved, [SCREEN], SCREEN)).not.toHaveProperty("x");
  });
});

describe("loadWindowState and saveWindowState", () => {
  let root: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "runbook-window-state-"));
    file = join(root, "window-state.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns null when nothing has been saved", async () => {
    expect(await loadWindowState(file)).toBeNull();
  });

  it("returns null for a broken file", async () => {
    await writeFile(file, "{ nope");
    expect(await loadWindowState(file)).toBeNull();
  });

  it("loads what was saved", async () => {
    const state = { x: 5, y: 6, width: 1000, height: 700 };
    saveWindowState(file, state);
    expect(await loadWindowState(file)).toEqual(state);
    expect(await readFile(file, "utf8")).toMatch(/\n$/);
  });

  it("removes its temp file when the save fails", async () => {
    await mkdir(file);
    expect(() => saveWindowState(file, { width: 1000, height: 700 })).toThrow();
    expect(await readdir(root)).toEqual(["window-state.json"]);
  });
});
