// Runs real bash through node-pty. Each test gets its own folder and manager, so they
// run concurrently: most of a test's time is bash waiting, not work.
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it as base, vi } from "vitest";
import { buildShellEnv } from "../src/main/shell/env";
import { SessionManager } from "../src/main/shell/manager";
import { RCFILE } from "../src/main/shell/rcfile";
import type { CellRunStatus, SessionState } from "../src/shared/types";

const NOTEBOOK = "/notebooks/test.md";

interface Events {
  output: Map<string, string>;
  statuses: CellRunStatus[];
  states: SessionState[];
  outputOf(cellId: string): string;
}

const it = base.extend<{ root: string; manager: SessionManager; events: Events }>({
  // oxlint-disable-next-line no-empty-pattern -- vitest requires a destructured context
  root: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "runbook-session-"));
    await use(root);
    await rm(root, { recursive: true, force: true });
  },
  manager: async ({ root }, use) => {
    const manager = new SessionManager({
      rcfilePath: join(root, "userData", "rcfile.bash"),
      tempRoot: join(root, "tmp"),
      // An empty HOME, so the user's own ~/.bashrc stays out of the tests.
      env: buildShellEnv({ ...process.env, HOME: join(root, "home") }),
      cwd: root,
    });
    await use(manager);
    await manager.dispose();
  },
  events: async ({ manager }, use) => {
    const output = new Map<string, string>();
    const statuses: CellRunStatus[] = [];
    const states: SessionState[] = [];
    manager.on("output", ({ cellId, data }) =>
      output.set(cellId, (output.get(cellId) ?? "") + data),
    );
    manager.on("status", ({ status }) => statuses.push(status));
    manager.on("state", ({ state }) => states.push(state));
    const outputOf = (cellId: string) => (output.get(cellId) ?? "").replaceAll("\r\n", "\n");
    await use({ output, statuses, states, outputOf });
  },
});

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe.concurrent("SessionManager with real bash", () => {
  it("runs echo hello", async ({ manager, events: { outputOf } }) => {
    const status = await manager.run(NOTEBOOK, "c1", "echo hello");
    expect(status).toMatchObject({ cellId: "c1", state: "success", exitCode: 0 });
    expect(outputOf("c1")).toBe("hello\n");
  });

  it("keeps the working directory between runs", async ({ manager, events: { outputOf } }) => {
    await manager.run(NOTEBOOK, "c1", "cd /tmp");
    await manager.run(NOTEBOOK, "c2", "pwd");
    expect(outputOf("c2")).toBe("/tmp\n");
  });

  it("keeps exported variables between runs", async ({ manager, events: { outputOf } }) => {
    await manager.run(NOTEBOOK, "c1", "export FOO=bar");
    await manager.run(NOTEBOOK, "c2", "echo $FOO");
    expect(outputOf("c2")).toBe("bar\n");
  });

  it("reports a failing command with its exit code", async ({ manager }) => {
    expect(await manager.run(NOTEBOOK, "c1", "false")).toMatchObject({
      state: "failed",
      exitCode: 1,
    });
    expect(await manager.run(NOTEBOOK, "c2", "(exit 42)")).toMatchObject({ exitCode: 42 });
  });

  it("runs a multi-line script with a heredoc", async ({ manager, events: { outputOf } }) => {
    const source = ["name=world", "cat <<EOF", "hello $name", "  indented", "EOF", "echo done"];
    await manager.run(NOTEBOOK, "c1", source.join("\n"));
    expect(outputOf("c1")).toBe("hello world\n  indented\ndone\n");
  });

  it("forwards no marker bytes and keeps other escape sequences", async ({
    manager,
    events: { output, outputOf },
  }) => {
    await manager.run(NOTEBOOK, "c1", String.raw`printf '\e[32mgreen\e[0m\n'`);
    await manager.run(NOTEBOOK, "c2", "echo second");
    const all = [...output.values()].join("");
    expect(all).not.toContain("\x1b]777");
    expect(all).not.toContain("rb-");
    expect(outputOf("c1")).toBe("\x1b[32mgreen\x1b[0m\n");
  });

  it("discards startup output and never shows the run command", async ({
    manager,
    events: { outputOf },
  }) => {
    await manager.run(NOTEBOOK, "c1", "true");
    await manager.run(NOTEBOOK, "c2", "echo only this");
    expect(outputOf("c1")).toBe("");
    expect(outputOf("c2")).toBe("only this\n");
  });

  it("reports running, then the final status, with timestamps", async ({
    manager,
    events: { statuses },
  }) => {
    await manager.run(NOTEBOOK, "c1", "true");
    const [running, done] = statuses;
    expect(running).toMatchObject({ cellId: "c1", state: "running" });
    expect(done).toMatchObject({ cellId: "c1", state: "success", exitCode: 0 });
    expect(done?.startedAt).toBe(running?.startedAt);
    expect(done?.endedAt).toBeGreaterThanOrEqual(done?.startedAt ?? Infinity);
  });

  it("goes starting → ready → busy → ready", async ({ manager, events: { states } }) => {
    await manager.run(NOTEBOOK, "c1", "true");
    expect(states).toEqual(["starting", "ready", "busy", "ready"]);
  });

  it("runs requests made while starting or busy one at a time, in order", async ({
    manager,
    events: { statuses },
  }) => {
    const runs = [1, 2, 3].map((n) => manager.run(NOTEBOOK, `c${n}`, `sleep 0.1; echo ${n}`));
    await Promise.all(runs);
    expect(statuses.map((s) => `${s.cellId}:${s.state}`)).toEqual([
      "c1:running",
      "c1:success",
      "c2:running",
      "c2:success",
      "c3:running",
      "c3:success",
    ]);
  });

  it("keeps one session per notebook", async ({ root, manager, events: { outputOf } }) => {
    await manager.run("/notebooks/a.md", "a1", "cd /tmp");
    await manager.run("/notebooks/b.md", "b1", "pwd");
    await manager.run("/notebooks/a.md", "a2", "pwd");
    expect(outputOf("b1")).toBe(`${root}\n`);
    expect(outputOf("a2")).toBe("/tmp\n");
  });

  it("writes run scripts as private files and deletes them when the run ends", async ({
    root,
    manager,
    events: { outputOf },
  }) => {
    const scriptDir = join(root, "tmp");
    await manager.run(NOTEBOOK, "c1", `stat -c %a "\${BASH_SOURCE[0]}"`);
    expect(outputOf("c1")).toBe("600\n");
    const [sessionDir] = await readdir(scriptDir);
    expect(sessionDir).toBeDefined();
    expect((await stat(join(scriptDir, sessionDir ?? ""))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(scriptDir, sessionDir ?? ""))).toEqual([]);
  });

  it("writes the rcfile verbatim", async ({ root, manager }) => {
    await manager.run(NOTEBOOK, "c1", "true");
    expect(await readFile(join(root, "userData", "rcfile.bash"), "utf8")).toBe(RCFILE);
  });

  it("routes output printed after a run ends to the last-run cell", async ({
    manager,
    events: { outputOf },
  }) => {
    await manager.run(NOTEBOOK, "c1", "(sleep 0.2; echo late) &");
    await vi.waitFor(() => expect(outputOf("c1")).toContain("late\n"));
  });

  it("marks the session dead when the shell exits, and starts a new one next run", async ({
    manager,
    events: { states, outputOf },
  }) => {
    expect(await manager.run(NOTEBOOK, "c1", "exit 3")).toMatchObject({
      state: "failed",
      exitCode: 3,
    });
    expect(states.at(-1)).toBe("dead");
    expect(await manager.run(NOTEBOOK, "c2", "echo again")).toMatchObject({ state: "success" });
    expect(outputOf("c2")).toBe("again\n");
  });

  it("isn't stalled by a cell printing another program's OSC 777 sequence", async ({ manager }) => {
    const status = await manager.run(NOTEBOOK, "c1", String.raw`printf '\e]777;notify;hi\e\\'`);
    expect(status).toMatchObject({ state: "success" });
    expect(await manager.run(NOTEBOOK, "c2", "echo next")).toMatchObject({ state: "success" });
  });

  it("reports a shell killed by a signal as 128 + the signal", async ({ manager }) => {
    expect(await manager.run(NOTEBOOK, "c1", "kill -9 $$")).toMatchObject({
      state: "failed",
      exitCode: 137,
    });
  });

  it("fails runs, without hanging, when the shell can't start", async ({ root }) => {
    const broken = new SessionManager({
      rcfilePath: join(root, "userData", "rcfile.bash"),
      tempRoot: join(root, "tmp"),
      cwd: join(root, "missing"),
    });
    await expect(broken.run(NOTEBOOK, "c1", "true")).rejects.toThrow();
    await expect(broken.run(NOTEBOOK, "c2", "true")).rejects.toThrow();
    await broken.dispose();
  });

  it("tries the setup again after it failed once", async ({ root, manager }) => {
    // A file where the rcfile's folder should be makes writing the rcfile fail.
    await writeFile(join(root, "userData"), "");
    await expect(manager.run(NOTEBOOK, "c1", "true")).rejects.toThrow();
    await rm(join(root, "userData"));
    expect(await manager.run(NOTEBOOK, "c2", "true")).toMatchObject({ state: "success" });
  });

  it("refuses runs once disposed, including one that was still starting", async ({
    manager,
    events: { output },
  }) => {
    const pending = manager.run(NOTEBOOK, "c1", "echo never");
    await manager.dispose();
    await expect(pending).rejects.toThrow();
    await expect(manager.run(NOTEBOOK, "c2", "true")).rejects.toThrow();
    expect(output.size).toBe(0);
  });

  it("removes its own temp folder on dispose, but not one it was given", async ({
    root,
    manager,
  }) => {
    const own = new SessionManager({ rcfilePath: join(root, "own", "rcfile.bash"), cwd: root });
    const dirs: string[] = [];
    own.on("output", ({ data }) => dirs.push(data.trim()));
    await own.run(NOTEBOOK, "c1", `dirname "$(dirname "\${BASH_SOURCE[0]}")"`);
    const [tempRoot] = dirs;
    expect(tempRoot).toMatch(/\/runbook-/);
    expect(await exists(tempRoot ?? "")).toBe(true);
    await own.dispose();
    expect(await exists(tempRoot ?? "")).toBe(false);

    await manager.run(NOTEBOOK, "c1", "true");
    await manager.dispose();
    expect(await exists(join(root, "tmp"))).toBe(true);
  });
});
