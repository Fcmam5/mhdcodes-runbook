import { describe, expect, it } from "vitest";
import { treeOf } from "../src/main/shell/process-tree";

// pid ppid pgid, as `ps -A -o pid=,ppid=,pgid=` prints them.
const TABLE = `
    1     0     1
  500     1   500
  900   500   500
 1000   900  1000
 1001  1000  1001
 1002  1001  1001
 1003  1002  1001
 1100  1000  1000
 2000     1  1001
`;

describe("treeOf", () => {
  it("finds every descendant of the root and their process groups", () => {
    expect(treeOf(1000, TABLE, 500)).toEqual({
      pids: [1001, 1100, 1002, 1003],
      groups: [1001, 1000],
    });
  });

  it("never signals the caller's own process group, nor the caller", () => {
    // The caller (900) is the root's parent here; a child in its group is skipped as a group.
    expect(treeOf(500, TABLE, 900).groups).not.toContain(500);
    expect(treeOf(500, TABLE, 900).pids).not.toContain(900);
  });

  it("returns nothing for a root without children, and skips lines it can't read", () => {
    expect(treeOf(1003, `${TABLE}\n garbage line\n`, 500)).toEqual({ pids: [], groups: [] });
  });
});
