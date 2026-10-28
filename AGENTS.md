# Agent skills

## Issue tracker: Local Markdown

Issues and specs live as local markdown files under `.github/issues/`.

### Conventions

- One feature per directory: `.github/issues/`
- The spec is `SPEC.md` or `.github/issues/spec.md`
- Implementation issues are one file per ticket at `.github/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- State is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

### When a skill says "publish to the issue tracker"

Create a new file under `.github/issues/` (creating the directory if needed).

### When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Domain docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Before exploring, read **`CONTEXT.md`** at the repo root

### Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).
