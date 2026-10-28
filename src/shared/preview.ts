// The one-line preview the sidebar shows under a runbook's title: the first line of
// its prose, without markdown syntax. A runbook with only shell cells shows its first
// command; an empty one shows nothing. Pure: no Node or Electron imports.

import type { Cell } from "./types";

const PREVIEW_LENGTH = 120;

export function previewOf(cells: readonly Cell[]): string {
  const prose = cells.filter((cell) => cell.type === "markdown");
  for (const cell of prose) {
    const line = firstLine(stripMarkdown(cell.source));
    if (line !== "") return cut(line);
  }
  const shell = cells.find((cell) => cell.type === "shell" && firstLine(cell.source) !== "");
  return shell ? cut(firstLine(shell.source)) : "";
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const clean = line.replace(/\s+/g, " ").trim();
    if (clean !== "") return clean;
  }
  return "";
}

// Enough markdown to read naturally in one line: block markers, emphasis, inline code
// and links lose their syntax and keep their text.
function stripMarkdown(source: string): string {
  return source
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
        .replace(/^\s{0,3}([-*_]\s*){3,}$/, ""),
    )
    .join("\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function cut(line: string): string {
  return line.length <= PREVIEW_LENGTH ? line : `${line.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`;
}
