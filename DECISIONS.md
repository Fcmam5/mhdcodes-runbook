# Decisions

Deviations from SPEC.md, and why.

## Run scripts live in a `mkdtemp` folder, not `/tmp/runbook`

SPEC §6.3 originally put run scripts in `<os.tmpdir()>/runbook/<sessionId>/`. A fixed folder name in a shared `/tmp` is unsafe on multi-user machines. Another user can create `/tmp/runbook` first and then rename or swap our session folders inside it, which would let them change a script between the moment we write it and the moment bash sources it. `mkdtemp(<os.tmpdir()>/runbook-)` creates a fresh folder that only we can write to, once per app run. Session folders (0700) and scripts (0600) go inside it, and the whole folder is removed on quit.

## `@codemirror/commands` for editable cells

SPEC §3 lists CodeMirror 6 with its markdown and shell modes, but an editable CodeMirror needs `@codemirror/commands` too. It provides undo history and the standard keymap (Backspace and Delete by word, Home/End, selection moves); without it, cells couldn't be undone and many keys would do nothing. It is part of CodeMirror's own core packages, and like the rest of CodeMirror it is a devDependency, because the renderer bundles it.
