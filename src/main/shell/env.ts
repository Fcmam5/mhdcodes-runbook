// The environment for user shells: the app's own, minus what Electron, the
// dev tooling and an AppImage launcher add.

import { posix } from "node:path";

// Removed by exact name.
const REMOVED: ReadonlySet<string> = new Set([
  // Added by Electron and the dev tooling.
  "CHROME_DESKTOP",
  "FC_FONTATIONS",
  "NO_AT_BRIDGE",
  "GDK_BACKEND",
  // Stripped by node-pty by default, which it stops doing when given a custom env.
  "TMUX",
  "TMUX_PANE",
  "STY",
  "WINDOW",
  "WINDOWID",
  "TERMCAP",
  "COLUMNS",
  "LINES",
  // Set by the AppImage runtime to describe the running image. They mean nothing to user
  // commands and would mislead anything launched from the shell that checks for them.
  "APPDIR",
  "APPIMAGE",
  "ARGV0",
  "OWD",
]);

export function buildShellEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  // The launcher prepends entries inside its mount to PATH, LD_LIBRARY_PATH, XDG_DATA_DIRS,
  // GSETTINGS_SCHEMA_DIR and, depending on the AppRun, others (QT_PLUGIN_PATH, PYTHONPATH,
  // ...). The mount is created fresh at launch, so nothing the user set can point into it:
  // every such entry is the launcher's, whichever variable it is in. Left in place,
  // LD_LIBRARY_PATH alone would make user commands load the AppImage's bundled libraries.
  const mount = source["APPIMAGE"] !== undefined ? mountPoint(source["APPDIR"]) : undefined;

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || REMOVED.has(name) || name.startsWith("ELECTRON_")) continue;
    const kept = mount === undefined ? value : stripEntriesInside(value, mount);
    if (kept !== undefined) env[name] = kept;
  }
  env["TERM"] = "xterm-256color";
  return env;
}

function mountPoint(appDir: string | undefined): string | undefined {
  if (!appDir || !posix.isAbsolute(appDir)) return undefined;
  const dir = posix.resolve(appDir);
  return dir === "/" ? undefined : dir;
}

// Undefined when every entry was inside the mount.
function stripEntriesInside(value: string, mount: string): string | undefined {
  const entries = value.split(":");
  const kept = entries.filter((entry) => !isInside(entry, mount));
  if (kept.length === entries.length) return value;
  return kept.some((entry) => entry !== "") ? kept.join(":") : undefined;
}

function isInside(entry: string, dir: string): boolean {
  if (!posix.isAbsolute(entry)) return false;
  // resolve() on an absolute path collapses "//", "." and "..", and drops a trailing slash.
  const path = posix.resolve(entry);
  return path === dir || path.startsWith(`${dir}/`);
}
