// Runs real bash through node-pty. Each test gets its own folder and manager, so they
// run concurrently: most of a test's time is bash waiting, not work.
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it as base, vi } from "vitest";
import { buildShellEnv } from "../src/main/shell/env";
import { SessionManager } from "../src/main/shell/manager";
import { RCFILE } from "../src/main/shell/rcfile";
import type { CellRunStatus, SessionEnd, SessionState } from "../src/shared/types";

const RUNBOOK = "/runbooks/test.md";

interface Events {
  output: Map<string, string>;
  statuses: CellRunStatus[];
  states: SessionState[];
  ends: SessionEnd[];
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
    const ends: SessionEnd[] = [];
    manager.on("output", ({ cellId, data }) =>
      output.set(cellId, (output.get(cellId) ?? "") + data),
    );
    manager.on("status", ({ status }) => statuses.push(status));
    manager.on("state", ({ state, end }) => {
      states.push(state);
      if (end) ends.push(end);
    });
    const outputOf = (cellId: string) => (output.get(cellId) ?? "").replaceAll("\r\n", "\n");
    await use({ output, statuses, states, ends, outputOf });
  },
});

function waitForRunning(manager: SessionManager, cellId: string): Promise<void> {
  return new Promise((resolve) => {
    const onStatus = ({ status }: { status: CellRunStatus }): void => {
      if (status.cellId !== cellId || status.state !== "running") return;
      manager.off("status", onStatus);
      resolve();
    };
    manager.on("status", onStatus);
  });
}

