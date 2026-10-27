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

// Why a session became dead on its own (SPEC §6.3.1, §6.3.7), for the notebook's notice.
export type SessionEnd =
  | { type: "start-failed"; output: string } // the first output, to help find the cause
  | { type: "exited"; exitCode: number };

// A notebook as listed in the sidebar, without its cells.
export interface NotebookSummary {
  path: string;
  title: string;
  tags: string[];
  mtime: number; // epoch ms
}

export interface Settings {
  notebooksDir: string; // absolute path
}
