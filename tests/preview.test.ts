import { describe, expect, it } from "vitest";
import { previewOf } from "../src/shared/preview";
import type { Cell } from "../src/shared/types";

const md = (source: string): Cell => ({ id: source.slice(0, 8), type: "markdown", source });
const sh = (source: string): Cell => ({
  id: source.slice(0, 8),
  type: "shell",
  source,
  info: "bash",
});

describe("previewOf", () => {
  it("is the first line of the first markdown cell", () => {
    expect(previewOf([md("Restart PipeWire first.\nThen check the sink."), sh("ls")])).toBe(
      "Restart PipeWire first.",
    );
  });

  it("drops markdown syntax and keeps the text", () => {
    expect(previewOf([md("## Check the **default** sink")])).toBe("Check the default sink");
    expect(previewOf([md("- See [the docs](https://example.com) for `wpctl`")])).toBe(
      "See the docs for wpctl",
    );
    expect(previewOf([md("> _Muted_ at 0.00?")])).toBe("Muted at 0.00?");
    expect(previewOf([md("1. Stop the app")])).toBe("Stop the app");
  });

  it("keeps underscores and asterisks inside words", () => {
    expect(previewOf([md("Update authorized_keys and snd_pcm_avail")])).toBe(
      "Update authorized_keys and snd_pcm_avail",
    );
  });

  it("skips blank lines and horizontal rules", () => {
    expect(previewOf([md("\n---\n\n  Watch the log  ")])).toBe("Watch the log");
  });

  it("falls back to the first command, then to nothing", () => {
    expect(previewOf([sh("\nsystemctl --user restart pipewire")])).toBe(
      "systemctl --user restart pipewire",
    );
    expect(previewOf([md("   "), sh("")])).toBe("");
    expect(previewOf([])).toBe("");
  });

  it("cuts long lines with an ellipsis", () => {
    const preview = previewOf([md("word ".repeat(60))]);
    expect(preview.length).toBe(120);
    expect(preview.endsWith("…")).toBe(true);
  });
});
