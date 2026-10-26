# Runbook — MVP Specification

> Working name: **Runbook** (package name `runbook`). The name may change later; keep it in one constant/config place.
>
> This document is the source of truth for the MVP. Build only what is listed under **In scope**. Design decisions settled in review are folded into this document directly. If something is still ambiguous during implementation, choose the simplest option that satisfies the acceptance criteria and note the decision in `DECISIONS.md`.

---

## 1. Product summary

A Linux desktop app (Electron, targeting Ubuntu 24.04+) for writing **executable runbooks**: notebooks that mix markdown explanations with shell command cells. Each notebook has **one persistent shell session**, so `cd`, `export`, sourced virtualenvs, etc. carry over between cells, exactly like typing them in a terminal one after another. Output streams live into a real terminal emulator under each cell.

Notebooks are stored as **plain Markdown files** with fenced code blocks, so they stay readable in any editor and diff cleanly in git.

### Target user

A developer or Linux power user who keeps re-Googling the same fixes and setup steps ("fix audio after update", "set up a new dev machine") and wants them documented _and_ runnable.

---

## 2. Scope

### In scope (MVP)

1. Notebook editor with two cell types: **Markdown** and **Shell**.
2. Add, edit, delete, and reorder cells.
3. Run a shell cell in a persistent per-notebook bash session (via `node-pty`), with live, colored output rendered by `xterm.js`. Sessions stay alive when switching notebooks (§6.6).
4. Interactive input into a running cell (e.g. `sudo` password prompts, `[Y/n]` questions).
5. Stop a running cell (send Ctrl+C).
6. Show each cell's last run status: running / succeeded (exit 0) / failed (non-zero, with code) / interrupted.
7. Restart a notebook's shell session.
8. Store notebooks as `.md` files in a notebooks folder; autosave.
9. Sidebar listing all notebooks, with create / rename / delete and full-text search.
10. Minimal settings: notebooks folder location.
11. Keyboard shortcuts (§9.5).
12. Packaging as `.deb` and AppImage (Linux only).

### Out of scope (do NOT build yet)

Input/variable cells, check cells, run history persistence (SQLite), "run all", danger-command detection, terminal capture mode, templates, AI features, SSH/remote targets, scheduling, shells other than bash, Windows/macOS support (including macOS build targets), cloud sync, multiple windows, tabs. Leave clean extension points, but no stub UI for these.

---

## 3. Tech stack

Use the latest **stable** versions at the time of scaffolding (no betas). Versions below were current on 2026-10-25.

| Concern               | Choice                                                                                |
| --------------------- | ------------------------------------------------------------------------------------- |
| App shell             | Electron                                                                              |
| Build tooling         | `electron-vite` (Vite for main, preload, renderer)                                    |
| Language              | TypeScript, `strict: true` everywhere                                                 |
| UI                    | Svelte                                                                                |
| Styling               | Tailwind                                                                              |
| Terminal output       | `@xterm/xterm` 6.0 + `@xterm/addon-fit`                                               |
| PTY                   | `node-pty` 1.1 (main process only; native module, see §11)                            |
| Code editing in cells | CodeMirror 6 (`@codemirror/lang-markdown`, shell mode via `@codemirror/legacy-modes`) |
| Markdown rendering    | `markdown-it` 15 with `html: false` (no raw HTML)                                     |
| Frontmatter           | `yaml` 2 (Document API, so comments and formatting survive edits)                     |
| IDs                   | `nanoid` (8-char, URL-safe)                                                           |
| Search                | In-memory search over loaded notebooks (`minisearch`)                                 |
| Tests                 | `vitest` 5                                                                            |
| Packaging             | `electron-builder` (targets: `deb`, `AppImage`)                                       |

Do not add dependencies beyond this list without a clear reason recorded in `DECISIONS.md`.

---

## 4. Data model

```ts
// src/shared/types.ts
export type CellType = "markdown" | "shell";

export interface Cell {
  id: string; // nanoid(8); stable across saves
  type: CellType;
  source: string; // raw text of the cell, no trailing newline
  info?: string; // shell cells only: the fence info string without the {id=…} attribute,
  //                e.g. "bash", "sh", "shell title=x". New cells use "bash".
}

export interface Notebook {
  path: string; // absolute path to .md file
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
```

Run status and output are **in memory only** for the MVP (lost on app restart).

---

## 5. File format

A notebook is a UTF-8 `.md` file:

````markdown
---
title: Fix audio after kernel update
tags: [audio, pipewire]
---

