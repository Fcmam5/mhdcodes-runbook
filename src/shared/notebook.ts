// Converts between a notebook's Markdown text and a `Notebook` (SPEC §5).
// Pure: no Node or Electron imports, so it runs in main, renderer and tests alike.

import MarkdownIt from "markdown-it";
import { nanoid } from "nanoid";
import { Document, isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import type { Scalar } from "yaml";
import type { Cell, CellType, Notebook } from "./types";

const SHELL_LANGUAGES = new Set(["bash", "sh", "shell"]);
const DEFAULT_SHELL_INFO = "bash";
const ID_ATTRIBUTE = /\s*\{id=([^\s}]+)\}\s*/g;
const FRONTMATTER = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;
// Keep edited frontmatter close to how people write it: `tags: [a, b]` rather than
// yaml's default `[ a, b ]`, and long lines left as they are instead of re-wrapped at 80.
const YAML_OPTIONS = { flowCollectionPadding: false, lineWidth: 0 };

const markdown = new MarkdownIt({ html: false });

export function newCellId(): string {
  return nanoid(8);
}

export function createCell(type: CellType, source = ""): Cell {
  return type === "shell"
    ? { id: newCellId(), type, source, info: DEFAULT_SHELL_INFO }
    : { id: newCellId(), type, source };
}

export function parse(text: string, path: string): Notebook {
  const firstBreak = text.indexOf("\n");
  const lineEnding = firstBreak > 0 && text[firstBreak - 1] === "\r" ? "\r\n" : "\n";
  // Lone CRs are normalized too, so our line numbers match markdown-it's.
  // A BOM would hide the frontmatter; it is not written back.
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  // Only a YAML map (or an empty block) counts as frontmatter. Anything else, e.g. a
  // leading `---` horizontal rule or broken YAML, stays visible as Markdown.
  const match = FRONTMATTER.exec(normalized);
  const doc = match ? parseFrontmatter(match[1] ?? "") : null;
  const isFrontmatter = match !== null && doc !== null;
  const frontmatterRaw = isFrontmatter ? (match[1] ?? "") : null;
  const body = isFrontmatter ? normalized.slice(match[0].length) : normalized;
  const fields = readFrontmatter(doc, path);

  return {
    path,
    title: fields.title,
    tags: fields.tags,
    frontmatterRaw,
    lineEnding,
    cells: parseCells(body),
  };
}

export function serialize(notebook: Notebook): string {
  const blocks: string[] = [];

  const frontmatter = serializeFrontmatter(notebook);
  if (frontmatter !== null) {
    blocks.push(frontmatter === "" ? "---\n---" : `---\n${frontmatter}\n---`);
  }
  for (const cell of notebook.cells) {
    blocks.push(cell.type === "shell" ? serializeShellCell(cell) : cell.source);
  }
  if (blocks.length === 0) return "";

  const text = `${blocks.join("\n\n")}\n`;
  return notebook.lineEnding === "\n" ? text : text.replaceAll("\n", notebook.lineEnding);
}

// --- Cells -------------------------------------------------------------------

function parseCells(body: string): Cell[] {
  const lines = body.split("\n");
  const cells: Cell[] = [];
  const seenIds = new Set<string>();
  let markdownStart = 0;

  const pushMarkdown = (end: number): void => {
    const chunk = trimBlankLines(lines.slice(markdownStart, end));
    if (chunk.length > 0)
      cells.push({ id: newCellId(), type: "markdown", source: chunk.join("\n") });
  };

  for (const token of markdown.parse(body, {})) {
    // level > 0 means the fence sits inside a list item or blockquote.
    if (token.type !== "fence" || token.level !== 0 || !token.map) continue;
    const [start, end] = token.map;

    // Read the info string from the raw line: token.info has escapes resolved.
    const openingLine = lines[start] ?? "";
    const rawInfo = openingLine.trimStart().slice(token.markup.length).trim();
    const { id, info } = splitInfo(rawInfo);
    if (!SHELL_LANGUAGES.has(info.split(/\s/)[0] ?? "")) continue;

    pushMarkdown(start);
    // Duplicate IDs (e.g. a copy-pasted cell) would mix up run output, so replace them.
    const cellId = id !== null && !seenIds.has(id) ? id : newCellId();
    seenIds.add(cellId);
    cells.push({ id: cellId, type: "shell", source: token.content.replace(/\n$/, ""), info });
    markdownStart = end;
  }
  pushMarkdown(lines.length);

  return cells;
}

