// Marks the words in a search snippet that the query matched, for the sidebar (SPEC
// §9.2). Search matches query words as prefixes of indexed words ("pipew" finds
// "pipewire"), so a word is marked when it starts with one of the query's words. Pure.

export interface Part {
  text: string;
  match: boolean;
}

function termsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term !== "");
}

// A snippet shortened so its first match is near the start: the sidebar shows only
// its first few dozen characters. It starts at a word up to `before` characters ahead
// of the match, marked with "…" where text was cut.
export function aroundMatch(text: string, query: string, before = 12): string {
  const terms = termsOf(query);
  for (const word of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const at = word.index;
    if (!terms.some((term) => word[0].toLowerCase().startsWith(term))) continue;
    if (at <= before + 1) return text;
    const cut = text.slice(at - before).search(/(?<=\s)\S/u);
    const start = cut === -1 || cut >= before ? at : at - before + cut;
    return `…${text.slice(start).replace(/^…/, "")}`;
  }
  return text;
}

export function highlight(text: string, query: string): Part[] {
  const terms = termsOf(query);
  if (terms.length === 0 || text === "") return text === "" ? [] : [{ text, match: false }];

  const parts: Part[] = [];
  const push = (piece: string, match: boolean): void => {
    if (piece === "") return;
    const last = parts.at(-1);
    if (last && last.match === match) last.text += piece;
    else parts.push({ text: piece, match });
  };
  // Words and the separators between them, in order.
  for (const [piece, word] of text.matchAll(/([\p{L}\p{N}]+)|[^\p{L}\p{N}]+/gu)) {
    const match = word !== undefined && terms.some((term) => word.toLowerCase().startsWith(term));
    push(piece, match);
  }
  return parts;
}
