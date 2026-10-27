// Splits pty output into plain data and the OSC 777 markers the rcfile prints
// (`ESC ] 777 ; rb-… BEL`, SPEC §6.3). Markers can arrive split across chunks, so an
// incomplete one at the end of a chunk is held back until the rest arrives.

export type Marker =
  | { type: "ready" }
  | { type: "start"; runId: string }
  | { type: "done"; runId: string; exitCode: number };

export type Piece = { type: "data"; data: string } | { type: "marker"; marker: Marker };

const ESC = "\x1b";
const PREFIX = `${ESC}]777;`;
const BEL = "\x07";
// Longer than any of our markers. An unterminated OSC 777 longer than this isn't
// ours, so it is passed through instead of being held back forever.
const MAX_MARKER_LENGTH = 128;

export class MarkerParser {
  private carry = "";

  push(chunk: string): Piece[] {
    const text = this.carry + chunk;
    this.carry = "";
    const pieces: Piece[] = [];
    const pushData = (data: string): void => {
      if (data !== "") pieces.push({ type: "data", data });
    };

    let emitted = 0;
    let searchFrom = 0;
    let end = text.length;
    for (;;) {
      const start = text.indexOf(PREFIX, searchFrom);
      if (start === -1) break;
      const close = findTerminator(text, start + PREFIX.length);
      if (close === -1) {
        if (text.length - start <= MAX_MARKER_LENGTH) end = start;
        break;
      }
      // Our markers end in BEL. An ESC first means another program's sequence (ended
      // by ST `ESC \`, or cut off), which must not swallow a marker that follows it.
      if (text[close] === ESC) {
        searchFrom = close;
        continue;
      }
      // Other programs may use OSC 777 too; only our markers are taken out.
      const marker = parseMarker(text.slice(start + PREFIX.length, close));
      if (marker) {
        pushData(text.slice(emitted, start));
        pieces.push({ type: "marker", marker });
        emitted = close + 1;
      }
      searchFrom = close + 1;
    }

    if (end === text.length) end -= partialPrefixLength(text, emitted);
    pushData(text.slice(emitted, end));
    this.carry = text.slice(end);
    return pieces;
  }

  // Returns whatever is still held back, as plain data. For when the stream ends.
  flush(): string {
    const rest = this.carry;
    this.carry = "";
    return rest;
  }
}

function findTerminator(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === BEL || text[i] === ESC) return i;
  }
  return -1;
}

// How many characters at the end of text (after `from`) could start a marker.
function partialPrefixLength(text: string, from: number): number {
  for (let length = Math.min(PREFIX.length - 1, text.length - from); length > 0; length--) {
    if (text.endsWith(PREFIX.slice(0, length))) return length;
  }
  return 0;
}

function parseMarker(payload: string): Marker | null {
  const [name, ...args] = payload.split(";");
  if (name === "rb-ready" && args.length === 0) return { type: "ready" };
  const [runId, code] = args;
  if (name === "rb-start" && args.length === 1 && runId) return { type: "start", runId };
  if (name === "rb-done" && args.length === 2 && runId && code && /^\d+$/.test(code)) {
    return { type: "done", runId, exitCode: Number(code) };
  }
  return null;
}
