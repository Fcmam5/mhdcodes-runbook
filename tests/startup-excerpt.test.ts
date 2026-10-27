import { describe, expect, it } from "vitest";
import { startupExcerpt } from "../src/shared/startup-excerpt";

describe("startupExcerpt", () => {
  it("keeps the first lines as plain text", () => {
    const output = "\r\n\x1b[1;31mError:\x1b[0m bad\r\n\x1b]0;title\x07line 2\r\n\r\n";
    expect(startupExcerpt(output)).toBe("Error: bad\nline 2");
  });

  it("stops after the line limit", () => {
    const output = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(startupExcerpt(output, 3)).toBe("line 1\nline 2\nline 3");
  });

  it("shows what a carriage return left on the line", () => {
    expect(startupExcerpt("loading 10%\rloading 99%\rready\n")).toBe("ready");
  });

  it("is empty when nothing was printed", () => {
    expect(startupExcerpt("")).toBe("");
    expect(startupExcerpt("\x1b[?2004h\r\n  \n")).toBe("");
  });
});
