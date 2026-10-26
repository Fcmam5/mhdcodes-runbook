import MarkdownIt from "markdown-it";

// html: false escapes raw HTML, so rendered cells can be inserted with {@html}.
// markdown-it also drops javascript:, vbscript: and file: link targets.
const markdown = new MarkdownIt({ html: false });

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
