# Runbook

Runbooks for your own machine: Markdown notes with shell cells you can run.

Write down how you fixed something, with the commands in between, and run them again next
time with one click. All the cells of a runbook share one bash session, so a `cd` or an
`export` in one cell still holds in the next. Runbooks are plain `.md` files in a folder,
so you can read them anywhere and keep them in git.

## Features

- Markdown cells for the notes, shell cells for the commands, in any order
- One bash session per runbook, started with your `~/.profile` and `~/.bashrc`
- Live, coloured output, and typing into a running command (a `sudo` password, a `[Y/n]`)
- Stop a command, restart the session, or clear it to start over
- Each cell shows how its last run went: running, `exit 0 · 1.2s`, the exit code it failed
  with, or interrupted
- Sessions keep running in the background while you look at another runbook
- Full-text search over titles, tags and cells
- Autosave, to plain Markdown that stays readable and diffs cleanly
- Keyboard shortcuts for running, stopping and moving between cells

## Download

Runbook is for Linux on x86-64 (Ubuntu 24.04 or newer, or a similar distribution). The
[releases page](https://github.com/mhdcodes/runbook/releases) has:

- `runbook-<version>-amd64.deb`: for Ubuntu and Debian. Install it with
  `sudo apt install ./runbook-<version>-amd64.deb`.
- `runbook-<version>-x86_64.AppImage`: for any other distribution from the last few years.

To run the AppImage, make it executable and start it:

```sh
chmod +x runbook-<version>-x86_64.AppImage
./runbook-<version>-x86_64.AppImage
```

On Ubuntu 24.04 and newer, the system doesn't let AppImages use Chromium's sandbox, so
Runbook turns it off there. Runbook only shows its own pages, never websites. The `.deb`
keeps the sandbox.

## Using Runbook

On first start, Runbook creates `~/Runbooks` with a Welcome runbook that walks through the
basics. Every `.md` file in that folder is a runbook.

A shell cell is a fenced code block marked `bash`, `sh` or `shell`; everything around the
shell cells is Markdown:

````markdown
---
title: Fix audio after a kernel update
tags: [audio, pipewire]
---

Restart PipeWire first; this fixes it most of the time.

```bash {id=a1b2c3d4}
systemctl --user restart pipewire pipewire-pulse wireplumber
```
````

Runbook adds an `{id=…}` to each shell fence when it saves, so a cell keeps its output and
status as you edit around it. Code blocks in other languages, and code blocks inside lists
or quotes, stay part of the Markdown.

A few things to know about the shell:

- Each runbook has its own bash, started the first time you run one of its cells. It lives
  until you restart or clear it, delete the runbook, or quit Runbook.
- A cell that runs `exit`, or fails under a `set -e` it turned on, ends the session. The
  next run starts a fresh one.
- Runbook only runs a cell when you run it. Nothing runs when you open a runbook.

You can edit runbooks in another editor or update them with `git pull`. If a file changed
outside Runbook since Runbook opened or last saved it, Runbook doesn't overwrite it. It asks
whether to read the changes from disk or overwrite them.

### Settings

To keep runbooks somewhere else, put the folder's absolute path in
`~/.config/codes.mhd.runbook/settings.json` and restart Runbook:

```json
{ "runbooksDir": "/home/you/notes/runbooks" }
```

### Keyboard shortcuts

| Shortcut               | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `Shift+Enter`          | Run the shell cell and move to the next cell                 |
| `Ctrl+Enter`           | Run the shell cell and stay on it                            |
| `Ctrl+.`               | Stop the running cell, or take a queued one out of the queue |
| `Enter`                | Edit the focused Markdown cell                               |
| `Esc`                  | Leave the cell editor or the output                          |
| `Ctrl+Shift+Backspace` | Delete the focused cell                                      |
| `Ctrl+N`               | New runbook                                                  |
| `Ctrl+K`               | Search                                                       |

In the output of a running cell, every key goes to the command, `Ctrl+C` included.

## Safety

Shell cells run as you, with your environment, like commands typed in a terminal. Read a
runbook you got from someone else before running its cells.

## Build from source

You need [Node.js](https://nodejs.org) 24 or newer and [pnpm](https://pnpm.io) 12
(`corepack enable` picks up the version pinned in `package.json`).

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the app with hot reload for the interface. Changes to the main and preload
scripts rebuild and restart it. `pnpm install` doesn't download the Electron binary (about
100 MB): `pnpm dev` and `pnpm start` fetch it on their first run.

| Script           | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | Run the app in development mode with hot reload                      |
| `pnpm start`     | Preview the production build                                         |
| `pnpm test`      | Run the tests (Vitest, in Node, against real bash)                   |
| `pnpm build`     | Type-check and bundle main, preload and renderer into `out/`         |
| `pnpm dist`      | Package installers for the current OS (`pnpm dist --linux`, `--dir`) |
| `pnpm typecheck` | Type-check with `tsc` (main/preload) and `svelte-check` (interface)  |
| `pnpm lint`      | Lint with oxlint, failing on warnings (`pnpm lint:fix` to fix)       |
| `pnpm format`    | Format with oxfmt (`pnpm format:check` to check only)                |
| `pnpm check`     | The format check, lint, type-check and tests together                |

`build` compiles the TypeScript and Svelte sources into `out/`, which is what Electron runs.
`dist` runs `build`, then packages `out/` with the Electron runtime into installers in
`dist/`, which takes about a minute. `pnpm dist --dir` builds only the unpacked app, a
quick smoke test. The `.deb` and the AppImage must be built on Linux.

### CI and releases

Two GitHub Actions workflows live in `.github/workflows/`:

- **`ci.yml`** runs on every push to `main` and every pull request: the format check, lint,
  tests and `pnpm build` (which includes the type-check).
- **`release.yml`** builds the `.deb` and the AppImage. Each is attached to the run as its
  own download.

To publish a release, push a version tag:

```sh
git tag v1.2.0
git push origin v1.2.0
```

The workflow takes the version from the tag, so `package.json` doesn't need a bump first. It
creates a GitHub release with the installers and generated release notes. Running the
workflow by hand from the Actions tab builds the installers without publishing anything.

### How it fits together

Runbook is an [Electron](https://www.electronjs.org) app, with the interface in
[Svelte 5](https://svelte.dev), [CodeMirror](https://codemirror.net) for editing and
[xterm.js](https://xtermjs.org) for output. SPEC.md describes it in full: the file format,
the shell sessions and the interface.

```sh
src/
├── main/                    # Main process (Node)
│   ├── index.ts             # App lifecycle: single-instance lock, startup, quit
│   ├── window.ts            # The window: options, close handling, links
│   ├── window-state.ts      # Remembered window size and position
│   ├── ipc.ts               # IPC handlers behind `window.api`
│   ├── runbooks.ts          # Runbook files in the runbooks folder
│   ├── search.ts            # Full-text search over runbooks
│   ├── settings.ts          # settings.json
│   ├── welcome.ts           # The sample Welcome runbook
│   ├── fs.ts                # File-system helpers
│   └── shell/               # One bash per runbook over node-pty (no Electron imports)
├── preload/
│   ├── index.ts             # Exposes a typed `window.api` via contextBridge
│   └── api.ts               # The `Api` type (used by preload and renderer)
├── shared/                  # Used by both processes: types, runbook format, previews, links
└── renderer/
    ├── index.html           # Entry HTML with a strict Content-Security-Policy
    └── src/
        ├── main.ts          # Mounts the Svelte app
        ├── App.svelte
        ├── app.css          # Tailwind entry and theme (dark only)
        ├── env.d.ts         # Global types (`window.api`)
        ├── components/      # Svelte components
        ├── lib/             # Glue to the DOM: CodeMirror, xterm, markdown, the app's stores
        └── state/           # Plain state logic, no DOM: tested in Node
tests/                       # Vitest, run in Node
build/                       # The app icon: icon.svg, rendered to icon.png (512 px)
electron.vite.config.ts      # Build config for main / preload / renderer
electron-builder.yml         # Packaging config (targets, fuses)
```

TypeScript is split into three projects, all extending `tsconfig.base.json`, which turns on
`strict` plus extra checks such as `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`:

- `tsconfig.node.json`: main and preload, with Node types.
- `tsconfig.web.json`: the renderer, DOM only, so Node globals can't leak into the interface.
- `tsconfig.test.json`: the tests and the code they import, with Node types, since Vitest
  runs in Node. This includes `renderer/src/state/`, which must stay free of the DOM.

To add an IPC call:

1. Register a handler in `src/main/ipc.ts`: `ipcMain.handle("ns:action", (_e, arg) => ...)`.
2. Add the method to the `Api` interface in `src/preload/api.ts`.
3. Implement it in `src/preload/index.ts`: `action: (arg) => ipcRenderer.invoke("ns:action", arg)`.
4. Call `window.api.action(...)` from the renderer.

### Security

- `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true` on the window.
- The renderer reaches the main process only through the API in `src/preload/index.ts`. Add
  new capabilities there as explicit functions; never expose `ipcRenderer` itself.
- A strict Content-Security-Policy in `index.html`. Rendered Markdown can't contain raw HTML.
- New windows are denied. `http:` and `https:` links open in the system browser, and the
  app's page can't navigate anywhere else.
- A single-instance lock.
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) are flipped at
  package time: `RunAsNode` is off, `NODE_OPTIONS` and inspect flags are ignored, the app
  loads only from its ASAR archive, and cookies are encrypted.

## License

[MIT](./LICENSE)
