import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCell, parse, serialize } from "../src/shared/runbook";
import type { Cell, Runbook } from "../src/shared/types";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixtureNames = readdirSync(FIXTURES).filter((name) => name.endsWith(".md"));

function load(name: string): { text: string; runbook: Runbook } {
  const text = readFileSync(join(FIXTURES, name), "utf8");
  return { text, runbook: parse(text, `/runbooks/${name}`) };
}

function yamlList(item: string): string {
  return `[${Array.from({ length: 20 }, () => item).join(", ")}]`;
}

function shellCells(runbook: Runbook): Cell[] {
  return runbook.cells.filter((cell) => cell.type === "shell");
}

describe("round trip", () => {
  it.each(fixtureNames)("%s is idempotent after the first save", (name) => {
    const { runbook } = load(name);
    const once = serialize(runbook);
    expect(serialize(parse(once, runbook.path))).toBe(once);
  });

  // Already-normalized files must be written back byte for byte.
  it.each([
    "no-frontmatter.md",
    "frontmatter-simple.md",
    "non-bash-blocks.md",
    "sh-shell-info.md",
    "crlf.md",
    "frontmatter-comments.md",
    "empty.md",
  ])("%s is unchanged by a save", (name) => {
    const { text, runbook } = load(name);
    expect(serialize(runbook)).toBe(text);
  });
});

