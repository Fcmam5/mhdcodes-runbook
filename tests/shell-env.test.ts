import { describe, expect, it } from "vitest";
import { buildShellEnv } from "../src/main/shell/env";

describe("buildShellEnv", () => {
  it("removes Electron and dev tooling variables", () => {
    const env = buildShellEnv({
      CHROME_DESKTOP: "runbook.desktop",
      FC_FONTATIONS: "1",
      NO_AT_BRIDGE: "1",
      GDK_BACKEND: "x11",
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_RENDERER_URL: "http://localhost:5173",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
    });
    expect(env).toEqual({ TERM: "xterm-256color" });
  });

  it("removes the variables node-pty strips by default", () => {
    const env = buildShellEnv({
      TMUX: "/tmp/tmux-1000/default,1,0",
      TMUX_PANE: "%1",
      STY: "123.pts-0",
      WINDOW: "0",
      WINDOWID: "4194311",
      TERMCAP: "x",
      COLUMNS: "80",
      LINES: "24",
    });
    expect(env).toEqual({ TERM: "xterm-256color" });
  });

  it("leaves unrelated variables untouched and sets TERM", () => {
    const env = buildShellEnv({
      HOME: "/home/u",
      PATH: "/usr/local/bin:/usr/bin",
      LANG: "en_US.UTF-8",
      LD_LIBRARY_PATH: "/opt/lib",
      TERM: "dumb",
      EMPTY: "",
      UNSET: undefined,
    });
    expect(env).toEqual({
      HOME: "/home/u",
      PATH: "/usr/local/bin:/usr/bin",
      LANG: "en_US.UTF-8",
      LD_LIBRARY_PATH: "/opt/lib",
      TERM: "xterm-256color",
      EMPTY: "",
    });
  });

  it("removes AppImage variables even when not running from an AppImage", () => {
    const env = buildShellEnv({ APPDIR: "/x", ARGV0: "x", OWD: "/home/u" });
    expect(env).toEqual({ TERM: "xterm-256color" });
  });

  it("strips AppImage variables and path entries when running from an AppImage", () => {
    const env = buildShellEnv({
      APPIMAGE: "/home/u/Runbook.AppImage",
      APPDIR: "/tmp/.mount_RunbooXYZ/",
      ARGV0: "Runbook.AppImage",
      OWD: "/home/u",
      PATH: "/tmp/.mount_RunbooXYZ/usr/bin:/usr/local/bin:/tmp/.mount_RunbooXYZ:/usr/bin",
      LD_LIBRARY_PATH: "/tmp/.mount_RunbooXYZ/usr/lib",
      XDG_DATA_DIRS: "/tmp/.mount_RunbooXYZ/usr/share:/usr/share",
      GSETTINGS_SCHEMA_DIR: "/tmp/.mount_RunbooXYZ/usr/share/glib-2.0/schemas",
      HOME: "/home/u",
    });
    expect(env).toEqual({
      PATH: "/usr/local/bin:/usr/bin",
      XDG_DATA_DIRS: "/usr/share",
      HOME: "/home/u",
      TERM: "xterm-256color",
    });
  });

  it("keeps entries that only share a prefix with the AppImage folder", () => {
    const env = buildShellEnv({
      APPIMAGE: "/a/R.AppImage",
      APPDIR: "/tmp/.mount_R",
      PATH: "/tmp/.mount_R/bin:/tmp/.mount_Rother/bin",
    });
    expect(env["PATH"]).toBe("/tmp/.mount_Rother/bin");
  });
});
