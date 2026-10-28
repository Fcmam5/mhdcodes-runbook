import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSettings } from "../src/main/settings";

const DEFAULT_DIR = join(homedir(), "Runbooks");
let root: string;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "runbook-settings-"));
  file = join(root, "userData", "settings.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadSettings", () => {
  it("defaults runbooksDir to ~/Runbooks and writes settings.json", async () => {
    expect(await loadSettings(file)).toEqual({ runbooksDir: DEFAULT_DIR });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ runbooksDir: DEFAULT_DIR });
  });

  it("reads a stored runbooksDir", async () => {
    await loadSettings(file);
    await writeFile(file, JSON.stringify({ runbooksDir: "/srv/runbooks" }));
    expect(await loadSettings(file)).toEqual({ runbooksDir: "/srv/runbooks" });
  });

  it.each([
    ["broken JSON", "{ nope"],
    ["a non-object", "[]"],
    ["a relative folder", JSON.stringify({ runbooksDir: "Runbooks" })],
    ["a non-string folder", JSON.stringify({ runbooksDir: 7 })],
  ])("falls back to the default for %s and leaves the file alone", async (_reason, text) => {
    await loadSettings(file);
    await writeFile(file, text);
    expect(await loadSettings(file)).toEqual({ runbooksDir: DEFAULT_DIR });
    expect(await readFile(file, "utf8")).toBe(text);
  });
});
