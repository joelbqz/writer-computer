import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { EditorSelection, EditorState, type Extension, Prec } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";

const ATX_HEADING_RE = /^ATXHeading([1-6])$/;

const hashMark = Decoration.mark({ class: "cm-heading-hash" });

const lineDecos: Record<number, Decoration> = {};
for (let level = 1; level <= 6; level++) {
  lineDecos[level] = Decoration.line({
    attributes: { class: `cm-heading-line cm-heading-line-${level}` },
  });
}

function findHeadingHashEnd(node: ReturnType<typeof syntaxTree>["topNode"]): number | null {
  const cursor = node.cursor();
  if (!cursor.firstChild() || cursor.name !== "HeaderMark") return null;
  return Math.min(cursor.to + 1, node.to);
}

// Iterate every ATX heading in `state` and yield its [lineFrom, hashEnd) range
// — the "no-go zone" the caret must never land in (hash chars + trailing
// space, including the line-start position before the hash).
//
// `force = true` advances Lezer's parser synchronously up to the doc length so
// we don't see a stale/empty tree. Required on transactions that just changed
// the doc (the parser is invalidated and parses lazily) and as a fallback at
// mount/swap completion before `advanceViewportParse` has populated the tree.
function forEachHeadingHashRange(
  state: EditorState,
  fn: (from: number, to: number) => void,
  force = false,
): void {
  if (force) ensureSyntaxTree(state, state.doc.length, 50);
  const tree = syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (!ATX_HEADING_RE.test(node.name)) return undefined;
      const hashEnd = findHeadingHashEnd(node.node);
      if (hashEnd === null) return false;
      const lineFrom = state.doc.lineAt(node.from).from;
      fn(lineFrom, hashEnd);
      return false;
    },
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const m = ATX_HEADING_RE.exec(node.name);
        if (!m) return undefined;

        const level = Number(m[1]);
        const lineFrom = view.state.doc.lineAt(node.from).from;
        decos.push({ from: lineFrom, to: lineFrom, deco: lineDecos[level]! });

        const hashEnd = findHeadingHashEnd(node.node);
        if (hashEnd !== null) {
          // Visual mark covers the hash chars + trailing space, matching
          // prosemark's default hide range so the resulting span carries
          // both `.cm-hidden-token` and `.cm-heading-hash` and CodeMirror
          // merges them into a single element.
          decos.push({ from: node.from, to: hashEnd, deco: hashMark });
        }
        return false;
      },
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    decos.map(({ from, to, deco }) => deco.range(from, to)),
    true,
  );
}

const headingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// Click on the margin hash → caret on the first heading char. CM's default
// click resolves a click on the absolutely-positioned hash to a doc position
// in the no-go zone; without this handler the transactionFilter below would
// route the caret to `hashEnd`, which is the desired behavior, but routing
// through the filter goes through CM's full mouse-selection pipeline. Doing
// it here is a touch more direct and lets us return early from any further
// editor-level pointer handling.
const marginClickHandler = Prec.highest(
  EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target;
      if (!(target instanceof Element)) return false;
      if (!target.closest(".cm-heading-hash")) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const tree = syntaxTree(view.state);
      let hashEnd: number | null = null;
      // The hash chars sit at line boundaries, so try both sides.
      for (const side of [-1, 1] as const) {
        let node = tree.resolveInner(pos, side);
        while (!ATX_HEADING_RE.test(node.name) && node.parent) node = node.parent;
        if (ATX_HEADING_RE.test(node.name)) {
          hashEnd = findHeadingHashEnd(node);
          break;
        }
      }
      if (hashEnd === null) return false;

      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: hashEnd } });
      view.focus();
      return true;
    },
  }),
);

