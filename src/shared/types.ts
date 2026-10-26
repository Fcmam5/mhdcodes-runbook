export type CellType = "markdown" | "shell";

export interface Cell {
  id: string; // nanoid(8); stable across saves for shell cells
  type: CellType;
  source: string; // raw text of the cell, no trailing newline
  // Shell cells only: the fence info string without the {id=…} attribute,
  // e.g. "bash", "sh", "shell title=x". New cells use "bash".
  info?: string;
}

export interface Notebook {
  path: string; // absolute path to the .md file
  title: string; // from frontmatter, fallback = filename
  tags: string[]; // from frontmatter, default []
  frontmatterRaw: string | null; // original YAML text (without the --- lines), null if none
  lineEnding: "\n" | "\r\n"; // detected from the file; new files use "\n"
  cells: Cell[];
}

export type RunState = "idle" | "queued" | "running" | "success" | "failed" | "interrupted";

export interface CellRunStatus {
  cellId: string;
  state: RunState;
  exitCode?: number;
  startedAt?: number; // epoch ms
  endedAt?: number;
}

export type SessionState = "starting" | "ready" | "busy" | "dead";
