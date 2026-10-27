// One persistent bash per notebook, driven over a pty (SPEC §6). No Electron imports:
// it reports everything as events, so it is tested against real bash in plain Node.

import { EventEmitter } from "node:events";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { spawn, type IPty } from "node-pty";
import type { CellRunStatus, RunState, SessionState } from "../../shared/types";
import { MarkerParser, type Marker } from "./markers";

export interface ShellSessionOptions {
  rcfilePath: string;
  tempRoot: string; // the session keeps its run scripts in a folder of its own inside
  env: Record<string, string>;
  cwd: string;
  shell?: string;
}

export interface ShellSessionEvents {
  output: [{ cellId: string; data: string }];
  status: [CellRunStatus];
  state: [SessionState];
}

interface Run {
  runId: string;
  cellId: string;
  source: string;
  scriptPath: string;
  startedAt?: number;
  resolve: (status: CellRunStatus) => void;
  reject: (error: Error) => void;
}

export class ShellSession extends EventEmitter<ShellSessionEvents> {
  readonly id = nanoid(8);
  private readonly tempDir: string;
  private readonly parser = new MarkerParser();
  private pty: IPty | null = null;
  private currentState: SessionState = "starting";
  private readonly waiting: Run[] = [];
  private current: Run | null = null;
  // Output goes to the cell that ran last, including output after its run ended
  // (e.g. from a background job), until the next run starts.
  private outputCellId: string | null = null;
  private disposed = false;

  constructor(private readonly options: ShellSessionOptions) {
    super();
    this.tempDir = join(options.tempRoot, this.id);
  }

  get state(): SessionState {
    return this.currentState;
  }

  // Spawns bash. Separate from the constructor so listeners can be attached first.
  start(): void {
    const { rcfilePath, env, cwd, shell = "bash" } = this.options;
    this.emit("state", "starting");
    try {
      // --noediting turns off readline, so the output holds only command output and markers.
      this.pty = spawn(shell, ["--noediting", "--rcfile", rcfilePath, "-i"], {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd,
        env,
      });
    } catch (error) {
      // Dead, so the next run starts a fresh session instead of waiting on this one.
      this.setState("dead");
      throw error;
    }
    // Like a shell's $?, a shell killed by a signal reports 128 + the signal number.
    this.pty.onExit(({ exitCode, signal }) => this.onExit(signal ? 128 + signal : exitCode));
    this.pty.onData((chunk) => this.onData(chunk));
  }

  // Runs a cell's source in the session and resolves with its final status. Runs
  // requested before the shell is ready, or while another run is going, wait in order.
  run(cellId: string, source: string): Promise<CellRunStatus> {
    if (this.currentState === "dead" || this.disposed) {
      return Promise.reject(new Error("Shell session ended"));
    }
    return new Promise((resolve, reject) => {
      const runId = nanoid(8);
      const scriptPath = join(this.tempDir, `${runId}.sh`);
      this.waiting.push({ runId, cellId, source, scriptPath, resolve, reject });
      this.next();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.pty?.kill();
  }

  private next(): void {
    if (this.currentState !== "ready" || this.current) return;
    const run = this.waiting.shift();
    if (!run) return;
    this.current = run;
    this.setState("busy");
    void this.send(run);
  }

  private async send(run: Run): Promise<void> {
    try {
      // Not recursive: once the temp root is removed on quit, nothing may recreate it.
      await mkdir(this.tempDir, { mode: 0o700 }).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      });
      await writeFile(run.scriptPath, run.source, { mode: 0o600 });
    } catch (error) {
      if (this.current !== run) return;
      this.current = null;
      run.reject(error instanceof Error ? error : new Error(String(error)));
      this.setState("ready");
      this.next();
      return;
    }
    if (this.current !== run || !this.pty || this.disposed) {
      void unlink(run.scriptPath).catch(() => {});
      return;
    }

    run.startedAt = Date.now();
    this.emit("status", { cellId: run.cellId, state: "running", startedAt: run.startedAt });
    // `source` (not a subshell) is what makes cd, export and aliases persist.
    this.pty.write(`__rb_run ${run.runId} ${shellQuote(run.scriptPath)}\n`);
  }

  private onData(chunk: string): void {
    for (const piece of this.parser.push(chunk)) {
      if (piece.type === "marker") this.onMarker(piece.marker);
      // Output before the ready marker (rc noise, MOTD) is discarded.
      else this.forward(piece.data);
    }
  }

  private forward(data: string): void {
    if (data !== "" && this.currentState !== "starting" && this.outputCellId) {
      this.emit("output", { cellId: this.outputCellId, data });
    }
  }

  private onMarker(marker: Marker): void {
    const run = this.current;
    switch (marker.type) {
      case "ready":
        if (this.currentState !== "starting") return;
        this.setState("ready");
        this.next();
        return;
      case "start":
        if (run?.runId === marker.runId) this.outputCellId = run.cellId;
        return;
      case "done":
        if (run?.runId === marker.runId) this.finish(run, marker.exitCode);
        return;
    }
  }

  private finish(run: Run, exitCode: number): void {
    this.current = null;
    void unlink(run.scriptPath).catch(() => {});
    this.settle(run, exitCode === 0 ? "success" : "failed", exitCode);
    this.setState("ready");
    this.next();
  }

  private onExit(exitCode: number): void {
    this.forward(this.parser.flush());
    this.pty = null;
    const run = this.current;
    this.current = null;
    this.setState("dead");
    if (run) this.settle(run, "failed", exitCode);
    for (const waiting of this.waiting.splice(0)) {
      waiting.reject(new Error("Shell session ended"));
    }
    void rm(this.tempDir, { recursive: true, force: true });
  }

  // Reports a run's final status and resolves its promise.
  private settle(run: Run, state: RunState, exitCode: number): void {
    const status: CellRunStatus = {
      cellId: run.cellId,
      state,
      exitCode,
      ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
      endedAt: Date.now(),
    };
    this.emit("status", status);
    run.resolve(status);
  }

  private setState(state: SessionState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.emit("state", state);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
