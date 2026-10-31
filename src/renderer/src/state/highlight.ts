// Marks the words in a search snippet that the search matched, for the sidebar. The
// terms come with each result: the indexed words it matched, so a prefix
// ("pipew") or a typo ("pipwire") marks the word it found ("pipewire"). Pure.

export interface Part {
  text: string;
  match: boolean;
}

// Words as the sidebar splits them: letters (with their combining marks) and numbers.
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

// The index keeps symbols inside a term ("$home", "c++"); a snippet word is only the
// letters and numbers, so compare those.
function wordsOf(terms: readonly string[]): Set<string> {
  return new Set(terms.flatMap((term) => term.toLowerCase().match(WORD) ?? []));
}

// A snippet shortened so its first match is near the start: the sidebar shows only
// its first few dozen characters. It starts at a word up to `before` characters ahead
// of the match, marked with "…" where text was cut.
export function aroundMatch(text: string, terms: readonly string[], before = 12): string {
  const words = wordsOf(terms);
  for (const word of text.matchAll(WORD)) {
    const at = word.index;
    if (!words.has(word[0].toLowerCase())) continue;
    if (at <= before + 1) return text;
    const cut = text.slice(at - before).search(/(?<=\s)\S/u);
    const start = cut === -1 || cut >= before ? at : at - before + cut;
    return `…${text.slice(start).replace(/^…/, "")}`;
  }
  return text;
}

export function highlight(text: string, terms: readonly string[]): Part[] {
  const words = wordsOf(terms);
  if (words.size === 0 || text === "") return text === "" ? [] : [{ text, match: false }];

  const parts: Part[] = [];
  const push = (piece: string, match: boolean): void => {
    if (piece === "") return;
    const last = parts.at(-1);
    if (last && last.match === match) last.text += piece;
    else parts.push({ text: piece, match });
  };
  // Words and the separators between them, in order.
  for (const [piece, word] of text.matchAll(/([\p{L}\p{M}\p{N}]+)|[^\p{L}\p{M}\p{N}]+/gu)) {
    push(piece, word !== undefined && words.has(word.toLowerCase()));
  }
  return parts;
}
