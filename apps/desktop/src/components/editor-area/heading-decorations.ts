import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import {
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type SelectionRange,
} from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

const ATX_HEADING_RE = /^ATXHeading([1-6])$/;

// Max byte length of any heading no-go zone on a line: "###### " = 7 chars.
// O(1) fast-path: a position more than this far from its line start cannot
// fall inside any heading's no-go zone, so we can skip the tree walk and
// force-parse entirely for the (overwhelmingly common) case of edits in
// body text.
const MAX_HEADING_HASH_PREFIX = 7;

const hashMark = Decoration.mark({ class: "cm-heading-hash" });

const lineDecos: Record<number, Decoration> = {};
for (let level = 1; level <= 6; level++) {
  lineDecos[level] = Decoration.line({
    attributes: { class: `cm-heading-line cm-heading-line-${level}` },
  });
}

function findHeadingHashEnd(node: SyntaxNode): number | null {
  const cursor = node.cursor();
  if (!cursor.firstChild() || cursor.name !== "HeaderMark") return null;
  return Math.min(cursor.to + 1, node.to);
}

interface NoGoZone {
  from: number;
  to: number;
}

// Walk `state`'s syntax tree and return one `[lineFrom, hashEnd)` zone per
// ATX heading — hash chars + trailing space, including the line-start
// position before the hash. Callers must clamp any selection endpoint that
// lands inside `[from, to)` to `to`.
//
// `force = true` advances Lezer's parser synchronously up to the doc length
// so we don't see a stale/empty tree. Required after a transaction that just
// changed the doc (the parser is invalidated and parses lazily) and as a
// fallback at mount/swap completion before `advanceViewportParse` has
// populated the tree.
function collectHeadingNoGoZones(state: EditorState, force = false): NoGoZone[] {
  if (force) ensureSyntaxTree(state, state.doc.length, 50);
  const zones: NoGoZone[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (!ATX_HEADING_RE.test(node.name)) return undefined;
      const hashEnd = findHeadingHashEnd(node.node);
      if (hashEnd === null) return false;
      const lineFrom = state.doc.lineAt(node.from).from;
      zones.push({ from: lineFrom, to: hashEnd });
      return false;
    },
  });
  return zones;
}

function couldBeInZone(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return pos - line.from <= MAX_HEADING_HASH_PREFIX;
}

function anySelectionEndpointCouldBeInZone(
  state: EditorState,
  selection: EditorSelection,
): boolean {
  for (const r of selection.ranges) {
    if (couldBeInZone(state, r.anchor)) return true;
    if (couldBeInZone(state, r.head)) return true;
  }
  return false;
}

// Clamp every endpoint in `ranges` that lands inside a zone to that zone's
// `to`. Returns the rewritten ranges and whether anything changed. Shared
// by the transaction filter and the post-mount `clampSelectionToHeadings`
// fallback — they need identical clamp semantics.
function clampRangesToZones(
  ranges: readonly SelectionRange[],
  zones: readonly NoGoZone[],
): { changed: boolean; ranges: SelectionRange[] } {
  let changed = false;
  const fixed = ranges.map((r) => {
    let { anchor, head } = r;
    for (const { from, to } of zones) {
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
  return { changed, ranges: fixed };
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
// Fast-path: if no endpoint is within `MAX_HEADING_HASH_PREFIX` of its line
// start, none can possibly be in a zone — skip the parse and tree walk
// entirely. This is the common case for body-text typing.
//
// Returning `[tr, { selection: clampedSelection }]` adds a selection override
// to the transaction; CM combines them and the override wins. The combined
// transaction's clamped selection lives at `hashEnd`, which isn't in the
// no-go zone, so we never recurse.
const headingSelectionGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  if (!anySelectionEndpointCouldBeInZone(tr.state, tr.newSelection)) return tr;

  // Force-parse on doc changes — the swap path dispatches a single transaction
  // that BOTH replaces the doc and sets the selection, and Lezer's lazy
  // parser leaves `syntaxTree(tr.state)` empty for the new content. Without
  // forcing, the filter finds no headings and the selection lands at 0.
  const zones = collectHeadingNoGoZones(tr.state, tr.docChanged);
  if (zones.length === 0) return tr;

  const { changed, ranges } = clampRangesToZones(tr.newSelection.ranges, zones);
  if (!changed) return tr;
  return [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex) }];
});

