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

  it("keeps inline code as written", () => {
    expect(previewOf([md("Clean up with `rm *.tmp` and `ls *.log`")])).toBe(
      "Clean up with rm *.tmp and ls *.log",
    );
    expect(previewOf([md("Set `__pycache__` aside")])).toBe("Set __pycache__ aside");
    expect(previewOf([md("Run ``echo `date` `` now")])).toBe("Run echo `date` now");
  });

  it("reads asterisks with spaces around them as text, not emphasis", () => {
    expect(previewOf([md("Price is 5 * 3 and 2 * 4")])).toBe("Price is 5 * 3 and 2 * 4");
    expect(previewOf([md("a ** b ** c, but *this* and __that__")])).toBe(
      "a ** b ** c, but this and that",
    );
  });

  it("skips fenced code, which isn't prose", () => {
    expect(previewOf([md("```python\nprint(1)\n```\nThen the prose.")])).toBe("Then the prose.");
    expect(previewOf([md("~~~~\n```\nstill code\n~~~~\nOut")])).toBe("Out");
    expect(previewOf([md("```js\nconsole.log(1)\n```"), sh("node app.js")])).toBe("node app.js");
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
