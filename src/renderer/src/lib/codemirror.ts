import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Attachment } from "svelte/attachments";
import { MONOSPACE } from "./fonts";

const shellExtensions = [
  StreamLanguage.define(shell),
  syntaxHighlighting(defaultHighlightStyle),
  EditorState.readOnly.of(true),
  EditorView.theme({
    "&": { fontSize: "14px", backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: MONOSPACE, lineHeight: "1.5" },
    ".cm-content": { padding: "8px 0" },
    ".cm-line": { padding: "0 12px" },
  }),
];

// A read-only CodeMirror editor showing a shell cell's source. Editing comes later.
export function shellEditor(source: string): Attachment<HTMLElement> {
  return (parent) => {
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: source, extensions: shellExtensions }),
    });
    return () => view.destroy();
  };
}
