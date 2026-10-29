import { describe, expect, it } from "vitest";
import { aroundMatch, highlight } from "../src/renderer/src/state/highlight";

describe("highlight", () => {
  it("marks every word the search matched, ignoring case", () => {
    expect(highlight("Restart PipeWire first", ["pipewire"])).toEqual([
      { text: "Restart ", match: false },
      { text: "PipeWire", match: true },
      { text: " first", match: false },
    ]);
  });

  it("marks whole words only, for each term", () => {
    expect(highlight("apt install pipewire-audio wireplumber", ["audio", "wireplumber"])).toEqual([
      { text: "apt install pipewire-", match: false },
      { text: "audio", match: true },
      { text: " ", match: false },
      { text: "wireplumber", match: true },
    ]);
    expect(highlight("wireplumber", ["wire"])).toEqual([{ text: "wireplumber", match: false }]);
  });

  it("matches a term with symbols by its letters", () => {
    expect(highlight("echo $HOME", ["$home"])).toEqual([
      { text: "echo $", match: false },
      { text: "HOME", match: true },
    ]);
  });

  it("keeps combining marks inside their word", () => {
    expect(highlight("नमस्ते दुनिया", ["नमस्ते"])).toEqual([
      { text: "नमस्ते", match: true },
      { text: " दुनिया", match: false },
    ]);
  });

  it("joins neighbouring matches", () => {
    expect(highlight("sink sink!", ["sink"])).toEqual([
      { text: "sink", match: true },
      { text: " ", match: false },
      { text: "sink", match: true },
      { text: "!", match: false },
    ]);
  });

  it("returns the text unmarked without terms, and nothing for no text", () => {
    expect(highlight("Welcome", [])).toEqual([{ text: "Welcome", match: false }]);
    expect(highlight("", ["x"])).toEqual([]);
  });
});

describe("aroundMatch", () => {
  it("starts a little before the first match, at a word, with an ellipsis", () => {
    expect(
      aroundMatch("…ernel update the sound sometimes disappears. Restart PipeWire first;", [
        "pipewire",
      ]),
    ).toBe("…Restart PipeWire first;");
  });

  it("leaves the text alone when the match is already near the start, or missing", () => {
    expect(aroundMatch("Restart PipeWire first", ["pipewire"])).toBe("Restart PipeWire first");
    expect(aroundMatch("No match here", ["pipewire"])).toBe("No match here");
  });

  it("cuts at the match itself when no word starts within reach", () => {
    expect(aroundMatch("aaaaaaaaaaaaaaaaaaaaaaaa pipewire", ["pipewire"])).toBe("…pipewire");
  });
});
