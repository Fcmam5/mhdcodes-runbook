// Full-text search over the notebooks (SPEC §9.2): an in-memory minisearch index of
// each notebook's title, tags and cell sources, kept current by the IPC handlers as
// notebooks are saved, created, renamed and deleted. No Electron imports.

import MiniSearch from "minisearch";
import type { Notebook, SearchResult } from "../shared/types";
import { listNotebooks, readNotebook } from "./notebooks";

const SNIPPET_LENGTH = 100;
const MAX_RESULTS = 50;

interface Indexed {
  id: string; // the notebook's path
  title: string;
  tags: string;
  text: string; // every cell's source, one after another
}

export class NotebookIndex {
  private readonly index = new MiniSearch<Indexed>({
    fields: ["title", "tags", "text"],
    storeFields: ["title", "text"],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      // Results update as you type: "pipew" finds "pipewire".
      prefix: true,
      fuzzy: 0.2,
      // Every word must match, as in most search boxes.
      combineWith: "AND",
    },
  });
  private loaded: Promise<void> | null = null;
  // Paths the handlers touched while loading: what the loader read may be older.
  private readonly touched = new Set<string>();

  constructor(private readonly dir: string) {}

  // Indexes every notebook in the folder, once, before the first search.
  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const summaries = await listNotebooks(this.dir).catch(() => []);
      const notebooks = await Promise.all(
        summaries.map((summary) => readNotebook(this.dir, summary.path).catch(() => null)),
      );
      for (const notebook of notebooks) {
        if (notebook && !this.touched.has(notebook.path)) this.put(notebook);
      }
      this.touched.clear();
    })();
    return this.loaded;
  }

  async search(query: string): Promise<SearchResult[]> {
    if (query.trim() === "") return [];
    await this.load();
    return this.index
      .search(query)
      .slice(0, MAX_RESULTS)
      .map((hit) => ({
        path: hit.id as string,
        title: hit["title"] as string,
        snippet: snippetFor(hit["text"] as string, hit.terms),
      }));
  }

  // Adds or replaces a notebook, e.g. after a save.
  update(notebook: Notebook): void {
    this.touched.add(notebook.path);
    this.put(notebook);
  }

  remove(path: string): void {
    this.touched.add(path);
    if (this.index.has(path)) this.index.discard(path);
  }

  rename(from: string, notebook: Notebook): void {
    this.remove(from);
    this.update(notebook);
  }

  private put(notebook: Notebook): void {
    const document: Indexed = {
      id: notebook.path,
      title: notebook.title,
      tags: notebook.tags.join(" "),
      text: notebook.cells.map((cell) => cell.source).join("\n"),
    };
    if (this.index.has(document.id)) this.index.replace(document);
    else this.index.add(document);
  }
}

// One line of `text` around the first of `terms` it contains (matched words, as the
// index has them: lowercase), cut to about 100 characters with … where it was cut.
// When none appears (only the title or tags matched), the first line with text.
export function snippetFor(text: string, terms: string[], length = SNIPPET_LENGTH): string {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim());
  // Terms are whole indexed words, so only match at the start of a word: "a" must not
  // match inside "match".
  const patterns = terms
    .filter((term) => term !== "")
    .map((term) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}`, "iu"));
  for (const line of lines) {
    const at = Math.min(
      ...patterns.map((pattern) => line.search(pattern)).filter((index) => index !== -1),
    );
    if (Number.isFinite(at)) return around(line, at, length);
  }
  return around(lines.find((line) => line !== "") ?? "", 0, length);
}

// `length` characters of `line`, starting a little before `at` so the match has some
// context on the left.
function around(line: string, at: number, length: number): string {
  if (line.length <= length) return line;
  const start = Math.max(0, Math.min(at - Math.floor(length / 4), line.length - length));
  const end = start + length;
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
