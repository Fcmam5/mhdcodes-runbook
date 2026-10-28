# Decisions

Deviations from SPEC.md, and why.

## Run scripts live in a `mkdtemp` folder, not `/tmp/runbook`

SPEC §6.3 originally put run scripts in `<os.tmpdir()>/runbook/<sessionId>/`. A fixed folder name in a shared `/tmp` is unsafe on multi-user machines. Another user can create `/tmp/runbook` first and then rename or swap our session folders inside it, which would let them change a script between the moment we write it and the moment bash sources it. `mkdtemp(<os.tmpdir()>/runbook-)` creates a fresh folder that only we can write to, once per app run. Session folders (0700) and scripts (0600) go inside it, and the whole folder is removed on quit.

## `@codemirror/commands` for editable cells

SPEC §3 lists CodeMirror 6 with its markdown and shell modes, but an editable CodeMirror needs `@codemirror/commands` too. It provides undo history and the standard keymap (Backspace and Delete by word, Home/End, selection moves); without it, cells couldn't be undone and many keys would do nothing. It is part of CodeMirror's own core packages, and like the rest of CodeMirror it is a devDependency, because the renderer bundles it.

## Dark only, no light mode

SPEC §9.4 asks the app to follow the system light/dark preference. It is dark only instead: one theme is enough for this app, and it halves the colours to keep in step across Tailwind classes, the markdown CSS, the xterm theme and the editor theme. `nativeTheme.themeSource` is set to `"dark"`, so native menus and dialogs match.

## `@lezer/highlight` for dark syntax colours

CodeMirror's `defaultHighlightStyle` uses dark colours meant for light backgrounds, which are hard to read on the app's dark one. A highlight style of our own needs the `tags` from `@lezer/highlight`. It is CodeMirror's own highlighting package and was already installed as a dependency of `@codemirror/language`; it is a devDependency because the renderer bundles it.

## The window's maximized state isn't remembered

SPEC §9.4 asks to remember the window's size and position; both are restored (the size it has when not maximized). Being maximized is not. On GNOME 46 under X11, the window manager often undoes a maximize sent just after the window is shown: Electron gets `maximize` and then `unmaximize` straight away, also in a bare Electron window. Retrying on `unmaximize` or waiting for the first `focus` still failed some of the time, and only an arbitrary delay helped. On Wayland, the position can't be set at all; the compositor places the window.