// Input only reaches a run once bash has started it, so wait for its first output.
async function sendWhenStarted(
  manager: SessionManager,
  outputOf: (cellId: string) => string,
  cellId: string,
  data: string,
): Promise<void> {
  await vi.waitFor(() => expect(outputOf(cellId)).not.toBe(""));
  manager.sendInput(RUNBOOK, data);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe.concurrent("SessionManager with real bash", () => {
  it("runs echo hello", async ({ manager, events: { outputOf } }) => {
    const status = await manager.run(RUNBOOK, "c1", "echo hello");
    expect(status).toMatchObject({ cellId: "c1", state: "success", exitCode: 0 });
    expect(outputOf("c1")).toBe("hello\n");
  });

  it("keeps the working directory between runs", async ({ manager, events: { outputOf } }) => {
    await manager.run(RUNBOOK, "c1", "cd /tmp");
    await manager.run(RUNBOOK, "c2", "pwd");
    expect(outputOf("c2")).toBe("/tmp\n");
  });

  it("keeps exported variables between runs", async ({ manager, events: { outputOf } }) => {
    await manager.run(RUNBOOK, "c1", "export FOO=bar");
    await manager.run(RUNBOOK, "c2", "echo $FOO");
    expect(outputOf("c2")).toBe("bar\n");
  });

  it("reports a failing command with its exit code", async ({ manager }) => {
    expect(await manager.run(RUNBOOK, "c1", "false")).toMatchObject({
      state: "failed",
      exitCode: 1,
    });
    expect(await manager.run(RUNBOOK, "c2", "(exit 42)")).toMatchObject({ exitCode: 42 });
  });

  it("runs a multi-line script with a heredoc", async ({ manager, events: { outputOf } }) => {
    const source = ["name=world", "cat <<EOF", "hello $name", "  indented", "EOF", "echo done"];
    await manager.run(RUNBOOK, "c1", source.join("\n"));
    expect(outputOf("c1")).toBe("hello world\n  indented\ndone\n");
  });

  it("forwards no marker bytes and keeps other escape sequences", async ({
    manager,
    events: { output, outputOf },
  }) => {
    await manager.run(RUNBOOK, "c1", String.raw`printf '\e[32mgreen\e[0m\n'`);
    await manager.run(RUNBOOK, "c2", "echo second");
    const all = [...output.values()].join("");
    expect(all).not.toContain("\x1b]777");
    expect(all).not.toContain("rb-");
    expect(outputOf("c1")).toBe("\x1b[32mgreen\x1b[0m\n");
  });

  it("discards startup output and never shows the run command", async ({
    manager,
    events: { outputOf },
  }) => {
    await manager.run(RUNBOOK, "c1", "true");
    await manager.run(RUNBOOK, "c2", "echo only this");
    expect(outputOf("c1")).toBe("");
    expect(outputOf("c2")).toBe("only this\n");
  });

  it("reports running, then the final status, with timestamps", async ({
    manager,
    events: { statuses },
  }) => {
    await manager.run(RUNBOOK, "c1", "true");
    const [running, done] = statuses;
    expect(running).toMatchObject({ cellId: "c1", state: "running" });
    expect(done).toMatchObject({ cellId: "c1", state: "success", exitCode: 0 });
    expect(done?.startedAt).toBe(running?.startedAt);
    expect(done?.endedAt).toBeGreaterThanOrEqual(done?.startedAt ?? Infinity);
  });

  it("goes starting → ready → busy → ready", async ({ manager, events: { states } }) => {
    await manager.run(RUNBOOK, "c1", "true");
    expect(states).toEqual(["starting", "ready", "busy", "ready"]);
  });

  it("queues runs submitted at once and runs them one at a time, in order", async ({
    manager,
    events: { statuses, outputOf },
  }) => {
    const runs = [1, 2, 3].map((n) => manager.run(RUNBOOK, `c${n}`, `sleep 0.1; echo ${n}`));
    await Promise.all(runs);
    expect(statuses.map((s) => `${s.cellId}:${s.state}`)).toEqual([
      "c2:queued",
      "c3:queued",
      "c1:running",
      "c1:success",
      "c2:running",
      "c2:success",
      "c3:running",
      "c3:success",
    ]);
    expect(["c1", "c2", "c3"].map(outputOf)).toEqual(["1\n", "2\n", "3\n"]);
  });

  it("stops a sleep with Ctrl+C within a second", async ({ manager }) => {
    const run = manager.run(RUNBOOK, "c1", "sleep 10");
    await waitForRunning(manager, "c1");
    const stoppedAt = Date.now();
    manager.cancel(RUNBOOK, "c1");
    expect(await run).toMatchObject({ state: "interrupted", exitCode: 130 });
    expect(Date.now() - stoppedAt).toBeLessThan(1000);
  });

  it("stops a busy loop within a second, and the next run works", async ({
    manager,
    events: { outputOf },
  }) => {
    const run = manager.run(RUNBOOK, "c1", "while true; do :; done");
    await waitForRunning(manager, "c1");
    const stoppedAt = Date.now();
    manager.cancel(RUNBOOK, "c1");
    expect(await run).toMatchObject({ state: "interrupted" });
    expect(Date.now() - stoppedAt).toBeLessThan(1000);
    expect(await manager.run(RUNBOOK, "c2", "echo next")).toMatchObject({ state: "success" });
    expect(outputOf("c2")).toBe("next\n");
  });

  it("survives Ctrl+C typed again while the run is ending", async ({
    manager,
    events: { outputOf },
  }) => {
    const run = manager.run(RUNBOOK, "c1", "echo go; sleep 10");
    // Queued, so its run line is written the moment c1 ends: a Ctrl+C reaching the idle
    // prompt right then must not lose it.
    const next = manager.run(RUNBOOK, "c2", "echo next");
    await sendWhenStarted(manager, outputOf, "c1", "\x03");
    // Keep pressing Ctrl+C, so some land while the rcfile is ending the run.
    const presses = setInterval(() => manager.sendInput(RUNBOOK, "\x03"), 5);
    try {
      expect(await run).toMatchObject({ state: "interrupted", exitCode: 130 });
    } finally {
      clearInterval(presses);
    }
    expect(await next).toMatchObject({ state: "success" });
    expect(outputOf("c2")).toBe("next\n");
    expect(await manager.run(RUNBOOK, "c3", "echo after")).toMatchObject({ state: "success" });
  });

  it("sends a single Ctrl+C for a stop well after the start", async ({
    manager,
    events: { outputOf },
  }) => {
    // The trap keeps the script going after a Ctrl+C ends one sleep, so a second
    // Ctrl+C would have the next sleep to end. Every Ctrl+C is echoed as ^C.
    const source = ["trap : INT", "sleep 1.2", "echo armed", "sleep 1", "sleep 1", "echo end"];
    const run = manager.run(RUNBOOK, "c1", source.join("\n"));
    await vi.waitFor(() => expect(outputOf("c1")).toContain("armed"), { timeout: 3000 });
    manager.cancel(RUNBOOK, "c1");
    expect(await run).toMatchObject({ state: "interrupted" });
    expect(outputOf("c1")).toBe("armed\n^C\nend\n");
  });

  it("ends a cell's own Ctrl+C trap with the cell, like set -e", async ({
    manager,
    events: { outputOf },
  }) => {
    await manager.run(RUNBOOK, "c1", "trap 'echo caught' INT");
    await manager.run(RUNBOOK, "c2", "trap -p INT");
    expect(outputOf("c2")).toBe("");
  });

  it("counts any exit after a stop as interrupted", async ({ manager, events: { outputOf } }) => {
    // The cell catches Ctrl+C and ends with a code of its own.
    const source = [
      "trap 'stop=1' INT",
      "stop=",
      "echo armed",
      'while [ -z "$stop" ]; do :; done',
      "(exit 3)",
    ];
    const run = manager.run(RUNBOOK, "c1", source.join("\n"));
    await vi.waitFor(() => expect(outputOf("c1")).toContain("armed"));
    manager.cancel(RUNBOOK, "c1");
    expect(await run).toMatchObject({ state: "interrupted", exitCode: 3 });
  });

  it("stops a run that is stopped as soon as it is sent", async ({ manager }) => {
    // Cancelled before bash has printed rb-start; the Ctrl+C must wait for it.
    manager.on("status", ({ status }) => {
      if (status.state === "running") manager.cancel(RUNBOOK, status.cellId);
    });
    const status = await manager.run(RUNBOOK, "c1", "sleep 10");
    expect(status.state).toBe("interrupted");
    manager.removeAllListeners("status");
    expect(await manager.run(RUNBOOK, "c2", "true")).toMatchObject({ state: "success" });
  });

  it("drops a queued run on cancel, so it never runs", async ({
    manager,
    events: { outputOf },
  }) => {
    const first = manager.run(RUNBOOK, "c1", "sleep 0.2");
    const second = manager.run(RUNBOOK, "c2", "echo never");
    manager.cancel(RUNBOOK, "c2");
    expect(await second).toMatchObject({ cellId: "c2", state: "idle" });
    expect(await first).toMatchObject({ state: "success" });
    expect(outputOf("c2")).toBe("");
  });

  it("passes input to the running cell", async ({ manager, events: { outputOf } }) => {
    const run = manager.run(RUNBOOK, "c1", 'echo ready; read -r line; echo "got $line"');
    await sendWhenStarted(manager, outputOf, "c1", "hello\r");
    expect(await run).toMatchObject({ state: "success" });
    expect(outputOf("c1")).toContain("got hello");
  });

  it("passes a password to a program reading it from /dev/tty, like sudo", async ({
    manager,
    events: { outputOf },
  }) => {
    // getpass opens /dev/tty and turns echo off, as sudo's password prompt does.
    const source = `python3 -c 'import getpass; print(len(getpass.getpass("Password: ")))'`;
    const run = manager.run(RUNBOOK, "c1", source);
    await vi.waitFor(() => expect(outputOf("c1")).toContain("Password: "));
    manager.sendInput(RUNBOOK, "hunter2\r");
    expect(await run).toMatchObject({ state: "success" });
    expect(outputOf("c1")).not.toContain("hunter2");
    expect(outputOf("c1")).toMatch(/Password: \n7\n$/);
  });

  it("never executes input the cell didn't read", async ({
    root,
    manager,
    events: { outputOf },
  }) => {
    const pwned = join(root, "pwned");
    const run = manager.run(RUNBOOK, "c1", "echo started; sleep 0.3");
    await sendWhenStarted(manager, outputOf, "c1", `touch '${pwned}'\r`);
    manager.sendInput(RUNBOOK, `touch '${pwned}-partial'`); // no Enter
    expect(await run).toMatchObject({ state: "success" });
    expect(await manager.run(RUNBOOK, "c2", "echo next")).toMatchObject({ state: "success" });
    expect(outputOf("c2")).toBe("next\n");
    expect(await exists(pwned)).toBe(false);
    expect(await exists(`${pwned}-partial`)).toBe(false);
  });

  it("ignores input between runs", async ({ root, manager }) => {
    await manager.run(RUNBOOK, "c1", "true");
    manager.sendInput(RUNBOOK, `touch '${join(root, "pwned")}'\r`);
    expect(await manager.run(RUNBOOK, "c2", "true")).toMatchObject({ state: "success" });
    expect(await exists(join(root, "pwned"))).toBe(false);
  });

  it("keeps set -e to the cell that set it", async ({ manager, events: { states } }) => {
    expect(await manager.run(RUNBOOK, "c1", "set -e")).toMatchObject({ state: "success" });
    expect(await manager.run(RUNBOOK, "c2", "false")).toMatchObject({
      state: "failed",
      exitCode: 1,
    });
    expect(states).not.toContain("dead");
    expect(await manager.run(RUNBOOK, "c3", "true")).toMatchObject({ state: "success" });
  });

  it("applies the reported size to the shell, and to sessions started later", async ({
    manager,
    events: { outputOf },
  }) => {
    manager.resize(RUNBOOK, 80, 24);
    await manager.run(RUNBOOK, "c1", "stty size");
    expect(outputOf("c1")).toBe("24 80\n");
    manager.resize(RUNBOOK, 100, 10);
    await manager.run(RUNBOOK, "c2", "stty size");
    expect(outputOf("c2")).toBe("10 100\n");
  });

  it("keeps one session per runbook", async ({ root, manager, events: { outputOf } }) => {
    await manager.run("/runbooks/a.md", "a1", "cd /tmp");
    await manager.run("/runbooks/b.md", "b1", "pwd");
    await manager.run("/runbooks/a.md", "a2", "pwd");
    expect(outputOf("b1")).toBe(`${root}\n`);
    expect(outputOf("a2")).toBe("/tmp\n");
  });

  it("writes run scripts as private files and deletes them when the run ends", async ({
    root,
    manager,
    events: { outputOf },
  }) => {
    const scriptDir = join(root, "tmp");
    await manager.run(RUNBOOK, "c1", `stat -c %a "\${BASH_SOURCE[0]}"`);
    expect(outputOf("c1")).toBe("600\n");
    const [sessionDir] = await readdir(scriptDir);
    expect(sessionDir).toBeDefined();
    expect((await stat(join(scriptDir, sessionDir ?? ""))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(scriptDir, sessionDir ?? ""))).toEqual([]);
  });

  it("writes the rcfile verbatim", async ({ root, manager }) => {
    await manager.run(RUNBOOK, "c1", "true");
    expect(await readFile(join(root, "userData", "rcfile.bash"), "utf8")).toBe(RCFILE);
  });

  it("routes output printed after a run ends to the last-run cell", async ({
    manager,
    events: { outputOf },
  }) => {
    await manager.run(RUNBOOK, "c1", "(sleep 0.2; echo late) &");
    await vi.waitFor(() => expect(outputOf("c1")).toContain("late\n"));
  });

  it("marks the session dead when the shell exits, and starts a new one next run", async ({
    manager,
    events: { states, ends, outputOf },
  }) => {
    expect(await manager.run(RUNBOOK, "c1", "exit 3")).toMatchObject({
      state: "failed",
      exitCode: 3,
    });
    expect(states.at(-1)).toBe("dead");
    expect(ends).toEqual([{ type: "exited", exitCode: 3 }]);
    expect(await manager.run(RUNBOOK, "c2", "echo again")).toMatchObject({ state: "success" });
    expect(outputOf("c2")).toBe("again\n");
  });

  it("rejects the runs queued behind an exit, reporting each idle rather than queued", async ({
    manager,
    events: { statuses },
  }) => {
    const exiting = manager.run(RUNBOOK, "c1", "sleep 0.2; exit 3");
    const queued = manager.run(RUNBOOK, "c2", "echo never");
    await expect(queued).rejects.toThrow("Shell session ended");
    expect(await exiting).toMatchObject({ state: "failed", exitCode: 3 });
    expect(statuses.filter((status) => status.cellId === "c2").map((s) => s.state)).toEqual([
      "queued",
      "idle",
    ]);
  });

  it("isn't stalled by a cell printing another program's OSC 777 sequence", async ({ manager }) => {
    const status = await manager.run(RUNBOOK, "c1", String.raw`printf '\e]777;notify;hi\e\\'`);
    expect(status).toMatchObject({ state: "success" });
    expect(await manager.run(RUNBOOK, "c2", "echo next")).toMatchObject({ state: "success" });
  });

  it("reports a shell killed by a signal as 128 + the signal", async ({ manager }) => {
    expect(await manager.run(RUNBOOK, "c1", "kill -9 $$")).toMatchObject({
      state: "failed",
      exitCode: 137,
    });
  });

  it("gives up on a shell that doesn't get ready in time, keeping its output", async ({ root }) => {
    // A ~/.bashrc that waits forever, like one that asks for input.
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, ".bashrc"), "echo hello from bashrc\nsleep 60\n");
    const manager = new SessionManager({
      rcfilePath: join(root, "userData", "rcfile.bash"),
      tempRoot: join(root, "tmp"),
      env: buildShellEnv({ ...process.env, HOME: home }),
      cwd: root,
      readyTimeoutMs: 300,
    });
    const ends: SessionEnd[] = [];
    manager.on("state", ({ end }) => {
      if (end) ends.push(end);
    });
    try {
      await expect(manager.run(RUNBOOK, "c1", "true")).rejects.toThrow("Shell didn't start");
      expect(ends).toEqual([
        { type: "start-failed", output: expect.stringContaining("hello from bashrc") },
      ]);
      // Once the ~/.bashrc is fixed, the next run starts a working session.
      await writeFile(join(home, ".bashrc"), "");
      expect(await manager.run(RUNBOOK, "c2", "true")).toMatchObject({ state: "success" });
    } finally {
      await manager.dispose();
    }
  });

  it("reports a ~/.bashrc that exits as a shell that didn't start", async ({ root }) => {
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, ".bashrc"), "echo bye\nexit 7\n");
    const manager = new SessionManager({
      rcfilePath: join(root, "userData", "rcfile.bash"),
      tempRoot: join(root, "tmp"),
      env: buildShellEnv({ ...process.env, HOME: home }),
      cwd: root,
    });
    const ends: SessionEnd[] = [];
    manager.on("state", ({ end }) => {
      if (end) ends.push(end);
    });
    try {
      await expect(manager.run(RUNBOOK, "c1", "true")).rejects.toThrow("Shell didn't start");
      expect(ends).toEqual([{ type: "start-failed", output: expect.stringContaining("bye") }]);
    } finally {
      await manager.dispose();
    }
  });

  it("restarts a session: the running cell is interrupted, the queue dropped", async ({
    root,
    manager,
    events: { states, ends, outputOf },
  }) => {
    await manager.run(RUNBOOK, "c1", "cd /tmp");
    const running = manager.run(RUNBOOK, "c2", "sleep 10");
    const queued = manager.run(RUNBOOK, "c3", "echo never");
    await waitForRunning(manager, "c2");
    await manager.restart(RUNBOOK);
    expect(await running).toMatchObject({ cellId: "c2", state: "interrupted" });
    expect(await queued).toMatchObject({ cellId: "c3", state: "idle" });
    expect(outputOf("c3")).toBe("");
    // A fresh shell: the cd from before is gone.
    await manager.run(RUNBOOK, "c4", "pwd");
    expect(outputOf("c4")).toBe(`${root}\n`);
    expect(states).not.toContain("dead");
    expect(ends).toEqual([]);
    expect(states.slice(-4)).toEqual(["starting", "ready", "busy", "ready"]);
  });

  it("ends the running command and its children with the shell, on restart and close", async ({
    root,
    manager,
  }) => {
    const pidsOf = async (file: string): Promise<number[]> =>
      (await readFile(join(root, file), "utf8")).split(/\s+/).filter(Boolean).map(Number);
    // A foreground command, and one that waits on a child of its own.
    for (const [i, end] of [
      [1, () => manager.restart(RUNBOOK)],
      [2, () => manager.close(RUNBOOK)],
    ] as const) {
      const running = manager.run(
        RUNBOOK,
        `c${i}`,
        `sh -c 'sleep 30 & echo $$ $! > pids${i}; wait'`,
      );
      await vi.waitFor(async () => expect(await pidsOf(`pids${i}`)).toHaveLength(2));
      const pids = await pidsOf(`pids${i}`);
      expect(pids.every(alive)).toBe(true);
      await end();
      expect(await running).toMatchObject({ state: "interrupted" });
      await vi.waitFor(() => expect(pids.filter(alive)).toEqual([]), { timeout: 3000 });
    }
  });

  it("starts a session on restart even if there was none", async ({
    manager,
    events: { states },
  }) => {
    await manager.restart(RUNBOOK);
    await vi.waitFor(() => expect(states).toEqual(["starting", "ready"]));
  });

  it("closes a session: the next run starts a fresh one", async ({
    root,
    manager,
    events: { ends, outputOf },
  }) => {
    await manager.run(RUNBOOK, "c1", "cd /tmp");
    const running = manager.run(RUNBOOK, "c2", "sleep 10");
    await waitForRunning(manager, "c2");
    manager.close(RUNBOOK);
    expect(await running).toMatchObject({ state: "interrupted" });
    await manager.run(RUNBOOK, "c3", "pwd");
    expect(outputOf("c3")).toBe(`${root}\n`);
    expect(ends).toEqual([]);
  });

  it("moves a session to a renamed runbook without restarting it", async ({
    manager,
    events: { states, outputOf },
  }) => {
    const paths = new Set<string>();
    manager.on("output", ({ runbookPath }) => paths.add(runbookPath));
    manager.on("status", ({ runbookPath }) => paths.add(runbookPath));
    await manager.run("/runbooks/old.md", "c1", "cd /tmp");
    paths.clear();
    manager.rename("/runbooks/old.md", "/runbooks/new.md");
    await manager.run("/runbooks/new.md", "c2", "pwd");
    expect(outputOf("c2")).toBe("/tmp\n");
    expect([...paths]).toEqual(["/runbooks/new.md"]);
    expect(states.filter((state) => state === "starting")).toHaveLength(1);
  });

  it("fails runs, without hanging, when the shell can't start", async ({ root }) => {
    const broken = new SessionManager({
      rcfilePath: join(root, "userData", "rcfile.bash"),
      tempRoot: join(root, "tmp"),
      cwd: join(root, "missing"),
    });
    await expect(broken.run(RUNBOOK, "c1", "true")).rejects.toThrow();
    await expect(broken.run(RUNBOOK, "c2", "true")).rejects.toThrow();
    await broken.dispose();
  });

  it("tries the setup again after it failed once", async ({ root, manager }) => {
    // A file where the rcfile's folder should be makes writing the rcfile fail.
    await writeFile(join(root, "userData"), "");
    await expect(manager.run(RUNBOOK, "c1", "true")).rejects.toThrow();
    await rm(join(root, "userData"));
    expect(await manager.run(RUNBOOK, "c2", "true")).toMatchObject({ state: "success" });
  });

  it("refuses runs once disposed, including one that was still starting", async ({
    manager,
    events: { output },
  }) => {
    const pending = manager.run(RUNBOOK, "c1", "echo never");
    await manager.dispose();
    await expect(pending).rejects.toThrow();
    await expect(manager.run(RUNBOOK, "c2", "true")).rejects.toThrow();
    expect(output.size).toBe(0);
  });

  it("removes its own temp folder on dispose, but not one it was given", async ({
    root,
    manager,
  }) => {
    const own = new SessionManager({ rcfilePath: join(root, "own", "rcfile.bash"), cwd: root });
    const dirs: string[] = [];
    own.on("output", ({ data }) => dirs.push(data.trim()));
    await own.run(RUNBOOK, "c1", `dirname "$(dirname "\${BASH_SOURCE[0]}")"`);
    const [tempRoot] = dirs;
    expect(tempRoot).toMatch(/\/runbook-/);
    expect(await exists(tempRoot ?? "")).toBe(true);
    await own.dispose();
    expect(await exists(tempRoot ?? "")).toBe(false);

    await manager.run(RUNBOOK, "c1", "true");
    await manager.dispose();
    expect(await exists(join(root, "tmp"))).toBe(true);
  });
});
