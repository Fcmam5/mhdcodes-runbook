// One ShellSession per runbook path, created on the first run.

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CellRunStatus, SessionEnd, SessionState } from "../../shared/types";
import { buildShellEnv } from "./env";
import { writeRcfile } from "./rcfile";
import { ShellSession } from "./session";

export interface SessionManagerOptions {
  rcfilePath: string;
  tempRoot?: string; // default: a fresh private folder in the system temp dir, removed on dispose
  env?: Record<string, string>; // default: buildShellEnv(process.env)
  cwd?: string; // default: the home folder
  shell?: string;
  readyTimeoutMs?: number; // default 10 s
}

export interface SessionManagerEvents {
  output: [{ runbookPath: string; cellId: string; data: string }];
  status: [{ runbookPath: string; status: CellRunStatus }];
  // `end` comes with "dead" when the shell failed to start or exited on its own.
  state: [{ runbookPath: string; state: SessionState; end?: SessionEnd }];
}

export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private readonly sessions = new Map<string, ShellSession>();
  // Each session's runbook path, read when forwarding its events: it changes on rename.
  private readonly paths = new WeakMap<ShellSession, string>();
  // The last size the renderer reported per runbook, so a new session starts at it.
  private readonly sizes = new Map<string, { cols: number; rows: number }>();
  private prepared: Promise<string> | null = null;
  // Runs still waiting on prepare(), which have no session to cancel them in yet.
  private readonly preparing = new Set<{
    runbookPath: string;
    cellId: string;
    cancelled: boolean;
  }>();
  private disposed = false;

  constructor(private readonly options: SessionManagerOptions) {
    super();
  }

  // Runs a cell in its runbook's session, starting one if there is none or the old
  // one ended. Resolves with the run's final status.
  async run(runbookPath: string, cellId: string, source: string): Promise<CellRunStatus> {
    if (this.disposed) throw new Error("Shell sessions are shut down");
    const request = { runbookPath, cellId, cancelled: false };
    this.preparing.add(request);
    const tempRoot = await this.prepare().finally(() => this.preparing.delete(request));
    // dispose() may have run while we waited; a session started now would be orphaned.
    if (this.disposed) throw new Error("Shell sessions are shut down");
    // The runbook may have been renamed while we waited.
    const path = request.runbookPath;
    if (request.cancelled) {
      const status: CellRunStatus = { cellId, state: "idle" };
      this.emit("status", { runbookPath: path, status });
      return status;
    }
    let session = this.sessions.get(path);
    if (!session || session.state === "dead") {
      session = this.createSession(path, tempRoot);
    }
    return session.run(cellId, source);
  }

  // Stops the cell's run, or drops it if it is still waiting (see ShellSession.cancel).
  cancel(runbookPath: string, cellId: string): void {
    for (const request of this.preparing) {
      if (request.runbookPath === runbookPath && request.cellId === cellId) {
        request.cancelled = true;
      }
    }
    this.sessions.get(runbookPath)?.cancel(cellId);
  }

  sendInput(runbookPath: string, data: string): void {
    this.sessions.get(runbookPath)?.sendInput(data);
  }

  resize(runbookPath: string, cols: number, rows: number): void {
    this.sizes.set(runbookPath, { cols, rows });
    this.sessions.get(runbookPath)?.resize(cols, rows);
  }

  // Kills the runbook's shell and starts a fresh one. The running cell
  // ends interrupted and queued runs are dropped.
  async restart(runbookPath: string): Promise<void> {
    if (this.disposed) throw new Error("Shell sessions are shut down");
    const tempRoot = await this.prepare();
    if (this.disposed) throw new Error("Shell sessions are shut down");
    this.close(runbookPath);
    this.createSession(runbookPath, tempRoot);
  }

  // Moves the runbook's session to its new path, without restarting it.
  rename(from: string, to: string): void {
    if (from === to) return;
    for (const request of this.preparing) {
      if (request.runbookPath === from) request.runbookPath = to;
    }
    const session = this.sessions.get(from);
    if (session) {
      this.sessions.delete(from);
      this.sessions.set(to, session);
      this.paths.set(session, to);
    }
    const size = this.sizes.get(from);
    this.sizes.delete(from);
    if (size) this.sizes.set(to, size);
  }

  // Kills the runbook's shell, e.g. when the runbook is deleted. The next run
  // starts a new session.
  close(runbookPath: string): void {
    this.sessions.get(runbookPath)?.dispose();
    this.sessions.delete(runbookPath);
  }

  // Kills every shell. Later runs start new sessions.
  closeAll(): void {
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }

  // Kills every shell, refuses further runs and removes the temp folder it created (on quit).
  async dispose(): Promise<void> {
    this.disposed = true;
    this.closeAll();
    if (this.prepared && this.options.tempRoot === undefined) {
      const tempRoot = await this.prepared.catch(() => null);
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    }
  }

  // Writes the rcfile and creates the temp folder once, before the first session.
  // A failure isn't remembered, so the next run tries again.
  private prepare(): Promise<string> {
    this.prepared ??= (async () => {
      await writeRcfile(this.options.rcfilePath);
      const { tempRoot } = this.options;
      if (tempRoot !== undefined) {
        await mkdir(tempRoot, { recursive: true, mode: 0o700 });
        return tempRoot;
      }
      // mkdtemp gives a fresh folder only we can write to. A fixed name like
      // /tmp/runbook could be pre-created by another user to swap our scripts.
      return mkdtemp(join(tmpdir(), "runbook-"));
    })();
    this.prepared.catch(() => {
      this.prepared = null;
    });
    return this.prepared;
  }

  private createSession(runbookPath: string, tempRoot: string): ShellSession {
    const session = new ShellSession({
      rcfilePath: this.options.rcfilePath,
      tempRoot,
      env: this.options.env ?? buildShellEnv(process.env),
      cwd: this.options.cwd ?? homedir(),
      ...this.sizes.get(runbookPath),
      ...(this.options.shell === undefined ? {} : { shell: this.options.shell }),
      ...(this.options.readyTimeoutMs === undefined
        ? {}
        : { readyTimeoutMs: this.options.readyTimeoutMs }),
    });
    this.paths.set(session, runbookPath);
    const path = (): string => this.paths.get(session) ?? runbookPath;
    session.on("output", (event) => this.emit("output", { runbookPath: path(), ...event }));
    session.on("status", (status) => this.emit("status", { runbookPath: path(), status }));
    session.on("state", (state, end) =>
      this.emit("state", { runbookPath: path(), state, ...(end === undefined ? {} : { end }) }),
    );
    this.sessions.set(runbookPath, session);
    session.start();
    return session;
  }
}
