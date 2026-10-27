// One ShellSession per notebook path, created on the first run (SPEC §6, §6.6).

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CellRunStatus, SessionState } from "../../shared/types";
import { buildShellEnv } from "./env";
import { writeRcfile } from "./rcfile";
import { ShellSession } from "./session";

export interface SessionManagerOptions {
  rcfilePath: string;
  tempRoot?: string; // default: a fresh private folder in the system temp dir, removed on dispose
  env?: Record<string, string>; // default: buildShellEnv(process.env)
  cwd?: string; // default: the home folder
  shell?: string;
}

export interface SessionManagerEvents {
  output: [{ notebookPath: string; cellId: string; data: string }];
  status: [{ notebookPath: string; status: CellRunStatus }];
  state: [{ notebookPath: string; state: SessionState }];
}

export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private readonly sessions = new Map<string, ShellSession>();
  private prepared: Promise<string> | null = null;
  private disposed = false;

  constructor(private readonly options: SessionManagerOptions) {
    super();
  }

  // Runs a cell in its notebook's session, starting one if there is none or the old
  // one ended. Resolves with the run's final status.
  async run(notebookPath: string, cellId: string, source: string): Promise<CellRunStatus> {
    if (this.disposed) throw new Error("Shell sessions are shut down");
    const tempRoot = await this.prepare();
    // dispose() may have run while we waited; a session started now would be orphaned.
    if (this.disposed) throw new Error("Shell sessions are shut down");
    let session = this.sessions.get(notebookPath);
    if (!session || session.state === "dead") {
      session = this.createSession(notebookPath, tempRoot);
    }
    return session.run(cellId, source);
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

  private createSession(notebookPath: string, tempRoot: string): ShellSession {
    const session = new ShellSession({
      rcfilePath: this.options.rcfilePath,
      tempRoot,
      env: this.options.env ?? buildShellEnv(process.env),
      cwd: this.options.cwd ?? homedir(),
      ...(this.options.shell === undefined ? {} : { shell: this.options.shell }),
    });
    session.on("output", (event) => this.emit("output", { notebookPath, ...event }));
    session.on("status", (status) => this.emit("status", { notebookPath, status }));
    session.on("state", (state) => this.emit("state", { notebookPath, state }));
    this.sessions.set(notebookPath, session);
    session.start();
    return session;
  }
}
