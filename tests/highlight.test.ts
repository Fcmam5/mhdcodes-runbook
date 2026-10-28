import { describe, expect, it } from "vitest";
import { aroundMatch, highlight } from "../src/renderer/src/state/highlight";

describe("highlight", () => {
  it("marks every word that starts with a query word, ignoring case", () => {
    expect(highlight("Restart PipeWire first", "pipew")).toEqual([
      { text: "Restart ", match: false },
      { text: "PipeWire", match: true },
      { text: " first", match: false },
    ]);
  });

  it("marks words for each query word, and only at the start of a word", () => {
    expect(highlight("apt install pipewire-audio wireplumber", "wire audio")).toEqual([
      { text: "apt install pipewire-", match: false },
      { text: "audio", match: true },
      { text: " ", match: false },
      { text: "wireplumber", match: true },
    ]);
  });

  it("joins neighbouring matches", () => {
    expect(highlight("sink sink!", "sink")).toEqual([
      { text: "sink", match: true },
      { text: " ", match: false },
      { text: "sink", match: true },
      { text: "!", match: false },
    ]);
  });

  it("returns the text unmarked for an empty query, and nothing for no text", () => {
    expect(highlight("Welcome", "  ")).toEqual([{ text: "Welcome", match: false }]);
    expect(highlight("", "x")).toEqual([]);
  });
});

describe("aroundMatch", () => {
  it("starts a little before the first match, at a word, with an ellipsis", () => {
    expect(
      aroundMatch("…ernel update the sound sometimes disappears. Restart PipeWire first;", "pipew"),
    ).toBe("…Restart PipeWire first;");
  });

  it("leaves the text alone when the match is already near the start, or missing", () => {
    expect(aroundMatch("Restart PipeWire first", "pipewire")).toBe("Restart PipeWire first");
    expect(aroundMatch("No match here", "pipewire")).toBe("No match here");
  });

  it("cuts at the match itself when no word starts within reach", () => {
    expect(aroundMatch("aaaaaaaaaaaaaaaaaaaaaaaa pipewire", "pipe")).toBe("…pipewire");
  });
});
