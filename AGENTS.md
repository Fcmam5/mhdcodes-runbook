# Agent skills

## Issue tracker: Local Markdown

Issues and specs live as local markdown files under `.github/issues/`.

### Conventions

- All issues live directly in `.github/issues/`, one directory for the whole project
- Implementation issues are one file per ticket at `.github/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Every issue file starts with its title and a header block, exactly in this shape (plain lines, no bold), so one command can read them all:

  ```txt
  # 18: Short title

  Status: open
  Blocked by: 06, 12

  **What to build:** …
  ```

  `Status:` is one of `open`, `in-progress`, `blocked`, `done`, `wontfix`. `Blocked by:` lists issue numbers separated by commas, or `none`. Update `Status:` in place as work moves on.

- Comments and conversation history append to the bottom of the file under a `## Comments` heading

### Seeing what's open

Run `.github/issues/board.sh` for one line per issue: number, status, title and what it still waits on. An open issue whose blockers aren't all done shows as `waiting`. Pass a status to filter (`board.sh open`), or `ready` for open issues with nothing left to wait on. Use it instead of opening files one by one; a `?` status means a file's header block is malformed.

### When a skill says "publish to the issue tracker"

Create a new file under `.github/issues/` (creating the directory if needed), numbered one past the highest existing number, with the header block above.

### When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Domain docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Before exploring, read **`CONTEXT.md`** at the repo root

### Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).
