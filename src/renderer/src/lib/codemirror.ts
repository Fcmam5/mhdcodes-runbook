import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Attachment } from "svelte/attachments";
import { MONOSPACE } from "./fonts";

export interface EditorOptions {
  initial: string; // the document the editor starts with; later edits come from the user
  onChange: (source: string) => void;
  autofocus?: boolean;
  // Cell shortcuts (SPEC §9.5) by CodeMirror key name, e.g. "Shift-Enter". They come
  // before the editor's own bindings, so Shift+Enter runs instead of adding a line.
  shortcuts?: Record<string, () => void>;
}

// The app is dark only; `dark: true` switches CodeMirror's base theme to its dark
// variant. Caret and selection are set to match the app's colours.
const theme = EditorView.theme(
  {
    "&": { fontSize: "14px", backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: MONOSPACE, lineHeight: "1.5" },
    ".cm-content": { padding: "8px 0", caretColor: "#f4f4f5" },
    ".cm-line": { padding: "0 12px" },
    ".cm-cursor": { borderLeftColor: "#f4f4f5" },
    // zinc-700, and a blue tint while focused.
    ".cm-selectionBackground": { backgroundColor: "#3f3f46 !important" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#1e3a8a !important",
    },
  },
  { dark: true },
);

// CodeMirror's default highlight colours are for light backgrounds; these are their
// counterparts for dark ones.
const highlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: "#a1a1aa" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.heading, textDecoration: "underline", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.keyword, color: "#c792ea" },
  {
    tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
    color: "#82aaff",
  },
  { tag: [tags.literal, tags.inserted], color: "#7fd1a4" },
  { tag: [tags.string, tags.deleted], color: "#f78c6c" },
  {
    tag: [tags.regexp, tags.escape, tags.special(tags.string)],
    color: "#ffcb6b",
  },
  { tag: tags.definition(tags.variableName), color: "#82aaff" },
  { tag: tags.local(tags.variableName), color: "#b4a7f5" },
  { tag: [tags.typeName, tags.namespace], color: "#7fd1a4" },
  { tag: tags.className, color: "#89ddff" },
  {
    tag: [tags.special(tags.variableName), tags.macroName],
    color: "#89ddff",
  },
  { tag: tags.definition(tags.propertyName), color: "#82aaff" },
  { tag: tags.comment, color: "#a1a1aa" },
  { tag: tags.invalid, color: "#ff5370" },
]);

const editing = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  theme,
  syntaxHighlighting(highlightStyle),
];

const shellExtensions = [StreamLanguage.define(shell)];

const markdownExtensions = [markdown(), EditorView.lineWrapping];

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
