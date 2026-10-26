import { describe, expect, it } from "vitest";
import { externalUrl } from "../src/shared/links";

describe("externalUrl", () => {
  it.each(["https://example.com/a?b#c", "http://localhost:8080/"])("allows %s", (href) => {
    expect(externalUrl(href)).toBe(href);
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "mailto:a@b.c",
    "other.md",
    "./other.md",
    "/etc/passwd",
    "//example.com",
    "#heading",
    "",
    null,
    undefined,
  ])("ignores %j", (href) => {
    expect(externalUrl(href)).toBeNull();
  });
});