describe("parse", () => {
  it("splits markdown and shell cells", () => {
    const { runbook } = load("no-frontmatter.md");
    expect(runbook.cells.map((cell) => [cell.type, cell.source])).toEqual([
      ["markdown", "Restart PipeWire first; this fixes it most of the time."],
      ["shell", "systemctl --user restart pipewire pipewire-pulse wireplumber"],
      ["markdown", "If that didn't work, check the sinks:"],
      ["shell", "pactl list short sinks"],
    ]);
    expect(shellCells(runbook).map((cell) => cell.id)).toEqual(["a1b2c3d4", "e5f6g7h8"]);
  });

  it("falls back to the filename for the title without frontmatter", () => {
    const { runbook } = load("no-frontmatter.md");
    expect(runbook.title).toBe("no-frontmatter");
    expect(runbook.tags).toEqual([]);
    expect(runbook.frontmatterRaw).toBeNull();
  });

  it("reads title and tags from frontmatter and keeps the raw YAML", () => {
    const { runbook } = load("frontmatter-simple.md");
    expect(runbook.title).toBe("Fix audio after kernel update");
    expect(runbook.tags).toEqual(["audio", "pipewire"]);
    expect(runbook.frontmatterRaw).toBe(
      "title: Fix audio after kernel update\ntags: [audio, pipewire]\nauthor: mhd",
    );
  });

  it("generates 8-character IDs for shell cells without one, and writes them on save", () => {
    const { runbook } = load("missing-ids.md");
    const ids = shellCells(runbook).map((cell) => cell.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^[\w-]{8}$/);
    expect(new Set(ids).size).toBe(2);

    const saved = serialize(runbook);
    for (const id of ids) expect(saved).toContain(`\`\`\`bash {id=${id}}`);
    expect(shellCells(parse(saved, runbook.path)).map((cell) => cell.id)).toEqual(ids);
  });

  it("keeps non-shell code blocks inside markdown cells", () => {
    const { runbook } = load("non-bash-blocks.md");
    expect(runbook.cells.map((cell) => cell.type)).toEqual(["markdown", "shell", "markdown"]);
    expect(runbook.cells[0]?.source).toContain('```python\nprint("not a shell cell")\n```');
    expect(runbook.cells[0]?.source).toContain("```\nplain block, no language\n```");
    expect(runbook.cells[2]?.source).toBe("```console\n$ not a shell cell either\n```");
  });

  it("accepts sh and shell fences and keeps extra info-string attributes", () => {
    const { runbook } = load("sh-shell-info.md");
    expect(shellCells(runbook).map((cell) => [cell.id, cell.info])).toEqual([
      ["aaaa1111", "sh"],
      ["bbbb2222", "shell title=x"],
      ["cccc3333", 'bash title="Check sinks"'],
    ]);
  });

  it("detects CRLF line endings and holds sources with LF", () => {
    const { runbook } = load("crlf.md");
    expect(runbook.lineEnding).toBe("\r\n");
    expect(runbook.title).toBe("Windows line endings");
    expect(runbook.cells.map((cell) => cell.source)).toEqual([
      "First paragraph.\nSecond line.",
      "echo one\necho two",
    ]);
  });

  it("trims blank lines around markdown cells and drops empty ones", () => {
    const { runbook } = load("messy-spacing.md");
    expect(runbook.cells.map((cell) => [cell.type, cell.source])).toEqual([
      ["markdown", "Intro text."],
      ["shell", "echo a"],
      ["shell", "echo b"],
      ["markdown", "outro, no trailing newline"],
    ]);
  });

  it("moves the id attribute out of the middle of the info string", () => {
    const { runbook } = load("messy-spacing.md");
    expect(runbook.cells[1]).toMatchObject({ id: "abcd1234", info: "bash title=x extra" });
    expect(serialize(runbook)).toContain("```bash title=x extra {id=abcd1234}\necho a\n```");
  });

  it("replaces duplicate IDs so every shell cell is unique", () => {
    const text = "```bash {id=same1234}\necho a\n```\n\n```bash {id=same1234}\necho b\n```\n";
    const [first, second] = shellCells(parse(text, "/runbooks/dup.md"));
    expect(first?.id).toBe("same1234");
    expect(second?.id).not.toBe("same1234");
  });

  it("keeps only the first ID when a fence has two id attributes", () => {
    const text = "```bash {id=aaaaaaaa} {id=bbbbbbbb}\necho\n```\n";
    const runbook = parse(text, "/runbooks/x.md");
    expect(runbook.cells[0]).toMatchObject({ id: "aaaaaaaa", info: "bash" });
    const saved = serialize(runbook);
    expect(saved).toBe("```bash {id=aaaaaaaa}\necho\n```\n");
    expect(serialize(parse(saved, runbook.path))).toBe(saved);
  });

  it("treats a leading horizontal rule as Markdown, not frontmatter", () => {
    const text = "---\n\n# Heading\n\nText\n\n---\n\nMore\n";
    const runbook = parse(text, "/runbooks/x.md");
    expect(runbook.frontmatterRaw).toBeNull();
    expect(runbook.cells.map((cell) => cell.source)).toEqual([text.trimEnd()]);
  });

  it("shows invalid YAML frontmatter as Markdown instead of hiding it", () => {
    const runbook = parse("---\ntitle: [oops\n---\n\nBody\n", "/runbooks/x.md");
    expect(runbook.frontmatterRaw).toBeNull();
    expect(runbook.cells[0]?.source).toContain("title: [oops");
  });

  // `d` would expand to 160,000 values if aliases were resolved.
  it("reads and edits frontmatter without expanding aliases", () => {
    const yaml = `title: Aliases\na: &a ${yamlList("x")}\nb: &b ${yamlList("*a")}\nc: &c ${yamlList("*b")}\nd: ${yamlList("*c")}`;
    const runbook = parse(`---\n${yaml}\n---\n\nBody\n`, "/runbooks/aliases.md");
    expect(runbook.title).toBe("Aliases");
    expect(runbook.frontmatterRaw).toBe(yaml);
    expect(runbook.cells.map((cell) => cell.source)).toEqual(["Body"]);

    runbook.title = "Renamed";
    expect(serialize(runbook)).toBe(
      `---\n${yaml.replace("title: Aliases", "title: Renamed")}\n---\n\nBody\n`,
    );
  });

  it("ignores an alias used as the title or a tag", () => {
    const text = "---\nname: &n Shared\ntitle: *n\ntags: [real, *n]\n---\n";
    const runbook = parse(text, "/runbooks/aliased.md");
    expect(runbook.title).toBe("aliased");
    expect(runbook.tags).toEqual(["real"]);
  });

  it("finds frontmatter after a UTF-8 BOM", () => {
    const runbook = parse("﻿---\ntitle: T\n---\n\nBody\n", "/runbooks/x.md");
    expect(runbook.title).toBe("T");
    expect(runbook.cells.map((cell) => cell.source)).toEqual(["Body"]);
  });

  it("keeps fences inside lists and blockquotes in the markdown cell", () => {
    const { runbook } = load("containers.md");
    expect(runbook.cells.map((cell) => cell.type)).toEqual([
      "markdown",
      "shell",
      "shell",
      "markdown",
    ]);
    expect(runbook.cells[0]?.source).toContain("   ```bash\n   sudo apt update\n   ```");
    expect(runbook.cells[0]?.source).toContain("> ```bash\n> rm -rf /tmp/cache\n> ```");
    expect(runbook.cells[3]?.source).toContain("    ```bash\n    echo indented four spaces");
  });

  it("accepts a top-level fence indented up to three spaces", () => {
    const { runbook } = load("containers.md");
    expect(shellCells(runbook).map((cell) => [cell.id, cell.source])).toEqual([
      ["top00001", "echo top level"],
      ["ind00003", "echo indented three spaces"],
    ]);
  });

  it("accepts ~~~ fences, longer fences and longer closing fences", () => {
    const { runbook } = load("nested-fences.md");
    expect(shellCells(runbook).map((cell) => [cell.id, cell.info, cell.source])).toEqual([
      ["nest0001", "bash", "cat > README.md <<'MD'\n```sh\nmake install\n```\nMD"],
      ["tild0001", "sh", "cat <<'MD'\n```\ninside\n```\nMD"],
      ["long0001", "bash", "echo closed by five"],
    ]);
  });

  it("gives an unclosed shell fence the rest of the file", () => {
    const { runbook } = load("unclosed-fence.md");
    expect(runbook.cells.at(-1)).toMatchObject({
      id: "open0001",
      type: "shell",
      source: "echo one\n\necho two",
    });
    expect(serialize(runbook).endsWith("echo two\n```\n")).toBe(true);
  });

  it("parses an empty file to an empty runbook", () => {
    const { runbook } = load("empty.md");
    expect(runbook).toMatchObject({ title: "empty", tags: [], frontmatterRaw: null, cells: [] });
  });

  it("reads a frontmatter-only file", () => {
    const text = "---\ntitle: Only metadata\n---\n";
    const runbook = parse(text, "/runbooks/x.md");
    expect(runbook).toMatchObject({ title: "Only metadata", cells: [] });
    expect(serialize(runbook)).toBe(text);
    expect(serialize(parse("---\n---\n", "/runbooks/x.md"))).toBe("---\n---\n");
  });

  it("reads frontmatter with comments and a block list", () => {
    const { runbook } = load("frontmatter-comments.md");
    expect(runbook.title).toBe("Restart networking");
    expect(runbook.tags).toEqual(["network", "systemd"]);
  });

  it("reads non-string scalars as written and a single scalar as one tag", () => {
    const runbook = parse("---\ntitle: 1.10\ntags: audio\n---\n", "/runbooks/x.md");
    expect(runbook.title).toBe("1.10");
    expect(runbook.tags).toEqual(["audio"]);
    expect(parse("---\ntags: [2024, true, ~]\n---\n", "/runbooks/x.md").tags).toEqual([
      "2024",
      "true",
    ]);
  });

  it("falls back to the filename for an empty title", () => {
    expect(parse("---\ntitle:\ntags:\n---\n", "/runbooks/x.md")).toMatchObject({
      title: "x",
      tags: [],
    });
  });

  it("detects LF when the file has no line break at all", () => {
    expect(parse("just text", "/runbooks/x.md").lineEnding).toBe("\n");
  });
});