// Removes every {id=…} attribute (keeping the first ID) so a stray second one can't
// take over the ID on the next save.
function splitInfo(rawInfo: string): { id: string | null; info: string } {
  const [first] = rawInfo.matchAll(ID_ATTRIBUTE);
  if (!first) return { id: null, info: rawInfo };
  return { id: first[1] ?? null, info: rawInfo.replace(ID_ATTRIBUTE, " ").trim() };
}

function isBlank(line: string | undefined): boolean {
  return (line ?? "").trim() === "";
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start])) start++;
  while (end > start && isBlank(lines[end - 1])) end--;
  return lines.slice(start, end);
}

function serializeShellCell(cell: Cell): string {
  const info = cell.info ?? DEFAULT_SHELL_INFO;
  const fence = fenceFor(cell.source, info);
  const opening = `${fence}${info} {id=${cell.id}}`;
  return cell.source === "" ? `${opening}\n${fence}` : `${opening}\n${cell.source}\n${fence}`;
}

// A fence longer than any fence of the same character inside the source, so the source
// can't close it early. Backticks unless the info string has one, which only ~~~ allows.
function fenceFor(source: string, info: string): string {
  const char = info.includes("`") ? "~" : "`";
  let length = 3;
  for (const line of source.split("\n")) {
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (run?.startsWith(char)) length = Math.max(length, run.length + 1);
  }
  return char.repeat(length);
}

// --- Frontmatter -------------------------------------------------------------

interface FrontmatterFields {
  title: string;
  tags: string[];
}

// The parsed frontmatter, or null unless it is a valid YAML map (or empty).
function parseFrontmatter(raw: string): Document.Parsed | null {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return null;
  return doc.contents === null || isMap(doc.contents) ? doc : null;
}

// Reads title and tags straight from the document's nodes instead of converting it
// with toJS(), so aliases are never expanded (a few nested aliases can expand to
// millions of values). An alias used as the title or a tag is ignored. Other keys
// aren't read: they stay in frontmatterRaw and survive saves untouched.
// Non-string scalars are read as written (`title: 2024`), and a single scalar
// counts as one tag (`tags: audio`).
function readFrontmatter(doc: Document | null, path: string): FrontmatterFields {
  const fields: FrontmatterFields = { title: fileStem(path), tags: [] };
  if (doc === null) return fields;

  const title = doc.get("title", true);
  if (isText(title)) fields.title = scalarText(title);
  const tags = doc.get("tags", true);
  if (isSeq(tags)) fields.tags = tags.items.filter(isText).map(scalarText);
  else if (isText(tags)) fields.tags = [scalarText(tags)];
  return fields;
}

function isText(node: unknown): node is Scalar {
  return isScalar(node) && node.value !== null && typeof node.value !== "object";
}

// The scalar as written, so `version: 1.10` stays "1.10" rather than becoming 1.1.
function scalarText(node: Scalar): string {
  return typeof node.value === "string" ? node.value : (node.source ?? String(node.value));
}

// Returns the YAML text between the --- lines, or null when no frontmatter should be written.
function serializeFrontmatter(notebook: Notebook): string | null {
  const { frontmatterRaw: raw, title, tags } = notebook;

  if (raw === null) {
    if (title === fileStem(notebook.path) && tags.length === 0) return null;
    const doc = new Document({ title, tags });
    const tagsNode = doc.get("tags", true);
    if (isSeq(tagsNode)) tagsNode.flow = true;
    return doc.toString(YAML_OPTIONS).replace(/\n$/, "");
  }

  const doc = parseFrontmatter(raw);
  if (doc === null) return raw;
  const original = readFrontmatter(doc, notebook.path);
  const titleChanged = title !== original.title;
  const tagsChanged =
    tags.length !== original.tags.length || tags.some((tag, i) => tag !== original.tags[i]);
  if (!titleChanged && !tagsChanged) return raw;

  // Edit the document in place so comments, key order, styles and other keys survive.
  if (titleChanged) doc.set("title", title);
  if (tagsChanged) {
    // Keep a block list a block list; a missing or single-scalar entry becomes `[a, b]`.
    const previous = doc.get("tags", true);
    const next = doc.createNode(tags, { flow: !isSeq(previous) || previous.flow === true });
    if (isNode(previous)) {
      next.commentBefore = previous.commentBefore ?? null;
      next.comment = previous.comment ?? null;
    }
    doc.set("tags", next);
  }
  return doc.toString(YAML_OPTIONS).replace(/\n$/, "");
}

// --- Helpers -----------------------------------------------------------------

function fileStem(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}
