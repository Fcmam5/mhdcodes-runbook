// A shell cell's output pane (SPEC §9.3): an xterm that grows with its output up to
// 400 px and then scrolls. It is hidden while there is no output, and xterm is only
// opened once there is some, because it can't measure its font in a hidden element.

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

export class OutputPane {
  private readonly terminal: Terminal;
  // xterm sizes itself to the element it opens in, so give it one without padding.
  private readonly host = document.createElement("div");
  private readonly fit = new FitAddon();
  private readonly resizeObserver = new ResizeObserver(() => this.fitWidth());
  private opened = false;
  // A trailing newline, written only once more output follows. Output usually ends
  // with one, and writing it would leave the cursor on an empty last row.
  private heldNewline = "";

  constructor(private readonly element: HTMLElement) {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    this.terminal = new Terminal({
      rows: 1,
      scrollback: 5000,
      fontFamily: MONOSPACE,
      fontSize: 14,
      theme: dark ? DARK : LIGHT,
      cursorInactiveStyle: "none",
      // Typing into a running cell comes with ticket 07.
      disableStdin: true,
    });
    this.terminal.loadAddon(this.fit);
    this.terminal.onWriteParsed(() => this.fitHeight());
    element.hidden = true;
    element.append(this.host);
  }

  write(data: string): void {
    const text = this.heldNewline + data;
    this.heldNewline = /\r?\n$/.exec(text)?.[0] ?? "";
    const shown = text.slice(0, text.length - this.heldNewline.length);
    if (shown === "") return;
    if (this.element.hidden) this.show();
    this.terminal.write(shown);
  }

  // Empties the pane for a new run and hides it until output arrives.
  clear(): void {
    this.terminal.reset();
    this.heldNewline = "";
    this.terminal.resize(this.terminal.cols, 1);
    this.element.hidden = true;
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.terminal.dispose();
    this.host.remove();
  }

  private show(): void {
    this.element.hidden = false;
    if (!this.opened) {
      this.opened = true;
      this.terminal.open(this.host);
      this.resizeObserver.observe(this.host);
    }
    this.fitWidth();
  }

  // Columns follow the pane's width; rows are set by fitHeight.
  private fitWidth(): void {
    if (this.element.hidden) return;
    const size = this.fit.proposeDimensions();
    if (size && size.cols !== this.terminal.cols)
      this.terminal.resize(size.cols, this.terminal.rows);
  }

  // One row per line of output, up to the height limit; beyond it, the pane scrolls.
  private fitHeight(): void {
    if (this.element.hidden) return;
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
