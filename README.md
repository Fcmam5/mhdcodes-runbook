# Runbook

Runbooks for your own machine: Markdown notes with shell cells you can run.

Write down how you fixed something, with the commands in between, and run them again next
time with one click. All the cells of a runbook share one bash session, so a `cd` or an
`export` in one cell still holds in the next. Runbooks are plain `.md` files in a folder,
so you can read them anywhere and keep them in git.

**[Download for Linux](https://github.com/mhdcodes/runbook/releases/latest)** (`.deb` and
AppImage, x86-64)

## Features

- Live, coloured output, and typing into a running command (a `sudo` password, a `[Y/n]`)
- Each runbook's bash starts with your `~/.profile` and `~/.bashrc`, and keeps running in
  the background while you look at another runbook
- Stop a command, restart the session, or clear it to start over
- Each cell shows its last run: running, `exit 0 · 1.2s`, the exit code it failed with, or
  interrupted
- Full-text search over titles, tags and cells
- Autosave
- Keyboard shortcuts for running and stopping cells

## Download

The [releases page](https://github.com/mhdcodes/runbook/releases) has, for x86-64 Linux:

- `runbook-<version>-amd64.deb`: for Ubuntu 24.04 or newer, and Debian.
- `runbook-<version>-x86_64.AppImage`: for any other distribution from the last few years.

Install the `.deb` from the folder you downloaded it to, then open Runbook from your app
launcher:

```sh
cd ~/Downloads
sudo apt install ./runbook-*-amd64.deb
```

Or make the AppImage executable and start it:

```sh
cd ~/Downloads
chmod +x runbook-*-x86_64.AppImage
./runbook-*-x86_64.AppImage
```

## Using Runbook

On first start, Runbook creates `~/Runbooks` with a Welcome runbook that walks through the
basics. Every `.md` file in that folder is a runbook. To run a shell cell, click its Run
button or press `Ctrl+Enter`.

A shell cell is a fenced code block marked `bash`, `sh` or `shell`, outside lists and
quotes. Everything else, other code blocks included, is Markdown:

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

You can edit runbooks in another editor or update them with `git pull`. If a file changed on
disk since Runbook opened or saved it, Runbook asks before saving: read the changes from
disk, or overwrite them.

### Settings

Runbook creates `~/.config/codes.mhd.runbook/settings.json` on first start. To keep
runbooks somewhere else, set `runbooksDir` in it to the folder's absolute path (a path
starting with `~` is ignored) and restart Runbook:

```json
{ "runbooksDir": "/home/you/notes/runbooks" }
```

### Keyboard shortcuts

| Shortcut               | Action                                             |
| ---------------------- | -------------------------------------------------- |
| `Shift+Enter`          | Run the focused cell and move to the next          |
| `Ctrl+Enter`           | Run the focused cell and stay on it                |
| `Ctrl+.`               | Stop the focused cell, or take it out of the queue |
| `Enter`                | Edit the focused Markdown cell                     |
| `Esc`                  | Leave the cell editor or the output                |
| `Ctrl+Shift+Backspace` | Delete the focused cell                            |
| `Ctrl+N`               | New runbook                                        |
| `Ctrl+K`               | Search                                             |

In the output of a running cell, every key except `Esc` and `Ctrl+.` goes to the command,
`Ctrl+C` included.

## Safety

Shell cells run as you, with your environment, like commands typed in a terminal. Nothing
runs when you open a runbook, so read one you got from someone else before running its
cells.

## Build from source

You need [Node.js](https://nodejs.org) 24 or newer. `corepack enable` sets up the
[pnpm](https://pnpm.io) version pinned in `package.json`; Node 25 and newer no longer
include Corepack, so install it first there with `npm install -g corepack`.

```sh
git clone https://github.com/mhdcodes/runbook.git
cd runbook
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` starts the app with hot reload, and restarts it when the main or preload code
changes. Like `pnpm start`, it turns off Chromium's sandbox, and its first run downloads
Electron (about 100 MB).

| Script           | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`       | Run the app in development mode with hot reload                                    |
| `pnpm start`     | Preview the production build                                                       |
| `pnpm test`      | Run the tests (Vitest, in Node, against real bash)                                 |
| `pnpm build`     | Type-check, then bundle main, preload and renderer into `out/`                     |
| `pnpm dist`      | Build the `.deb` and the AppImage into `dist/` (`--dir`: the unpacked app only)    |
| `pnpm typecheck` | Type-check every TypeScript project (`tsc -b`) and the Svelte files (svelte-check) |
| `pnpm lint`      | Lint with oxlint, failing on warnings (`pnpm lint:fix` to fix)                     |
| `pnpm format`    | Format with oxfmt (`pnpm format:check` to check only)                              |
| `pnpm check`     | The format check, lint, type-check and tests together                              |

`pnpm dist` takes about a minute, and the installers must be built on Linux.

## How it fits together

Runbook is an [Electron](https://www.electronjs.org) app, with the interface in
[Svelte 5](https://svelte.dev), [CodeMirror](https://codemirror.net) for editing and
[xterm.js](https://xtermjs.org) for output. [SPEC.md](./SPEC.md) describes it in full: the
file format, the shell sessions and the interface. [CONTEXT.md](./CONTEXT.md) defines the
terms the code uses.

- `src/main` is the main process: runbook files, search, settings and the window.
  `src/main/shell` runs one bash per runbook over node-pty, with no Electron imports, so it's
  tested in plain Node.
- `src/preload` exposes the typed `window.api`; its type is in `api.ts`.
- `src/shared` holds what both processes use: types, the runbook format, previews, links.
- `src/renderer` is the interface. `components/` holds the Svelte components, `lib/` the glue
  to CodeMirror, xterm and the DOM, and `state/` plain state logic with no DOM, tested in
  Node.
- `tests/` holds the Vitest tests, and `build/` the app icon (`icon.svg`, rendered to a
  512 px `icon.png`).

TypeScript is split into three projects on `tsconfig.base.json` (`strict`, plus extra
checks): `tsconfig.node.json` for main and preload, `tsconfig.web.json` for the renderer (DOM
only, so Node globals can't leak in), and `tsconfig.test.json` for the tests and the code they
import. The tests run in Node, which is why `renderer/src/state/` must stay free of the DOM.

To add an IPC call:

1. Register a handler in `src/main/ipc.ts`: `ipcMain.handle("ns:action", (_e, arg: unknown) => ...)`.
   Check every argument there; a runbook path goes through `resolveRunbookPath`
   ([SPEC §7](./SPEC.md#7-ipc-contract)).
2. Add the method to the `Api` interface in `src/preload/api.ts`.
3. Implement it in `src/preload/index.ts` as an explicit function:
   `action: (arg) => ipcRenderer.invoke("ns:action", arg)`. Never expose `ipcRenderer` itself.
4. Call `window.api.action(...)` from the renderer.

### Security

- `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true` on the window. The
  renderer reaches the main process only through `window.api`.
- A strict Content-Security-Policy in `index.html`. Rendered Markdown can't contain raw HTML.
- New windows are denied. `http:` and `https:` links open in the system browser, and the
  app's page can't navigate anywhere else.
- A single-instance lock.
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) are set at package
  time: see `electronFuses` in [electron-builder.yml](./electron-builder.yml).

## License

[MIT](./LICENSE)
