import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";

/** Parse the whole document and commit the tree into the state so every
 *  tree-derived StateField (fold, hide, list) is built against it.
 *
 *  `EditorState.create` parses with a wall-clock budget, which a loaded test
 *  runner can blow before a tiny doc finishes; and `ensureSyntaxTree` alone
 *  only advances the parse context, not the committed `LanguageState`. The
 *  empty transaction commits it (the language field re-applies when
 *  `context.tree` has moved), which fires the fields' tree-change rebuild. */
export function withFullParse(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}
