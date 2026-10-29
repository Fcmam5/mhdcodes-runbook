import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorState, Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Attachment } from "svelte/attachments";

export interface EditorOptions {
  initial: string; // the document the editor starts with; later edits come from the user
  onChange: (source: string) => void;
  autofocus?: boolean;
  // Cell shortcuts (SPEC §9.5) by CodeMirror key name, e.g. "Shift-Enter". They come
  // before the editor's own bindings, so Shift+Enter runs instead of adding a line.
  shortcuts?: Record<string, () => void>;
}

// The Graphite design (SPEC §9.4). `dark: true` switches CodeMirror's base
// theme to its dark variant. The editors use the browser's own caret and selection
// (no drawSelection), so the caret is coloured with caret-color.
const baseTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--color-ink)" },
    "&.cm-focused": { outline: "none" },
    ".cm-content": { caretColor: "var(--color-acc)" },
  },
  { dark: true },
);

// A shell cell's command: an inset with line numbers, 14/22 mono.
const shellTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "14px", lineHeight: "22px" },
  ".cm-content": { padding: "9px 0" },
  ".cm-line": { padding: "0 16px 0 0" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--color-faint)" },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "44px",
    padding: "0 16px 0 0",
    textAlign: "right",
  },
});

// A markdown cell while it is edited reads like the rendered prose (app.css .markdown),
// so its text doesn't move (SPEC §9.3): 16/28 in the same font, wrapped at the prose's
// 66ch, and headings at their rendered sizes.
const markdownTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: "var(--font-sans)", fontSize: "16px", lineHeight: "28px" },
  ".cm-content": { padding: "0", color: "var(--color-body)", maxWidth: "66ch" },
  ".cm-line": { padding: "0" },
  ".cm-md-h1": { fontSize: "24px", lineHeight: "32px", letterSpacing: "-0.015em" },
  ".cm-md-h2": { fontSize: "20px", lineHeight: "28px", letterSpacing: "-0.01em" },
  ".cm-md-h3": { fontSize: "17px" },
});

// Marks the lines of each heading (# or underlined) with its level, for the sizes above.
function headingLines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const level = /^(?:ATX|Setext)Heading([1-3])$/.exec(node.name)?.[1];
        if (!level) return;
        // An underlined heading spans its text and the === line; only the text is sized.
        const line = doc.lineAt(node.from);
        builder.add(line.from, line.from, Decoration.line({ class: `cm-md-h${level}` }));
        return false;
      },
    });
  }
  return builder.finish();
}

const markdownHeadings = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = headingLines(view);
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = headingLines(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Command colours, as in the design: commands blue, flags gold, strings green,
// operators faint. Shell's legacy mode tags builtins and flags; other commands stay ink.
const shellHighlight = HighlightStyle.define([
  { tag: [tags.standard(tags.variableName), tags.keyword], color: "#8ab4f8" },
  { tag: tags.attributeName, color: "#e5c07b" },
  { tag: [tags.string, tags.special(tags.string)], color: "#a6d99b" },
  { tag: [tags.definition(tags.variableName), tags.variableName], color: "#86d4e0" },
  { tag: tags.number, color: "#e9c97a" },
  { tag: [tags.operator, tags.punctuation], color: "var(--color-faint)" },
  { tag: tags.comment, color: "var(--color-faint)", fontStyle: "italic" },
]);

// Markdown while editing: the structure shows in weight and colour, and the syntax
// marks (#, **, `) are dimmed rather than hidden, as in a live preview.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--color-ink)", fontWeight: "650" },
  { tag: tags.strong, color: "var(--color-ink)", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-mono)",
    fontSize: "14.5px",
    color: "var(--color-ink)",
  },
  { tag: tags.link, color: "var(--color-acc)" },
  {
    tag: [tags.url, tags.processingInstruction, tags.contentSeparator],
    color: "var(--color-faint)",
  },
  { tag: tags.quote, color: "var(--color-muted)" },
]);

const editing = [history(), keymap.of([...defaultKeymap, ...historyKeymap]), baseTheme];

const shellExtensions = [
  StreamLanguage.define(shell),
  lineNumbers(),
  EditorView.lineWrapping,
  shellTheme,
  syntaxHighlighting(shellHighlight),
];

const markdownExtensions = [
  markdown(),
  markdownHeadings,
  EditorView.lineWrapping,
  markdownTheme,
  syntaxHighlighting(markdownHighlight),
];

// A shell cell's editor (SPEC §9.3): always shown, bash highlighting.
export function shellEditor(options: EditorOptions): Attachment<HTMLElement> {
  return editor(options, shellExtensions);
}

// A markdown cell's editor, shown while editing. Esc, or focus leaving it, ends editing.
export function markdownEditor(
  options: EditorOptions & { onExit: () => void },
): Attachment<HTMLElement> {
  return editor(options, [
    ...markdownExtensions,
    keymap.of([{ key: "Escape", run: () => (options.onExit(), true) }]),
    EditorView.domEventHandlers({ blur: () => options.onExit() }),
  ]);
}

// The editor is created once per element. It owns its document from then on and
// reports changes, so updating the cell's source never recreates it mid-typing.
function editor(options: EditorOptions, extensions: Extension[]): Attachment<HTMLElement> {
  const { initial, onChange, autofocus = false, shortcuts = {} } = options;
  const cellKeys = Prec.highest(
    keymap.of(Object.entries(shortcuts).map(([key, run]) => ({ key, run: () => (run(), true) }))),
  );
  return (parent) => {
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial,
        extensions: [
          cellKeys,
          ...editing,
          ...extensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    if (autofocus) view.focus();
    return () => view.destroy();
  };
}
