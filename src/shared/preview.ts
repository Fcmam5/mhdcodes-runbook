// The one-line preview the sidebar shows under a runbook's title: the first line of
// its prose, without markdown syntax. A runbook with only shell cells shows its first
// command; an empty one shows nothing. Pure: no Node or Electron imports.

import type { Cell } from "./types";

const PREVIEW_LENGTH = 120;

export function previewOf(cells: readonly Cell[]): string {
  for (const cell of cells) {
    if (cell.type !== "markdown") continue;
    const line = firstProseLine(cell.source);
    if (line !== "") return cut(line);
  }
  for (const cell of cells) {
    if (cell.type !== "shell") continue;
    const line = firstLine(cell.source);
    if (line !== "") return cut(line);
  }
  return "";
}

function collapse(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const clean = collapse(line);
    if (clean !== "") return clean;
  }
  return "";
}

// The first line with text, not counting fenced code: a markdown cell keeps the fences
// that aren't shell cells (```python), and those are code, not prose.
function firstProseLine(source: string): string {
  let fence: string | null = null; // the opening ``` or ~~~ while inside a block
  for (const line of source.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      const closes =
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker;
      if (closes) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    const clean = collapse(stripMarkdown(line));
    if (clean !== "") return clean;
  }
  return "";
}

// Enough markdown to read naturally in one line: block markers, emphasis, inline code
// and links lose their syntax and keep their text. Code spans go first, swapped for
// private-use markers and put back as written, so `rm *.tmp` or `__pycache__` aren't
// read as emphasis.
function stripMarkdown(line: string): string {
  const code: string[] = [];
  const text = line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
    .replace(/^\s{0,3}([-*_]\s*){3,}$/, "")
    .replace(/(`+)(.+?)(?<!`)\1(?!`)/g, (_span, _ticks, inner: string) => {
      code.push(inner.trim());
      return `\uE000${code.length - 1}\uE001`;
    })
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Emphasis hugs its text: "5 * 3 and 2 * 4" has none.
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=[^\s*_])([^*_]*?[^\s*_])[*_](?![\w*])/g, "$1$2")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1");
  return text.replace(/\uE000(\d+)\uE001/g, (_mark, index: string) => code[Number(index)] ?? "");
}

function cut(line: string): string {
  return line.length <= PREVIEW_LENGTH ? line : `${line.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`;
}