// Hard guarantee that no caret/selection endpoint can land inside
// `[lineFrom, hashEnd - 1]` — hash chars + trailing space, including
// line-start. Runs on every transaction and clamps any offending endpoint to
// `hashEnd` (the first heading char), no matter the source — keyboard, mouse,
// drag selection, command palette, undo/redo, or anything that calls
// `view.dispatch`. The clamp direction is forward (always to `hashEnd`); the
// only path that needs to escape backward through the hash is left-arrow at
// `hashEnd`, which is handled by `escapeHashLeft` below.
//
// Returning `[tr, { selection: clampedSelection }]` adds a selection override
// to the transaction; CM combines them and the override wins. The combined
// transaction's clamped selection lives at `hashEnd`, which isn't in the
// no-go zone, so we never recurse.
const headingSelectionGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;

  const ranges: { from: number; to: number }[] = [];
  // Force-parse on doc changes — the swap path dispatches a single transaction
  // that BOTH replaces the doc and sets the selection, and Lezer's lazy
  // parser leaves `syntaxTree(tr.state)` empty for the new content. Without
  // forcing, the filter finds no headings and the selection lands at 0.
  forEachHeadingHashRange(tr.state, (from, to) => ranges.push({ from, to }), tr.docChanged);
  if (ranges.length === 0) return tr;

  let changed = false;
  const fixed = tr.newSelection.ranges.map((r) => {
    let { anchor, head } = r;
    for (const { from, to } of ranges) {
      if (anchor >= from && anchor < to) {
        anchor = to;
        changed = true;
      }
      if (head >= from && head < to) {
        head = to;
        changed = true;
      }
    }
    return EditorSelection.range(anchor, head);
  });

  if (!changed) return tr;
  return [tr, { selection: EditorSelection.create(fixed, tr.newSelection.mainIndex) }];
});

// Left-arrow at `hashEnd` of any heading escapes backward to the end of the
// previous line (or doc start). Without this, the default `cursorLeft` would
// move the caret to `hashEnd - 1` (trailing space), the filter above would
// clamp it back to `hashEnd`, and the keystroke would appear to do nothing.
const escapeHashLeft = Prec.highest(
  keymap.of([
    {
      key: "ArrowLeft",
      run: (view) => {
        const sel = view.state.selection.main;
        if (!sel.empty) return false;

        const pos = sel.head;
        let target: number | null = null;
        forEachHeadingHashRange(view.state, (from, to) => {
          if (target !== null) return;
          if (pos === to) target = Math.max(0, from - 1);
        });
        if (target === null) return false;

        view.dispatch({
          selection: { anchor: target },
          scrollIntoView: true,
          userEvent: "select",
        });
        return true;
      },
    },
  ]),
);

// Re-validate the current selection against heading hash ranges and dispatch
// a clamp if any endpoint is in the no-go zone. The transactionFilter handles
// most paths, but a transaction that BOTH replaces the doc AND sets the
// selection (the doc-swap path in `use-prosemark-editor`) sees a freshly
// invalidated syntax tree at filter time — Lezer parses lazily, so the new
// content's headings aren't yet in the tree and `forEachHeadingHashRange`
// finds nothing. Call this AFTER `advanceViewportParse` to re-check once the
// tree is actually populated. Same fallback applies to the initial mount,
// where the very first selection (`EditorState.create`'s default 0) isn't
// even a transaction the filter can see.
export function clampSelectionToHeadings(view: EditorView): void {
  const ranges: { from: number; to: number }[] = [];
  // Always force-parse here — this helper is called as a fallback at the
  // end of mount/swap paths specifically because the tree may not have been
  // ready when the selection was first set. Don't trust it to be parsed.
  forEachHeadingHashRange(view.state, (from, to) => ranges.push({ from, to }), true);
  if (ranges.length === 0) return;

  let changed = false;
  const fixed = view.state.selection.ranges.map((r) => {
    let { anchor, head } = r;
    for (const { from, to } of ranges) {
      if (anchor >= from && anchor < to) {
        anchor = to;
        changed = true;
      }
      if (head >= from && head < to) {
        head = to;
        changed = true;
      }
    }
    return EditorSelection.range(anchor, head);
  });
  if (!changed) return;
  view.dispatch({
    selection: EditorSelection.create(fixed, view.state.selection.mainIndex),
    userEvent: "select",
  });
}

export const headingDecorations: Extension = [
  headingPlugin,
  marginClickHandler,
  headingSelectionGuard,
  escapeHashLeft,
];