Restart PipeWire first; this fixes it most of the time.

```bash {id=a1b2c3d4}
systemctl --user restart pipewire pipewire-pulse wireplumber
```

If that didn't work, check the sinks:

```bash {id=e5f6g7h8}
pactl list short sinks
```
````

Saving should change as little of the file as possible: the format's promise is that files stay readable and diff cleanly in git.

### Parsing rules (`parse(text, path): Notebook`)

1. Optional YAML frontmatter at the very top between `---` lines. `title` and `tags` map to fields. Keep the original YAML text in `frontmatterRaw`; other keys are not parsed into the model and survive saves through it.
2. A **shell cell** is a fenced code block whose info string language is `bash`, `sh`, or `shell`. Accept both ``` and ~~~ fences, with fence length ≥ 3, matching the opening fence's character and length for the close.
3. Only **top-level** fences become shell cells: the opening fence is indented at most 3 spaces and is not inside a list item or blockquote (CommonMark container blocks). Fences inside lists or quotes stay part of the surrounding markdown cell.
4. The fence info string may contain `{id=XXXX}`. If it's missing, generate an ID (it will be written on the next save). The rest of the info string is kept in `Cell.info`.
5. **Everything between shell cells** (including non-shell code blocks, e.g. ```python) is a **markdown cell**. Consecutive markdown content forms one markdown cell. Trim leading and trailing blank lines from each markdown cell; drop markdown cells that are empty after trimming.
6. Markdown cells get IDs in memory only (not written to the file).
7. An unclosed shell fence: treat the rest of the file as that cell's content (don't throw).
8. Detect the line ending from the file (`\r\n` if its first line break is CRLF, else `\n`). Cell sources are held with `\n` internally.

### Serialization rules (`serialize(notebook): string`)

1. **Frontmatter:**
   - If the file had frontmatter, write it back from `frontmatterRaw`. If `title` or `tags` changed, apply the changes with the `yaml` Document API so comments, key order, styles (e.g. flow lists `[a, b]`) and other keys survive untouched.
   - If the file had no frontmatter, write one only if `title` differs from the filename (without `.md`) or `tags` is non-empty. Write `title`, then `tags`.
2. Cells are separated by exactly one blank line.
3. Shell cells are written as ` ```<info> {id=<id>} `, using the cell's original `info` (e.g. `sh`, `bash title=x`). If the source itself contains a line starting with ` ``` `, use a longer fence (e.g. ` ```` `). If `info` contains a backtick, use a `~~~` fence instead, since backtick fences can't.
4. Lines end with the notebook's `lineEnding`.
5. File ends with a single trailing line ending.

### Round-trip requirement

`serialize(parse(serialize(parse(x))))` must equal `serialize(parse(x))` for all test fixtures (serialization is idempotent after the first normalization). Cell sources must never be altered except for trimming markdown cell boundary blank lines. The fence language and extra info-string attributes, frontmatter comments and formatting, and CRLF line endings must survive a round trip.

---

## 6. Shell session design (the critical part)

One `ShellSession` per notebook, created lazily on the first run. See §6.6 for its lifetime.

### 6.1 Spawning

