import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Settings } from "../shared/types";

export function defaultSettings(): Settings {
  return { notebooksDir: join(homedir(), "Runbooks") };
}

// Reads settings.json, falling back to defaults for anything missing or invalid.
// A missing file is created with the defaults; a broken one is left alone so the
// user can fix it.
export async function loadSettings(file: string): Promise<Settings> {
  const defaults = defaultSettings();

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(defaults, null, 2)}\n`);
    return defaults;
  }

  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    return defaults;
  }
  if (typeof stored !== "object" || stored === null) return defaults;

  const { notebooksDir } = stored as Record<string, unknown>;
  return {
    notebooksDir:
      typeof notebooksDir === "string" && isAbsolute(notebooksDir)
        ? notebooksDir
        : defaults.notebooksDir,
  };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
