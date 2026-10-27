import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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

const theme = EditorView.theme({
  "&": { fontSize: "14px", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: MONOSPACE, lineHeight: "1.5" },
  ".cm-content": { padding: "8px 0" },
  ".cm-line": { padding: "0 12px" },
});

const editing = [history(), keymap.of([...defaultKeymap, ...historyKeymap]), theme];

const shellExtensions = [StreamLanguage.define(shell), syntaxHighlighting(defaultHighlightStyle)];

const markdownExtensions = [
  markdown(),
  syntaxHighlighting(defaultHighlightStyle),
  EditorView.lineWrapping,
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