- Spawn `bash --noediting --rcfile <generatedRcPath> -i` via `node-pty` with `name: 'xterm-256color'` and `cwd: os.homedir()`. `--noediting` turns off readline, so the output stream contains nothing but command output and markers.
- Initial cols/rows: 120×30. The renderer reports resizes for the currently running cell's output pane; apply them via `pty.resize`.
- **Environment:** build it explicitly with a pure, unit-tested function `buildShellEnv(env)`, starting from `process.env`:
  - Remove variables Electron and the dev tooling add: `CHROME_DESKTOP`, `FC_FONTATIONS`, `NO_AT_BRIDGE`, `GDK_BACKEND`, and every `ELECTRON_*`.
  - Remove the ones node-pty strips by default (it stops doing so when given a custom env): `TMUX`, `TMUX_PANE`, `STY`, `WINDOW`, `WINDOWID`, `TERMCAP`, `COLUMNS`, `LINES`.
  - When running from an AppImage (`APPIMAGE` is set): remove `APPDIR`, `APPIMAGE`, `ARGV0`, `OWD`, and strip entries under `$APPDIR` from `PATH`, `LD_LIBRARY_PATH`, `XDG_DATA_DIRS`, and `GSETTINGS_SCHEMA_DIR`. Drop any of these that end up empty. (The AppImage launcher prepends its own paths; left in place, `LD_LIBRARY_PATH` would make user commands load the AppImage's bundled libraries.)
  - Set `TERM=xterm-256color`.
- Note: when launched from a desktop entry, Electron's `process.env` may lack the user's login PATH. The rcfile sources the user's files, which fixes this for interactive bash.

### 6.2 Generated rcfile

Written once to `app.getPath('userData')/rcfile.bash`:

```bash
# Load the user's normal environment
[ -f /etc/bash.bashrc ] && source /etc/bash.bashrc
[ -f ~/.profile ] && source ~/.profile
[ -f ~/.bashrc ] && source ~/.bashrc

# Silence prompts so only command output is shown
PS1=''
PS2=''
unset HISTFILE

__rb_cur=''

__rb_run() {
  # $1 = run id, $2 = script path
  __rb_cur=$1
  stty echo
  printf '\033]777;rb-start;%s\007' "$1"
  source "$2"
}

# Runs before every prompt, including after Ctrl+C aborts __rb_run,
# so the done marker is always emitted.
__rb_after() {
  local __rb_rc=$?
  stty -echo
  set +e
  # Discard input typed during the run (full or partial lines) so it never
  # executes as a command.
  while read -r -s -t 0.05 -n 4096 _; do :; done
  if [ -n "$__rb_cur" ]; then
    printf '\033]777;rb-done;%s;%d\007' "$__rb_cur" "$__rb_rc"
    __rb_cur=''
  elif [ -z "$__rb_ready" ]; then
    # First prompt: only now is bash actually waiting for input.
    __rb_ready=1
    printf '\033]777;rb-ready\007'
  fi
}
PROMPT_COMMAND='__rb_after'

stty -echo
```

Why this shape (verified against real bash under a pty):

- Ctrl+C makes bash abandon the whole `__rb_run` function, so anything after `source` never runs. `PROMPT_COMMAND` still runs before the next prompt, so the done marker, `stty -echo`, and `set +e` live there.
- Without the drain, input typed while a cell runs that the cell doesn't read is executed by bash as a new command once the run ends, and a partial line is glued onto the next `__rb_run` line. The drain costs about 50 ms per run.
- Both `rb-ready` and `rb-done` are printed **after** the drain. The host writes the next `__rb_run` line as soon as it sees a marker; a marker printed before the drain would let the drain swallow that line.
- `set +e` limits a cell's `set -e` to that cell (§6.5).

### 6.3 Run protocol

1. Wait for the `rb-ready` marker before marking the session `ready`. Discard all output before it (rc noise, MOTD). If it doesn't arrive within **10 s**, kill the pty, mark the session `dead`, and show a notice: "Shell didn't start. Your ~/.bashrc may exec another shell or wait for input." Include the first lines of the startup output to help debugging.
2. To run a cell:
   - Write the cell source to a temp file `<os.tmpdir()>/runbook/<sessionId>/<runId>.sh` (mode 0600). `runId = nanoid(8)`.
   - Write the line `__rb_run <runId> <tmpPath>\n` to the pty. Because echo is off, this line is not displayed.
   - Using `source` (not a subshell) is what makes `cd`/`export`/aliases persist.
3. Parse the pty output stream for OSC 777 markers, `ESC ] 777 ; ... BEL`.
   - Markers can be split across chunks: keep a small carry-over buffer.
   - **Strip markers** from the data before forwarding it to the renderer.
   - Data between `rb-start;<runId>` and `rb-done;<runId>;<code>` is that cell's output.
   - On `rb-done`, set state `success` (code 0) or `failed`, record `exitCode`, delete the temp file.
4. **One cell at a time per session.** If a run is requested while busy, queue it (state `queued`) and run it in FIFO order. Cancelling a queued cell removes it from the queue.
5. **Stop:** write `\x03` to the pty. When the subsequent `rb-done` arrives with code 130 (or any code after a stop was requested), set state `interrupted`. Because echo is on during a run, the output shows `^C` before the marker, as in a terminal.
6. **User input:** while a cell is running, keystrokes from its xterm instance (`onData`) are written to the pty. Input from non-running cells' terminals is ignored. Input the cell never reads is discarded when the run ends (§6.2).
7. **Session death:** if the pty exits (e.g. a cell ran `exit`, or a command failed under `set -e`), mark the running cell `failed` with the shell's exit status as `exitCode`, mark the session `dead`, and reject queued runs. The next run request transparently spawns a fresh session. Show a notice in the notebook: "Shell session ended (exit N). A `set -e` or `exit` in a cell ends the session. Next run will start a new session."
8. **Restart session:** kill the pty and spawn a new one; clear the queue; mark any running cell `interrupted`.
9. On app quit, kill all ptys and remove the temp directory.

### 6.4 Output routing

- Before `rb-ready`: discarded (or kept for the startup-failure notice, §6.3.1).
- Between `rb-start` and `rb-done`: the running cell.
- After `rb-done` (e.g. a background job started with `cmd &`): the last-run cell.

### 6.5 Known limitations to document (not fix) in the MVP

- Full-screen TUI apps (`vim`, `htop`) will render oddly in the small inline output; that's acceptable.
- A cell that starts a background job (`cmd &`) may keep printing after `rb-done`; that output is routed to the last-run cell.
- `set -e` is reset after each cell, but a failing command in the **same** cell that enabled it still ends the session (bash exits from a sourced file under `set -e`). `exit` ends the session too. `set -u` and `set -o pipefail` persist across cells, as in a terminal.
- A cell that overrides `PROMPT_COMMAND` or `stty` settings can break the run protocol; restarting the session recovers.

### 6.6 Session lifetime

- Sessions are keyed by notebook path and **stay alive when switching notebooks**: running cells keep running in the background. The renderer keeps each visited notebook's per-cell output (xterm buffers, capped by the 5000-line scrollback) and run statuses in memory, so switching back shows everything as it was.
- A session ends only on: restart (§6.3.8), the shell exiting (§6.3.7), deleting the notebook, changing the notebooks folder (all sessions are closed), or app quit.
- Renaming a notebook moves its session to the new path without restarting it.

---

## 7. IPC contract

Renderer ↔ main communicate only through a typed `window.api` exposed by the preload script. No other Node access in the renderer.

```ts
// Requests (ipcRenderer.invoke / ipcMain.handle)
interface Api {
  // notebooks
  listNotebooks(): Promise<NotebookSummary[]>; // { path, title, tags, mtime }
  readNotebook(path: string): Promise<Notebook>;
  saveNotebook(nb: Notebook): Promise<void>; // atomic write
  createNotebook(title: string): Promise<Notebook>; // slugified filename, unique
  renameNotebook(path: string, newTitle: string): Promise<Notebook>; // renames file + title
  deleteNotebook(path: string): Promise<void>; // moves to OS trash via shell.trashItem
  searchNotebooks(query: string): Promise<SearchResult[]>; // { path, title, snippet }

  // execution
  runCell(notebookPath: string, cellId: string, source: string): Promise<void>;
  cancelCell(notebookPath: string, cellId: string): Promise<void>; // stop or dequeue
  sendInput(notebookPath: string, data: string): Promise<void>;
  resizeSession(notebookPath: string, cols: number, rows: number): Promise<void>;
  restartSession(notebookPath: string): Promise<void>;
  closeSession(notebookPath: string): Promise<void>;

  // settings
  getSettings(): Promise<Settings>; // { notebooksDir }
  setNotebooksDir(): Promise<Settings | null>; // opens folder picker

  // events (main -> renderer); each returns an unsubscribe function
  onCellOutput(cb: (e: { notebookPath: string; cellId: string; data: string }) => void): () => void;
  onCellStatus(cb: (e: { notebookPath: string; status: CellRunStatus }) => void): () => void;
  onSessionState(cb: (e: { notebookPath: string; state: SessionState }) => void): () => void;
}
```

All main-process handlers must validate that any `path` argument resolves inside the configured notebooks folder (use `path.resolve` + prefix check) and ends in `.md`. Reject anything else.

---

## 8. Storage & settings

- Default notebooks folder: `~/Runbooks` (create it on first launch if missing).
- Settings live in `app.getPath('userData')/settings.json`. `userData` is named after the app ID, not the product name: `~/.config/com.codiume.runbook`.
- On first launch, if the folder is empty, create one sample notebook (`Welcome.md`) demonstrating markdown cells, a `cd` + `pwd` persistence example, and an `echo` with colors.
- **Autosave:** debounce 500 ms after the last edit; also save on notebook switch and window close. Writes are atomic: write `<file>.tmp`, then `fs.rename`.
- **External changes:** on window focus, re-scan the folder for the sidebar. If the open notebook's file `mtime` changed and there are no unsaved local edits, reload it silently; if there are unsaved edits, show a banner: "This file changed on disk. Reload / Keep mine."
- Filenames: slugify the title (`Fix audio after update` → `fix-audio-after-update.md`), adding `-2`, `-3`, etc. on collision.

---

## 9. UI specification

### 9.1 Layout

```txt
┌───────────────┬───────────────────────────────────────────────┐
│ [Search…    ] │  Fix audio after kernel update  [⟳ Session ●]│
│               │  tags: audio, pipewire                        │
│ + New         │ ───────────────────────────────────────────── │
│               │  Restart PipeWire first; this fixes it…       │
│ ▸ Fix audio…● │                                               │
│ ▸ New dev box │  ┌ bash ─────────────────────── [▶] [■] [⋮] ┐ │
│ ▸ Welcome     │  │ systemctl --user restart pipewire …      │ │
│               │  └──────────────────────────────────────────┘ │
│               │   ✓ exit 0 · 0.4s                             │
│               │  ┌ output (xterm) ──────────────────────────┐ │
│               │  │ …                                        │ │
│ [⚙ Settings]  │  └──────────────────────────────────────────┘ │
│               │            [+ Markdown]  [+ Shell]            │
└───────────────┴───────────────────────────────────────────────┘
```

### 9.2 Sidebar

- Search box at the top; empty query shows all notebooks sorted by title. A non-empty query shows results with a one-line snippet.
- "+ New" opens an inline title input and then opens the new notebook.
- Right-click (or ⋮) on an item: Rename, Delete (with confirm dialog), Show in folder.
- Notebooks with a live session show the session dot (same colours as the header), so a cell still running in the background is visible.
- Settings button at the bottom.

### 9.3 Notebook view

- Header: editable title (click to edit), tags (comma-separated inline editor), session indicator dot (grey = no session, green = ready, amber = busy, red = dead) with a "Restart session" action.
- Cells in a vertical list. Hovering a cell shows a drag handle on the left and an "add cell below" control between cells.
- **Markdown cell:** rendered by default. Click or Enter (when focused) switches to a CodeMirror editor; Esc or clicking outside renders it again.
- **Links in rendered markdown:** `http:` and `https:` links open in the system browser. All other schemes (`file:`, `javascript:`, relative paths) do nothing.
- **Shell cell:** always shows a CodeMirror editor (bash highlighting, monospace). Toolbar: Run ▶ (becomes Stop ■ while running or queued), and a menu ⋮ with "Clear output", "Delete cell", "Move up", "Move down".
- **Status line** under a shell cell after its first run: spinner + "running…", "queued", "✓ exit 0 · 1.2s", "✗ exit 2 · 0.3s", or "■ interrupted".
- **Output pane:** an xterm.js instance created on first run of that cell. Auto-height up to 400 px, then it scrolls (scrollback 5000 lines). Each new run clears the previous output. Clicking into the pane while the cell runs focuses it for typing input. Hide the pane if output is empty.
- **Session notices** (shell didn't start, session ended) appear at the top of the notebook view (§6.3).
- Empty notebook state: "This runbook is empty" with "+ Markdown" and "+ Shell" buttons.

### 9.4 Look & feel

- Follow the system light/dark preference (`prefers-color-scheme`); xterm theme matches.
- System UI font for prose; a monospace stack (`"Ubuntu Mono", "DejaVu Sans Mono", monospace`) for code and output.
- Clean and calm: generous spacing, subtle borders, no gradients.
- Window: default 1200×800, minimum 800×500; remember size and position across launches.

### 9.5 Keyboard shortcuts

| Shortcut               | Action                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `Shift+Enter`          | Run the focused shell cell and move focus to the next cell |
| `Ctrl+Enter`           | Run the focused shell cell and keep focus                  |
| `Ctrl+.`               | Stop the running (or dequeue the queued) focused cell      |
| `Enter`                | Edit the focused markdown cell                             |
| `Esc`                  | Leave the cell editor or the output pane                   |
| `Alt+↑` / `Alt+↓`      | Move the focused cell up / down                            |
| `Ctrl+Shift+Backspace` | Delete the focused cell                                    |
| `Ctrl+N`               | New notebook                                               |
| `Ctrl+K`               | Focus search                                               |

`Ctrl+C` inside a running cell's output pane always goes to the shell (it is not a copy shortcut there).

---

## 10. Milestones & acceptance criteria

Work through these in order. Finish each milestone (including its tests) before starting the next. After each, run lint, typecheck, and tests, then **stop and hand over**: give a short summary of the changes and a one-line commit message. The user makes the commit (commits are GPG-signed).

### M0 — Test setup

The scaffolding is already Linux-only: `electron-builder.yml` targets `deb` and AppImage, and the release workflow builds on Ubuntu only.

- Add `vitest`, a `"test": "vitest run"` script, include it in `pnpm check`, and run it in `ci.yml`.
- ✅ `pnpm check` passes; `pnpm dist --linux` still builds the `.deb` and AppImage.

### M1 — Notebook format & storage

- Implement `parse` / `serialize` (§5) with fixtures in `tests/fixtures/`: frontmatter variants (including comments and flow lists), no frontmatter, missing IDs, nested fences, non-bash code blocks, `sh`/`shell` fences and extra info-string attributes, fences inside lists and blockquotes, unclosed fence, CRLF line endings, empty file.
- Implement `storage.ts` and `settings.ts` (§8).
- ✅ All round-trip tests pass. Creating/renaming/deleting via a temporary test harness works on disk.

### M2 — Shell session engine

- Implement `ShellSession`, `SessionManager`, and `buildShellEnv` (§6) in the main process, independent of the UI.
- Tests (vitest, running real bash via node-pty) must cover:
  - `echo hello` → output `hello`, exit 0.
  - `cd /tmp` in run 1, `pwd` in run 2 → `/tmp`.
  - `export FOO=bar` then `echo $FOO` → `bar`.
  - `false` → failed, exit 1.
  - Multi-line script with a heredoc works.
  - `sleep 10` + cancel → interrupted within 1 s.
  - A builtin loop (`while true; do :; done`) + cancel → interrupted within 1 s, and the next run works.
  - Input written during a run that the cell doesn't read (a full line and a partial line without Enter) is never executed, and the next run works.
  - `set -e` in run 1, `false` in run 2 → run 2 fails with exit 1 and the session stays alive.
  - Three runs submitted at once execute in order.
  - `exit 3` → session dead with exit code 3; next run spawns a new session and succeeds.
  - A `.bashrc` that never finishes → session `dead` after the 10 s ready timeout (use a test rcfile, not the user's).
  - No OSC marker bytes appear in forwarded output.
  - `buildShellEnv` unit tests: Electron/dev variables removed; AppImage variables and path entries stripped; unrelated variables untouched.
- ✅ All session tests pass reliably (run the suite 5 times locally without flakes, e.g. `vitest run --repeat 4`).

### M3 — Notebook UI

- Notebook view with markdown and shell cells, editing, add/delete, drag-and-drop reorder, run/stop, status line, xterm output, input to running cell, autosave (§9). Sessions and output survive switching notebooks (§6.6).
- Wire everything through the preload API (§7).
- ✅ Manual check: open the Welcome notebook, run the `cd`/`pwd` example and see persistence; run `sudo -v` and type a password into the output pane; reorder cells and confirm the `.md` file on disk reflects the new order; start `sleep 30` in one notebook, switch to another and back, and see it still running.

### M4 — Sidebar, search, settings

- Sidebar list, create/rename/delete, search with snippets, settings folder picker, external-change handling, window size persistence, keyboard shortcuts (§9.5).
- ✅ Changing the notebooks folder reloads the sidebar; editing a file in another editor reloads it in the app; all shortcuts in §9.5 work.

---

## 11. Notes for the implementer (Claude Code)

- Keep `src/shared/notebook.ts` pure (no Node or Electron imports) so it's trivially testable. `markdown-it`'s token stream (fence tokens with `level` and line `map`) is a convenient way to find top-level fences (§5 rule 3).
- Keep `ShellSession` free of Electron imports; it emits events (`output`, `status`, `state`) that `ipc.ts` forwards to the renderer. This keeps it testable in plain Node.
- Batch output events: coalesce pty data and forward to the renderer at most every ~16 ms per cell to avoid flooding IPC on noisy commands.
- **`node-pty` is a native module:**
  - Put it in `dependencies` (not `devDependencies`) so electron-builder ships it, and keep it external to the main bundle (electron-vite's default).
  - Allow its install script in `pnpm-workspace.yaml` (`allowBuilds: node-pty: true`). On Linux it compiles with node-gyp, so dev machines and CI need `python3`, `make`, and `g++` (present on Ubuntu runners).
  - It uses N-API: one compiled binary loads in both plain Node (vitest) and Electron, so no `electron-rebuild` step is needed.
  - electron-builder unpacks native modules from the asar automatically; no `asarUnpack` config is needed, and the Electron fuses don't interfere.
- Prefer small, focused modules and explicit types over cleverness.
- Record any deviation from this spec, and why, in `DECISIONS.md`.
- Don't implement anything from §2 "Out of scope".