// Find the zone whose `to` equals `pos` — i.e. caret is exactly at the first
// heading char and a leftward move would dive into the hash. Used by the
// ArrowLeft / Shift-ArrowLeft escape bindings.
function findZoneEndingAt(state: EditorState, pos: number): NoGoZone | null {
  // Same fast-path as the filter: hashEnd is at column 2-7 from line start,
  // so anything past column 7 cannot be a zone boundary.
  const line = state.doc.lineAt(pos);
  if (pos - line.from > MAX_HEADING_HASH_PREFIX) return null;
  // No force-parse — escape-left runs on a user keystroke, not a doc-replace
  // transaction, so the tree is fresh.
  for (const zone of collectHeadingNoGoZones(state)) {
    if (zone.to === pos) return zone;
  }
  return null;
}

// Left-arrow / Shift+left-arrow at `hashEnd` of any heading escapes backward
// to the end of the previous line (or doc start). Without this, the default
// `cursorCharLeft` / `selectCharLeft` would move the caret to `hashEnd - 1`
// (trailing space), the filter above would clamp it back to `hashEnd`, and
// the keystroke would appear to do nothing.
const escapeHashLeft = Prec.highest(
  keymap.of([
    {
      key: "ArrowLeft",
      run: (view) => {
        const sel = view.state.selection.main;
        if (!sel.empty) return false;
        const zone = findZoneEndingAt(view.state, sel.head);
        if (zone === null) return false;
        view.dispatch({
          selection: { anchor: Math.max(0, zone.from - 1) },
          scrollIntoView: true,
          userEvent: "select",
        });
        return true;
      },
    },
    {
      key: "Shift-ArrowLeft",
      run: (view) => {
        const sel = view.state.selection.main;
        const zone = findZoneEndingAt(view.state, sel.head);
        if (zone === null) return false;
        view.dispatch({
          selection: EditorSelection.range(sel.anchor, Math.max(0, zone.from - 1)),
          scrollIntoView: true,
          userEvent: "select.extend",
        });
        return true;
      },
    },
  ]),
);

// Re-validate the current selection against heading hash zones and dispatch
// a clamp if any endpoint is in the no-go zone. The transactionFilter handles
// most paths, but a transaction that BOTH replaces the doc AND sets the
// selection (the doc-swap path in `use-prosemark-editor`) sees a freshly
// invalidated syntax tree at filter time — Lezer parses lazily, so the new
// content's headings aren't yet in the tree and `collectHeadingNoGoZones`
// finds nothing. Call this AFTER `advanceViewportParse` to re-check once the
// tree is actually populated. Same fallback applies to the initial mount,
// where the very first selection (`EditorState.create`'s default 0) isn't
// even a transaction the filter can see.
export function clampSelectionToHeadings(view: EditorView): void {
  const sel = view.state.selection;
  if (!anySelectionEndpointCouldBeInZone(view.state, sel)) return;

  // Always force-parse here — this helper is called as a fallback at the
  // end of mount/swap paths specifically because the tree may not have been
  // ready when the selection was first set. Don't trust it to be parsed.
  const zones = collectHeadingNoGoZones(view.state, true);
  if (zones.length === 0) return;

  const { changed, ranges } = clampRangesToZones(sel.ranges, zones);
  if (!changed) return;
  view.dispatch({
    selection: EditorSelection.create(ranges, sel.mainIndex),
    userEvent: "select",
  });
}

export const headingDecorations: Extension = [
  headingPlugin,
  marginClickHandler,
  headingSelectionGuard,
  escapeHashLeft,
];

// Exported for tests.
export const __test = {
  MAX_HEADING_HASH_PREFIX,
  collectHeadingNoGoZones,
  clampRangesToZones,
  couldBeInZone,
  anySelectionEndpointCouldBeInZone,
};
