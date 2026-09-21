import { highlightingFor, syntaxTree } from "@codemirror/language";
import { type Extension, Prec, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { highlightTree, type Tag } from "@lezer/highlight";
import { offscreenSelectionLines, renderedRangesChanged, treeChanged } from "./utils";

/** Syntax highlighting for the selection's off-viewport lines.
 *
 *  `@codemirror/language`'s tree highlighter styles `view.visibleRanges` only,
 *  but CodeMirror keeps the main selection's anchor and head lines rendered
 *  wherever the viewport is and measures them into the height map. Without
 *  their highlight marks a heading holding the caret renders at body font size
 *  once it scrolls out, its height map entry shrinks by the difference, and
 *  the document above the viewport jumps. This runs the same tree walk with
 *  the same highlighters over just those lines. When they scroll back in, the
 *  decorations empty and the tree highlighter covers them in the same update. */
const markCache: Record<string, Decoration> = Object.create(null);

function build(view: EditorView): DecorationSet {
  const lines = offscreenSelectionLines(view);
  if (lines.length === 0) return Decoration.none;
  const tree = syntaxTree(view.state);
  if (tree.length === 0) return Decoration.none;
  const highlighter = {
    style: (tags: readonly Tag[]) => highlightingFor(view.state, tags, tree.type),
  };
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of lines) {
    highlightTree(
      tree,
      highlighter,
      (markFrom, markTo, cls) => {
        builder.add(markFrom, markTo, (markCache[cls] ??= Decoration.mark({ class: cls })));
      },
      from,
      to,
    );
  }
  return builder.finish();
}

// Same precedence as the tree highlighter so marks nest the same way.
export const offscreenSelectionHighlightExtension: Extension = Prec.high(
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || treeChanged(update) || renderedRangesChanged(update)) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
);
