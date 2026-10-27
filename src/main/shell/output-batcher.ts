// Coalesces cell output before it goes over IPC (SPEC §11): a noisy command would
// otherwise send thousands of tiny messages. Each cell's output is forwarded at most
// once per interval, in one piece. No Electron imports.

export interface CellOutput {
  notebookPath: string;
  cellId: string;
  data: string;
}

export class OutputBatcher {
  // Keyed by notebook path and cell ID; a Map keeps the order output arrived in.
  private readonly pending = new Map<string, CellOutput>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (output: CellOutput) => void,
    private readonly intervalMs = 16,
  ) {}

  push(output: CellOutput): void {
    // A NUL can't appear in a path, so it can't make two keys collide.
    const key = `${output.notebookPath}\0${output.cellId}`;
    const queued = this.pending.get(key);
    if (queued) queued.data += output.data;
    else this.pending.set(key, { ...output });
    this.timer ??= setTimeout(() => this.flush(), this.intervalMs);
  }

  // Sends everything held back now. Call it before forwarding a status, so a cell's
  // output always arrives before the status that ends its run.
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const outputs = [...this.pending.values()];
    this.pending.clear();
    for (const output of outputs) this.send(output);
  }
}
