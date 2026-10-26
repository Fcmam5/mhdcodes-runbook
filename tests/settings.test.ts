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
  it("defaults notebooksDir to ~/Runbooks and writes settings.json", async () => {
    expect(await loadSettings(file)).toEqual({ notebooksDir: DEFAULT_DIR });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ notebooksDir: DEFAULT_DIR });
  });

  it("reads a stored notebooksDir", async () => {
    await loadSettings(file);
    await writeFile(file, JSON.stringify({ notebooksDir: "/srv/runbooks" }));
    expect(await loadSettings(file)).toEqual({ notebooksDir: "/srv/runbooks" });
  });

  it.each([
    ["broken JSON", "{ nope"],
    ["a non-object", "[]"],
    ["a relative folder", JSON.stringify({ notebooksDir: "Runbooks" })],
    ["a non-string folder", JSON.stringify({ notebooksDir: 7 })],
  ])("falls back to the default for %s and leaves the file alone", async (_reason, text) => {
    await loadSettings(file);
    await writeFile(file, text);
    expect(await loadSettings(file)).toEqual({ notebooksDir: DEFAULT_DIR });
    expect(await readFile(file, "utf8")).toBe(text);
  });
});