describe("serialize", () => {
  it("separates cells with one blank line and ends with one line ending", () => {
    const { runbook } = load("messy-spacing.md");
    expect(serialize(runbook)).toBe(
      "Intro text.\n\n" +
        "```bash title=x extra {id=abcd1234}\necho a\n```\n\n" +
        "```bash {id=efgh5678}\necho b\n```\n\n" +
        "outro, no trailing newline\n",
    );
  });

  it("writes no frontmatter when the title matches the filename and nothing else is set", () => {
    const runbook = parse("Hello.\n", "/runbooks/hello.md");
    runbook.title = "hello";
    expect(serialize(runbook)).toBe("Hello.\n");
  });

  it("writes frontmatter when a file without one gets a title or tags", () => {
    const runbook = parse("Hello.\n", "/runbooks/hello.md");
    runbook.title = "Hello world";
    runbook.tags = ["a", "b"];
    expect(serialize(runbook)).toBe("---\ntitle: Hello world\ntags: [a, b]\n---\n\nHello.\n");
  });

  it("changes only the edited frontmatter entry and keeps other keys", () => {
    const { text, runbook } = load("frontmatter-simple.md");
    runbook.title = "Fix audio";
    expect(serialize(runbook)).toBe(
      text.replace("title: Fix audio after kernel update", "title: Fix audio"),
    );
  });

  it("rewrites only the tags entry when tags change", () => {
    const { text, runbook } = load("frontmatter-simple.md");
    runbook.tags = ["audio"];
    expect(serialize(runbook)).toBe(text.replace("tags: [audio, pipewire]", "tags: [audio]"));
  });

  it("keeps comments, quoting and key order when the title changes", () => {
    const { text, runbook } = load("frontmatter-comments.md");
    runbook.title = "Restart NetworkManager";
    expect(serialize(runbook)).toBe(
      text.replace('"Restart networking"', '"Restart NetworkManager"'),
    );
  });

  it("keeps a block tag list a block list when tags change", () => {
    const { text, runbook } = load("frontmatter-comments.md");
    runbook.tags = ["network"];
    expect(serialize(runbook)).toBe(text.replace("  - systemd\n", ""));
  });

  it("keeps a comment after a flow tag list when tags change", () => {
    const runbook = parse("---\ntags: [a] # why\n---\n", "/runbooks/x.md");
    runbook.tags = ["a", "b"];
    expect(serialize(runbook)).toBe("---\ntags: [a, b] # why\n---\n");
  });

  it("turns a single-scalar tag into a flow list when tags change", () => {
    const runbook = parse("---\ntags: audio\n---\n", "/runbooks/x.md");
    runbook.tags = ["audio", "pipewire"];
    expect(serialize(runbook)).toBe("---\ntags: [audio, pipewire]\n---\n");
  });

  it("quotes a new title that would otherwise read back as a number", () => {
    const runbook = parse("---\ntitle: 2024\n---\n", "/runbooks/x.md");
    runbook.title = "2025";
    const saved = serialize(runbook);
    expect(saved).toBe('---\ntitle: "2025"\n---\n');
    expect(parse(saved, runbook.path).title).toBe("2025");
  });

  it("writes ~~~ and backtick fences longer than any fence in the source", () => {
    const { runbook } = load("nested-fences.md");
    const saved = serialize(runbook);
    expect(saved).toContain("````bash {id=nest0001}\n");
    expect(saved).toContain("````sh {id=tild0001}\n");
    expect(saved).toContain("```bash {id=long0001}\necho closed by five\n```\n");
  });

  it("writes a ~~~ fence when the info string contains a backtick", () => {
    const text = "~~~bash title=`x` {id=abcdabcd}\necho\n~~~~\n";
    const saved = serialize(parse(text, "/runbooks/x.md"));
    expect(saved).toBe("~~~bash title=`x` {id=abcdabcd}\necho\n~~~\n");
    expect(shellCells(parse(saved, "/runbooks/x.md"))).toHaveLength(1);
  });

  it("writes new shell cells as bash", () => {
    const cell = createCell("shell", "ls");
    expect(cell.info).toBe("bash");
    expect(cell.id).toMatch(/^[\w-]{8}$/);
    const runbook = parse("", "/runbooks/new.md");
    runbook.cells.push(cell);
    expect(serialize(runbook)).toBe(`\`\`\`bash {id=${cell.id}}\nls\n\`\`\`\n`);
  });

  it("round-trips an empty shell cell", () => {
    const runbook = parse("", "/runbooks/new.md");
    runbook.cells.push(createCell("shell"));
    const saved = serialize(runbook);
    expect(parse(saved, runbook.path).cells).toEqual(runbook.cells);
  });

  it("uses CRLF for every line when the runbook does", () => {
    const { runbook } = load("crlf.md");
    runbook.cells.push(createCell("markdown", "Added\nlater"));
    const saved = serialize(runbook);
    expect(saved.replaceAll("\r\n", "")).not.toContain("\n");
    expect(saved.endsWith("later\r\n")).toBe(true);
  });

  it("serializes an empty runbook to an empty string", () => {
    expect(serialize(parse("", "/runbooks/empty.md"))).toBe("");
  });
});
