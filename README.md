# Runbook

A minimal, secure Electron desktop app built with **Svelte 5**, **TypeScript**, **Tailwind CSS 4**, and **electron-vite**. It is packaged with **electron-builder**.

## Requirements

- Node.js **>= 24**
- pnpm **>= 12** (`corepack enable` picks up the version pinned in `package.json`)

## Getting started

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts Vite with hot module replacement (HMR) for the renderer. Changes to the main and preload scripts trigger a rebuild and restart.

`pnpm install` does not download the Electron binary (about 100 MB). `pnpm dev` and `pnpm start` download it on
first run via `install-electron`, and skip that step once it is installed. CI never runs them, so it never downloads
the binary. Packaging doesn't need it either, because electron-builder fetches its own copy.

## Scripts

| Script           | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `pnpm dev`       | Run the app in development mode with HMR                                               |
| `pnpm start`     | Preview the production build locally                                                   |
| `pnpm build`     | Type-check and bundle main, preload, and renderer into `out/`                          |
| `pnpm dist`      | Package installers for the current OS (`pnpm dist --mac`, `--win`, `--linux`, `--dir`) |
| `pnpm typecheck` | Type-check with `tsc` (main/preload) and `svelte-check` (UI)                           |
| `pnpm lint`      | Lint with oxlint, failing on warnings (`pnpm lint:fix` to auto-fix)                    |
| `pnpm format`    | Format with oxfmt (`pnpm format:check` to verify only)                                 |
| `pnpm check`     | Run the format check, lint, and type-check (use this in CI)                            |

Installers are written to `dist/`. `pnpm dist --dir` builds an unpacked app only, which is a quick smoke test.

### `build` vs `dist`

`build` compiles the TypeScript and Svelte sources into plain JavaScript and CSS in `out/`. That takes a few seconds,
and Electron can only run the compiled output. `dist` runs `build` first. It then packages `out/` together with the
Electron runtime into installers in `dist/`, which takes about a minute per platform. Run `pnpm build` to check that
the app compiles, and `pnpm dist` only when you need installers.

### Cross-platform packaging

- **macOS `.dmg`** can only be built on macOS. It is signed ad hoc so it runs on Apple Silicon.
- **Windows `.exe`** builds natively on Windows. Building it on Linux or macOS requires [Wine](https://www.winehq.org/).
- **Linux `.deb` / AppImage** builds on Linux.

Because of these limits, release builds run in CI (see below), one runner per platform.
Real code signing (Apple Developer ID, Windows certificate) and notarization are not set up; see the
[electron-builder docs](https://www.electron.build/code-signing) when you need them.

## CI and releases

Two GitHub Actions workflows live in `.github/workflows/`:

- **`ci.yml`** runs on every push to `main` and every pull request. It checks formatting, lints, and runs `pnpm build`,
  which includes the type-check.
- **`release.yml`** builds the installers on Linux (`.AppImage`, `.deb`), Windows (`.exe`), and macOS (one `.dmg` each
  for Apple Silicon and Intel). Each installer is attached to the run as its own download.

To publish a release, push a version tag:

```sh
git tag v1.2.0
git push origin v1.2.0
```

The workflow takes the version from the tag, so you don't need to bump `package.json` first. It then creates a
GitHub release with the installers and generated release notes. Running the workflow by hand from the Actions tab
builds the installers without publishing anything.

## Project structure

```sh
src/
├── main/index.ts          # Main process: window creation, IPC handlers, app lifecycle
├── preload/
│   ├── index.ts           # Exposes a typed `window.api` via contextBridge
│   └── api.ts             # Shared `Api` type (used by preload and renderer)
└── renderer/
    ├── index.html         # Entry HTML with a strict Content-Security-Policy
    └── src/
        ├── main.ts        # Mounts the Svelte app
        ├── App.svelte
        ├── app.css        # Tailwind entry (`@import "tailwindcss"`)
        └── env.d.ts       # Global types (`window.api`)
electron.vite.config.ts    # Build config for main / preload / renderer
electron-builder.yml       # Packaging config (targets, fuses)
```

TypeScript is split into `tsconfig.node.json` (main and preload, with Node types) and `tsconfig.web.json` (renderer, DOM only). Node globals cannot leak into the UI code. Both extend `tsconfig.base.json`, which enables `strict` plus extra checks: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and others.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` on every window.
- The renderer can only reach the main process through the API exposed in `src/preload/index.ts`. Add new capabilities there as explicit functions and never expose `ipcRenderer` directly.
- A strict Content-Security-Policy in `index.html`.
- New windows are denied. `https:` links open in the system browser, and in-app navigation away from the app is blocked.
- A single-instance lock.
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) are flipped at package time: `RunAsNode` is disabled, `NODE_OPTIONS` and inspect flags are disabled, the app loads only from ASAR, ASAR integrity is validated, and cookies are encrypted.

## Adding an IPC call

1. Register a handler in `src/main/index.ts`: `ipcMain.handle("ns:action", (_e, arg) => ...)`.
2. Add the method to the `Api` interface in `src/preload/api.ts`.
3. Implement it in `src/preload/index.ts`: `action: (arg) => ipcRenderer.invoke("ns:action", arg)`.
4. Call `window.api.action(...)` from the renderer.

## App icon

Put `icon.png` (at least 512×512) in a `build/` directory at the project root. electron-builder generates the platform-specific icons from it. Until then, the default Electron icon is used.

## License

[MIT](./LICENSE)
