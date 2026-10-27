import { describe, expect, it } from "vitest";
import { MarkerParser, type Piece } from "../src/main/shell/markers";

const READY = "\x1b]777;rb-ready\x07";
const START = "\x1b]777;rb-start;abcd1234\x07";
const DONE = "\x1b]777;rb-done;abcd1234;2\x07";

function parseAll(chunks: string[]): Piece[] {
  const parser = new MarkerParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
}

// Joins adjacent data pieces, since how data is split across pieces doesn't matter.
function normalize(pieces: Piece[]): Piece[] {
  const result: Piece[] = [];
  for (const piece of pieces) {
    const last = result.at(-1);
    if (piece.type === "data" && last?.type === "data") last.data += piece.data;
    else result.push(piece.type === "data" ? { ...piece } : piece);
  }
  return result;
}

const STREAM = `rc noise${READY}${START}hello\r\n${DONE}after`;
const EXPECTED: Piece[] = [
  { type: "data", data: "rc noise" },
  { type: "marker", marker: { type: "ready" } },
  { type: "marker", marker: { type: "start", runId: "abcd1234" } },
  { type: "data", data: "hello\r\n" },
  { type: "marker", marker: { type: "done", runId: "abcd1234", exitCode: 2 } },
  { type: "data", data: "after" },
];

describe("MarkerParser", () => {
  it("separates markers from data", () => {
    expect(parseAll([STREAM])).toEqual(EXPECTED);
  });

  it("handles markers split at every possible position", () => {
    for (let i = 1; i < STREAM.length; i++) {
      expect(normalize(parseAll([STREAM.slice(0, i), STREAM.slice(i)]))).toEqual(EXPECTED);
    }
  });

  it("handles a stream fed one character at a time", () => {
    expect(normalize(parseAll([...STREAM]))).toEqual(EXPECTED);
  });

  it("passes other escape sequences and OSC 777 payloads through", () => {
    const other = "\x1b]0;title\x07\x1b[31mred\x1b[0m\x1b]777;notify;Hi;there\x07";
    expect(normalize(parseAll([other]))).toEqual([{ type: "data", data: other }]);
  });

  it("passes malformed rb markers through", () => {
    const bad = "\x1b]777;rb-done;abc;x\x07\x1b]777;rb-start\x07";
    expect(normalize(parseAll([bad]))).toEqual([{ type: "data", data: bad }]);
  });

  it("holds back a lone ESC at the end until the next chunk", () => {
    const parser = new MarkerParser();
    expect(parser.push("text\x1b")).toEqual([{ type: "data", data: "text" }]);
    expect(parser.push("[0m")).toEqual([{ type: "data", data: "\x1b[0m" }]);
  });

  it("doesn't let another program's ST-terminated OSC 777 swallow the next marker", () => {
    const notify = "\x1b]777;notify;hi\x1b\\";
    expect(normalize(parseAll([`${notify}${DONE}`]))).toEqual([
      { type: "data", data: notify },
      { type: "marker", marker: { type: "done", runId: "abcd1234", exitCode: 2 } },
    ]);
  });

  it("doesn't let an unterminated OSC 777 swallow a marker in the next chunk", () => {
    expect(normalize(parseAll(["\x1b]777;cut", DONE]))).toEqual([
      { type: "data", data: "\x1b]777;cut" },
      { type: "marker", marker: { type: "done", runId: "abcd1234", exitCode: 2 } },
    ]);
  });

  it("returns held-back text on flush", () => {
    const parser = new MarkerParser();
    expect(parser.push("end\x1b]77")).toEqual([{ type: "data", data: "end" }]);
    expect(parser.flush()).toBe("\x1b]77");
    expect(parser.flush()).toBe("");
  });

  it("gives up on an unterminated OSC 777 that is too long to be a marker", () => {
    const long = `\x1b]777;${"x".repeat(200)}`;
    expect(normalize(parseAll([long]))).toEqual([{ type: "data", data: long }]);
  });
});
