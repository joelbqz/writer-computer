import {
  type EditorState,
  StateField,
  type Range,
  Facet,
  EditorSelection,
  type Extension,
} from "@codemirror/state";
import {
  type DOMEventHandlers,
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { eventHandlersWithClass, type RangeLike, selectionTouchesRange } from "../utils";
import { unfurlFreezeFacet } from "../unfurlFreeze";

import type { SyntaxNodeRef } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";

interface IndexedSpec {
  spec: FoldableSyntaxSpec;
  /** True when the spec's `nodePath` has ancestor segments and the full
   *  lineage path must be built to check it. */
  needsPath: boolean;
}

/** Fold specs pre-sorted by the node name they can match. Built once in the
 *  facet's `combine`, so the per-node work in `buildDecorations` is a map
 *  lookup instead of building a lineage path string for every node in the
 *  document (this runs on every edit and caret move). */
interface FoldSpecIndex {
  byName: Map<string, IndexedSpec[]>;
  /** Predicate specs can match anything; they always see the full path. */
  predicates: FoldableSyntaxSpec[];
}

const terminalSegment = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function indexSpecs(specs: readonly FoldableSyntaxSpec[]): FoldSpecIndex {
  const byName = new Map<string, IndexedSpec[]>();
  const predicates: FoldableSyntaxSpec[] = [];
  for (const spec of specs) {
    if (spec.nodePath instanceof Function) {
      predicates.push(spec);
      continue;
    }
    const paths = Array.isArray(spec.nodePath) ? spec.nodePath : [spec.nodePath];
    const needsPathByName = new Map<string, boolean>();
    for (const path of paths) {
      const name = terminalSegment(path);
      needsPathByName.set(name, (needsPathByName.get(name) ?? false) || path.includes("/"));
    }
    for (const [name, needsPath] of needsPathByName) {
      let bucket = byName.get(name);
      if (!bucket) byName.set(name, (bucket = []));
      bucket.push({ spec, needsPath });
    }
  }
  return { byName, predicates };
}

const lineagePath = (node: SyntaxNodeRef): string => {
  const lineage: string[] = [];
  let node_: SyntaxNodeRef | null = node;
  while (node_) {
    lineage.push(node_.name);
    node_ = node_.node.parent;
  }
  return lineage.reverse().join("/");
};

/** A path spec matches when the lineage ends with it on a segment boundary. */
const pathMatches = (path: string, nodePath: string | string[]): boolean => {
  const slashed = `/${path}`;
  const test = (candidate: string) => slashed.endsWith(`/${candidate}`);
  return Array.isArray(nodePath) ? nodePath.some(test) : test(nodePath);
};

const buildDecorations = (state: EditorState) => {
  const decorations: Range<Decoration>[] = [];
  const index = state.facet(foldableSyntaxFacet);
  syntaxTree(state).iterate({
    enter: (node) => {
      const candidates = index.byName.get(node.name);
      if (!candidates && index.predicates.length === 0) return;

      let path: string | null = null;
      const getPath = () => (path ??= lineagePath(node));
      let touchesNode: boolean | null = null;
      const selectionTouchesNodeRange = () =>
        (touchesNode ??= selectionTouchesRange(state.selection.ranges, node));

      const run = (spec: FoldableSyntaxSpec): boolean => {
        // Check custom unfold zone
        const selectionTouchesRange_ = spec.unfoldZone
          ? selectionTouchesRange(state.selection.ranges, spec.unfoldZone(state, node))
          : selectionTouchesNodeRange();

        // A touched spec without `keepDecorationOnUnfold` ends processing for
        // this node (the original loop returned from the callback here).
        if (!spec.keepDecorationOnUnfold && selectionTouchesRange_) return false;

        // Run folding logic
        if (spec.buildDecorations) {
          const res = spec.buildDecorations(state, node, selectionTouchesRange_);
          if (res instanceof Array) {
            decorations.push(...res);
          } else if (res) {
            decorations.push(res);
          }
        }
        return true;
      };

      if (candidates) {
        for (const { spec, needsPath } of candidates) {
          if (needsPath && !pathMatches(getPath(), spec.nodePath as string | string[])) continue;
          if (!run(spec)) return;
        }
      }
      for (const spec of index.predicates) {
        if (!(spec.nodePath as (nodePath: string) => boolean)(getPath())) continue;
        if (!run(spec)) return;
      }
    },
  });
  return Decoration.set(decorations, true);
};

export const foldExtension = StateField.define<DecorationSet>({
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
  provide: (f) => [EditorView.decorations.from(f)],
});

export interface FoldableSyntaxSpec {
  /** Node name (`"Table"`), lineage path suffix matched on segment boundaries
   *  (`"ListItem/Paragraph"`), a list of either, or a predicate over the full
   *  `Document/…/Node` path. */
  nodePath: string | string[] | ((nodePath: string) => boolean);
  buildDecorations?: (
    state: EditorState,
    node: SyntaxNodeRef,
    selectionTouchesRange: boolean,
  ) => Range<Decoration> | Range<Decoration>[] | undefined;
  unfoldZone?: (state: EditorState, node: SyntaxNodeRef) => RangeLike;
  eventHandlers?: DOMEventHandlers<void>;
  keepDecorationOnUnfold?: boolean;
}

export const foldableSyntaxFacet = Facet.define<FoldableSyntaxSpec, FoldSpecIndex>({
  combine: indexSpecs,
  enables: foldExtension,
});

/** On mousedown inside a `widgetClass` element, range-select the fold
 *  decoration under it so the source unfolds for editing (a plain mouse
 *  selection would overshoot the widget's content range). `ignoreTarget` lets
 *  widgets with interactive children (links, buttons, `<summary>`) keep those
 *  clicks. */
export const selectAllDecorationsOnSelectExtension = (
  widgetClass: string,
  ignoreTarget?: (target: Element) => boolean,
): Extension =>
  EditorView.domEventHandlers(
    eventHandlersWithClass({
      mousedown: {
        [widgetClass]: (e: MouseEvent, view: EditorView) => {
          if (!view.state.selection.main.empty) return;
          const target = e.target;
          if (!(target instanceof Element)) return;
          if (ignoreTarget?.(target)) return;

          const pos = view.posAtDOM(target);

          const decorations = view.state.field(foldExtension);
          decorations.between(pos, pos, (from: number, to: number) => {
            setTimeout(() => {
              view.dispatch({
                selection: EditorSelection.single(to, from),
              });
            }, 0);
            return false;
          });
        },
      },
    }),
  );
