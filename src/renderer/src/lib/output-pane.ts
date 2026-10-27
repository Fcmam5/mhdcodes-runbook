// A shell cell's output pane (SPEC §9.3): an xterm that grows with its output up to
// 400 px and then scrolls. While there is no output it is collapsed (the
// `output-collapsed` class), not display: none, because xterm can't measure its font
// in an element that isn't rendered, and the pane's size is needed before a run starts.

import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { MONOSPACE } from "./fonts";

const MAX_HEIGHT_PX = 400;

const LIGHT: ITheme = {
  background: "#fafafa", // zinc-50
  foreground: "#18181b", // zinc-900
  cursor: "#18181b",
  selectionBackground: "#d4d4d8", // zinc-300
};

const DARK: ITheme = {
  background: "#18181b", // zinc-900
  foreground: "#f4f4f5", // zinc-100
  cursor: "#f4f4f5",
  selectionBackground: "#3f3f46", // zinc-700
};

export interface PaneSize {
  cols: number;
  rows: number;
}

export interface OutputPaneOptions {
  onInput: (data: string) => void;
  onResize: (size: PaneSize) => void;
}

export class OutputPane {
  private readonly terminal: Terminal;
  // xterm sizes itself to the element it opens in, so give it one without padding.
  private readonly host = document.createElement("div");
  private readonly fit = new FitAddon();
  private readonly resizeObserver = new ResizeObserver(() => this.fitWidth());
  // A trailing newline, written only once more output follows. Output usually ends
  // with one, and writing it would leave the cursor on an empty last row.
  private heldNewline = "";

  constructor(
    private readonly element: HTMLElement,
    private readonly options: OutputPaneOptions,
  ) {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    this.terminal = new Terminal({
      rows: 1,
      scrollback: 5000,
      fontFamily: MONOSPACE,
      fontSize: 14,
      theme: dark ? DARK : LIGHT,
      cursorBlink: true,
      cursorInactiveStyle: "none",
    });
    this.terminal.loadAddon(this.fit);
    this.terminal.onWriteParsed(() => this.fitHeight());
    // Ctrl+C arrives here as "\x03" too: in the pane it goes to the shell, not to copy.
    this.terminal.onData((data) => this.options.onInput(data));
    element.append(this.host);
    this.terminal.open(this.host);
    this.fitWidth();
    this.resizeObserver.observe(this.host);
  }

  // The size a program in the pane should assume: its full width, and the rows it
  // shows once grown to its height limit.
  get size(): PaneSize {
    return { cols: this.terminal.cols, rows: this.maxRows() };
  }

  write(data: string): void {
    const text = this.heldNewline + data;
    this.heldNewline = /\r?\n$/.exec(text)?.[0] ?? "";
    const shown = text.slice(0, text.length - this.heldNewline.length);
    if (shown === "") return;
    this.element.classList.remove("output-collapsed");
    this.terminal.write(shown);
  }

  // Empties the pane for a new run and collapses it until output arrives.
  clear(): void {
    this.terminal.reset();
    this.heldNewline = "";
    this.terminal.resize(this.terminal.cols, 1);
    this.element.classList.add("output-collapsed");
  }

  // Hides the cursor once the run has ended, so the pane doesn't look like it is
  // waiting for input. clear() shows it again: reset() restores the cursor.
  hideCursor(): void {
    this.terminal.write("\x1b[?25l");
  }

  // Moves keyboard focus into the pane, so typing goes to the shell. Does nothing
  // while the pane is collapsed: a hidden element can't take focus.
  focus(): void {
    this.terminal.focus();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.terminal.dispose();
    this.host.remove();
  }

  // Columns follow the pane's width; rows are set by fitHeight.
  private fitWidth(): void {
    const size = this.fit.proposeDimensions();
    if (!size || size.cols === this.terminal.cols) return;
    this.terminal.resize(size.cols, this.terminal.rows);
    this.options.onResize(this.size);
  }

  // One row per line of output, up to the height limit; beyond it, the pane scrolls.
  private fitHeight(): void {
    const buffer = this.terminal.buffer.active;
    // The cursor is on the last line of output (see heldNewline).
    const lines = buffer.baseY + buffer.cursorY + 1;
    const rows = Math.min(lines, this.maxRows());
    if (rows !== this.terminal.rows) this.terminal.resize(this.terminal.cols, rows);
  }

  private maxRows(): number {
    const screen = this.host.querySelector(".xterm-screen");
    const rowHeight = screen ? screen.clientHeight / this.terminal.rows : 0;
    return rowHeight > 0 ? Math.max(1, Math.floor(MAX_HEIGHT_PX / rowHeight)) : 24;
  }
}
