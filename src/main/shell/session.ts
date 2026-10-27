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
  cols?: number; // default 120
  rows?: number; // default 30
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
  startedAt?: number; // set when the run line is written to the shell
  started?: boolean; // the shell has printed rb-start
  stopRequested?: boolean;
  interruptTimer?: ReturnType<typeof setTimeout>;
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
    const { rcfilePath, env, cwd, shell = "bash", cols = 120, rows = 30 } = this.options;
    this.emit("state", "starting");
    try {
      // --noediting turns off readline, so the output holds only command output and markers.
      this.pty = spawn(shell, ["--noediting", "--rcfile", rcfilePath, "-i"], {
        name: "xterm-256color",
        cols,
        rows,
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
  // requested before the shell is ready, or while another run is going, wait in order;
  // one waiting behind another run is reported as queued.
  run(cellId: string, source: string): Promise<CellRunStatus> {
    if (this.currentState === "dead" || this.disposed) {
      return Promise.reject(new Error("Shell session ended"));
    }
    return new Promise((resolve, reject) => {
      const runId = nanoid(8);
      const scriptPath = join(this.tempDir, `${runId}.sh`);
      const behindAnother = this.current !== null || this.waiting.length > 0;
      this.waiting.push({ runId, cellId, source, scriptPath, resolve, reject });
      if (behindAnother) this.emit("status", { cellId, state: "queued" });
      this.next();
    });
  }

  // Stops the cell's running run with Ctrl+C, and drops its waiting runs. A dropped
  // run, or one stopped before the shell got it, resolves as idle: it never ran.
  cancel(cellId: string): void {
    for (const run of this.waiting.filter((waiting) => waiting.cellId === cellId)) {
      this.waiting.splice(this.waiting.indexOf(run), 1);
      this.settle(run, "idle");
    }
    const run = this.current;
    if (run?.cellId !== cellId) return;
    run.stopRequested = true;
    // Before rb-start, bash may not have read the run line yet, and Ctrl+C would
    // discard it unrun, so no done marker would ever come. onMarker sends it then.
    if (run.started) this.interrupt(run);
  }

  // Keystrokes for the running cell. Ignored between runs, and before the shell has
  // started the run, where they would end up in the run line itself.
  sendInput(data: string): void {
    if (this.current?.started && !this.disposed) this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.pty?.resize(cols, rows);
    } catch {
      // The pty closed in the meantime; onExit handles that.
    }
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
    if (run.stopRequested) {
      // Stopped while its script was being written: never send it.
      this.end(run, "idle");
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
        if (run?.runId !== marker.runId) return;
        run.started = true;
        this.outputCellId = run.cellId;
        if (run.stopRequested) this.interrupt(run);
        return;
      case "done":
        if (run?.runId === marker.runId) {
          this.end(run, endState(run, marker.exitCode), marker.exitCode);
        }
        return;
    }
  }

  // Sends Ctrl+C. One sent just as a run starts can be lost: before the command owns
  // the terminal, it reaches bash, which ignores it while waiting for the command.
  // So a stop within a second of the start is sent once more after 500 ms, if the
  // run is still going. Later stops are sent once: to many programs (terraform,
  // docker compose) a second Ctrl+C means "skip the clean shutdown".
  private interrupt(run: Run): void {
    this.pty?.write("\x03");
    if (run.interruptTimer || Date.now() - (run.startedAt ?? 0) > 1000) return;
    run.interruptTimer = setTimeout(() => {
      if (this.current === run) this.pty?.write("\x03");
    }, 500);
  }

  // Ends the current run while the shell lives on, and starts the next one.
  private end(run: Run, state: RunState, exitCode?: number): void {
    this.current = null;
    void unlink(run.scriptPath).catch(() => {});
    this.settle(run, state, exitCode);
    this.setState("ready");
    this.next();
  }

  private onExit(exitCode: number): void {
    this.forward(this.parser.flush());
    this.pty = null;
    const run = this.current;
    this.current = null;
    this.setState("dead");
    // Unlike a run's own exit code, the shell's exit status means failure even if 0
    // (SPEC §6.3.7), unless the user had asked for a stop.
    if (run) this.settle(run, run.stopRequested ? "interrupted" : "failed", exitCode);
    for (const waiting of this.waiting.splice(0)) {
      waiting.reject(new Error("Shell session ended"));
    }
    void rm(this.tempDir, { recursive: true, force: true });
  }

  // Reports a run's final status and resolves its promise.
  private settle(run: Run, state: RunState, exitCode?: number): void {
    clearTimeout(run.interruptTimer);
    const status: CellRunStatus = {
      cellId: run.cellId,
      state,
      ...(exitCode === undefined ? {} : { exitCode }),
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

// Exit 130 is a Ctrl+C, whether from Stop or typed into the pane (SPEC §6.3.5). After
// a stop, any exit counts: the cell may catch Ctrl+C and exit with a code of its own.
function endState(run: Run, exitCode: number): RunState {
  if (run.stopRequested || exitCode === 130) return "interrupted";
  return exitCode === 0 ? "success" : "failed";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
