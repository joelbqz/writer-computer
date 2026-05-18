import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { type EditorState, Facet, type Range, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";
import { type RangeLike, rangeTouchesRange } from "../utils";
import { unfurlFreezeFacet } from "../unfurlFreeze";

const hideTheme = EditorView.theme({
  ".cm-hidden-token": {
    fontSize: "0px",
  },
  ".cm-transparent-token": {
    opacity: 0,
  },
});

export const hideInlineDecoration = Decoration.mark({
  class: "cm-hidden-token",
});
export const hideInlineKeepSpaceDecoration = Decoration.mark({
  class: "cm-transparent-token",
});
export const hideBlockDecoration = Decoration.replace({
  block: true,
});

const buildDecorations = (state: EditorState) => {
  const decorations: Range<Decoration>[] = [];
  const specs = state.facet(hidableNodeFacet);
  specs.map(checkSpec);

  syntaxTree(state).iterate({
    enter: (node) => {
      for (const spec of specs) {
        // Check spec
        if (spec.nodeName instanceof Function) {
          if (!spec.nodeName(node.type.name)) {
            continue;
          }
        } else if (spec.nodeName instanceof Array) {
          if (!spec.nodeName.includes(node.type.name)) {
            continue;
          }
        } else if (node.type.name !== spec.nodeName) {
          continue;
        }

        // Context filter (e.g. by parent type) for specs whose `nodeName`
        // alone can't disambiguate — `CodeMark` appears under both
        // `InlineCode` and `FencedCode`, and we want different hide behavior
        // for each.
        if (spec.predicate && !spec.predicate(state, node)) {
          continue;
        }

        // Check custom show zone
        if (spec.unhideZone) {
          const res = spec.unhideZone(state, node);
          if (state.selection.ranges.some((range) => rangeTouchesRange(res, range))) {
            continue;
          }
        }

        if (spec.nodeDecoration) {
          decorations.push(spec.nodeDecoration.range(node.from, node.to));
        }

        const hideZone = spec.hideZone ? spec.hideZone(state, node) : node;
        const selectionTouchesHideZone = state.selection.ranges.some((range) =>
          rangeTouchesRange(hideZone, range),
        );
        if (selectionTouchesHideZone) {
          continue;
        }

        // Hide node using one of the provided methods
        if (spec.onHide) {
          const res = spec.onHide(state, node);
          if (res instanceof Array) {
            decorations.push(...res);
          } else if (res) {
            decorations.push(res);
          }
        }
        if (spec.subNodeNameToHide) {
          let names: string[];
          if (!Array.isArray(spec.subNodeNameToHide)) {
            names = [spec.subNodeNameToHide];
          } else {
            names = spec.subNodeNameToHide;
          }

          const cursor = node.node.cursor();

          // Manual traversal to ensure all children are processed
          cursor.iterate((node) => {
            if (names.includes(node.type.name)) {
              decorations.push(
                (spec.block
                  ? hideBlockDecoration
                  : spec.keepSpace
                    ? hideInlineKeepSpaceDecoration
                    : hideInlineDecoration
                ).range(node.from, node.to),
              );
            }
          });
        }
      }
    },
  });
  return Decoration.set(decorations, true);
};

export const hideExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },

  update(deco, tr) {
    // Freeze: skip selection-driven rebuilds while a drag is in flight. Doc
    // changes still re-map positions so coordinates stay valid; only the
    // selection-touch recomputation is suppressed.
    if (tr.state.facet(unfurlFreezeFacet)) {
      return tr.docChanged ? deco.map(tr.changes) : deco;
    }
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildDecorations(tr.state);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => [EditorView.decorations.from(f), hideTheme],
});

export interface HidableNodeSpec {
  nodeName: string | string[] | ((nodeName: string) => boolean);
  // Context filter — when set, the spec only applies if it returns true.
  // Use to disambiguate node types that appear under different parents and
  // want different hide behavior (e.g. `CodeMark` in `InlineCode` vs
  // `FencedCode`).
  predicate?: (state: EditorState, node: SyntaxNodeRef) => boolean;
  nodeDecoration?: Decoration;
  subNodeNameToHide?: string | string[];
  onHide?: (
    state: EditorState,
    node: SyntaxNodeRef,
  ) => Range<Decoration> | Range<Decoration>[] | undefined;
  block?: boolean;
  keepSpace?: boolean;
  unhideZone?: (state: EditorState, node: SyntaxNodeRef) => RangeLike;
  // Custom zone used for the selection-touch check that decides whether to
  // hide. Defaults to the node range. Set to a tighter zone when the node's
  // own range overlaps zero-width spans the caret can land in from a click —
  // e.g. EmphasisMark, where a click at the visible boundary would otherwise
  // unfurl and visually shift the caret.
  hideZone?: (state: EditorState, node: SyntaxNodeRef) => RangeLike;
}

const checkSpec = (spec: HidableNodeSpec) => {
  if (spec.block && spec.keepSpace) {
    console.warn(
      "Only inline hide nodes can maintain space currently, but `block` and `keepSpace` are set in:",
      spec,
    );
  }
};

export const hidableNodeFacet = Facet.define<HidableNodeSpec, HidableNodeSpec[]>({
  combine(value: readonly HidableNodeSpec[]) {
    return [...value];
  },
  enables: hideExtension,
});
