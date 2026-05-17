import {
  EditorState,
  Extension,
  Prec,
  Range,
  SelectionRange,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import { foldExtension, hideExtension } from "@/lib/prosemark-core/main";

/**
 * Pointer-drag selection gate.
 *
 * The core problem: many of the editor's decorations (prosemark's syntax-mark
 * hider, our wiki-link / mermaid / html-block / table fold widgets) are
 * selection-aware — they recompute on every selection change. During a mouse
 * drag-selection, CodeMirror emits one selection-extending transaction per
 * mousemove. Without a gate, every intermediate selection unfurls/hides
 * markdown under the cursor, the text reflows, and the drag target slips out
 * from under the mouse.
 *
 * The gate freezes the *decoration choice* for the duration of a pointer drag:
 *
 *  - On `pointerdown` we snapshot `state.selection.ranges` into
 *    `dragFrozenSelectionField`. Consumers read this field via
 *    `getEffectiveSelectionRanges` (or directly) and decide unfurl based on
 *    the snapshot, not the live selection.
 *  - For prosemark's `hideExtension` (whose internals we can't reach), we
 *    snapshot its current `DecorationSet` into `frozenHideDecorationsField`,
 *    and contribute the *difference* between snapshot and live (the
 *    decorations prosemark dropped mid-drag) via `frozenHideDecorationsOverlay`.
 *    Only contributing the diff is important: prosemark always re-emits each
 *    node's `nodeDecoration` (e.g. `cm-inline-code`) regardless of selection,
 *    so overlaying the whole snapshot would duplicate those wrapper marks and
 *    render them as nested spans — visibly doubled padding around inline code,
 *    etc. The diff narrows the overlay to exactly the hides prosemark removed.
 *  - On `pointerup` / `pointercancel` / blur we clear both, and dispatch a
 *    no-op `selection: state.selection` so prosemark's `tr.selection`-gated
 *    fold/hide state fields recompute against the now-live selection.
 *
 * Limitation: the diff overlay can re-apply hides that prosemark drops
 * mid-drag, but it can't *remove* hides prosemark adds mid-drag. So if the
 * user clicks *inside* an already-unfurled node and drags past it, prosemark
 * will hide that node once the selection leaves — one layout shift instead of
 * the dozens you'd see today. The common case (drag from plain text across
 * inline markdown) is fully frozen.
 */

const startDragEffect = StateEffect.define<readonly SelectionRange[]>();
const endDragEffect = StateEffect.define<null>();

const dragFrozenSelectionField = StateField.define<readonly SelectionRange[] | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(startDragEffect)) return e.value;
      if (e.is(endDragEffect)) return null;
    }
    if (value && tr.docChanged) {
      // Map snapshot through doc changes so it stays valid if the document
      // mutates mid-drag (rare, but cheap to keep correct).
      return value.map((r) => r.map(tr.changes));
    }
    return value;
  },
});

/**
 * Snapshot of prosemark's `hideExtension` DecorationSet at pointerdown. Kept in
 * a field so it survives the (selection-changing) transactions that fire
 * during a drag. Cleared on `endDragEffect`. Stays `Decoration.none` outside a
 * drag so the diff-based overlay below contributes nothing.
 */
const frozenHideDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(startDragEffect)) {
        return tr.startState.field(hideExtension, false) ?? Decoration.none;
      }
      if (e.is(endDragEffect)) return Decoration.none;
    }
    return tr.docChanged ? value.map(tr.changes) : value;
  },
});

/**
 * Decorations that exist in `snapshot` but not in `live`. The snapshot is
 * prosemark's pre-drag DecorationSet; live is its current one. Subtracting
 * gives us exactly the hide-style decorations prosemark dropped because the
 * selection now touches their node — the things we need to re-apply to keep
 * the rendering frozen.
 *
 * Why subtract instead of overlaying the whole snapshot? Prosemark always
 * emits a `nodeDecoration` (e.g. `Decoration.mark({class: "cm-inline-code"})`)
 * regardless of selection. If we overlaid the snapshot wholesale, that
 * wrapper would be contributed twice — once by prosemark, once by us — and
 * CodeMirror would render nested spans with doubled padding, causing visible
 * gaps around inline code. Subtracting keeps the overlay narrow: only the
 * decorations prosemark actually stopped emitting.
 *
 * Identity check works because prosemark allocates each `Decoration` instance
 * once at module load (e.g. `hideInlineDecoration`, the per-spec
 * `nodeDecoration`) and reuses the same instance for every range, so
 * `snap.value === live.value` is a reliable "same decoration."
 */
function diffDecorationSet(snapshot: DecorationSet, live: DecorationSet): DecorationSet {
  if (snapshot.size === 0) return Decoration.none;
  const liveIndex = new Map<string, Set<Decoration>>();
  const liveCursor = live.iter();
  while (liveCursor.value !== null) {
    const key = `${liveCursor.from},${liveCursor.to}`;
    let bucket = liveIndex.get(key);
    if (!bucket) {
      bucket = new Set();
      liveIndex.set(key, bucket);
    }
    bucket.add(liveCursor.value);
    liveCursor.next();
  }

  const result: Range<Decoration>[] = [];
  const snapCursor = snapshot.iter();
  while (snapCursor.value !== null) {
    const key = `${snapCursor.from},${snapCursor.to}`;
    const bucket = liveIndex.get(key);
    if (!bucket || !bucket.has(snapCursor.value)) {
      result.push(snapCursor.value.range(snapCursor.from, snapCursor.to));
    }
    snapCursor.next();
  }
  return result.length === 0 ? Decoration.none : Decoration.set(result, true);
}

const frozenHideDecorationsOverlay = EditorView.decorations.compute(
  [frozenHideDecorationsField, hideExtension],
  (state) => {
    const snapshot = state.field(frozenHideDecorationsField);
    if (snapshot.size === 0) return Decoration.none;
    const live = state.field(hideExtension, false) ?? Decoration.none;
    return diffDecorationSet(snapshot, live);
  },
);

/**
 * Snapshot of prosemark's `foldExtension` DecorationSet at pointerdown. Mirrors
 * `frozenHideDecorationsField` but for the fold pipeline (lists, tasks, dashes,
 * emojis, horizontal rules — every `foldableSyntaxFacet` consumer that lacks
 * `keepDecorationOnUnfold`). When the live selection touches one of those
 * nodes prosemark short-circuits and emits no decoration at all, so the raw
 * markdown pops back in. Snapshotting plus a near-range diff lets us re-emit
 * the fold for the duration of the drag.
 */
const frozenFoldDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(startDragEffect)) {
        return tr.startState.field(foldExtension, false) ?? Decoration.none;
      }
      if (e.is(endDragEffect)) return Decoration.none;
    }
    return tr.docChanged ? value.map(tr.changes) : value;
  },
});

/**
 * Range-proximity diff used for the fold overlay. Fold specs allocate fresh
 * `Decoration` instances per `buildDecorations` call (e.g. `new BulletPoint()`),
 * so identity comparison is useless here. Instead, we include a snapshot
 * decoration only when the live set has no decoration within one position of
 * its range.
 *
 * The `±1` slack is the load-bearing bit. It exists for `imageExtension`,
 * which has `keepDecorationOnUnfold: true` and returns *different*
 * decorations depending on selection: a `Decoration.replace([from, to])` when
 * the selection is outside, and a `Decoration.widget` at `[to, to]` when it
 * touches. A strict range match would treat those as distinct and overlay the
 * snapshot's replace on top of the live widget — rendering two image widgets
 * stacked. The proximity check sees the boundary widget as "near" the
 * snapshot's range and skips it, deferring to live. The image still flips
 * mid-drag, but it doesn't double up. Lists, tasks, dashes, emojis, etc. —
 * which prosemark fully drops on selection touch — sit alone in their range
 * and pass the proximity check, so the snapshot is added back and they stay
 * folded for the rest of the drag.
 */
function diffFoldDecorationsByProximity(
  snapshot: DecorationSet,
  live: DecorationSet,
): DecorationSet {
  if (snapshot.size === 0) return Decoration.none;
  const result: Range<Decoration>[] = [];
  const snapCursor = snapshot.iter();
  while (snapCursor.value !== null) {
    const from = snapCursor.from;
    const to = snapCursor.to;
    let conflict = false;
    live.between(from - 1, to + 1, () => {
      conflict = true;
      return false;
    });
    if (!conflict) {
      result.push(snapCursor.value.range(from, to));
    }
    snapCursor.next();
  }
  return result.length === 0 ? Decoration.none : Decoration.set(result, true);
}

const frozenFoldDecorationsOverlay = EditorView.decorations.compute(
  [frozenFoldDecorationsField, foldExtension],
  (state) => {
    const snapshot = state.field(frozenFoldDecorationsField);
    if (snapshot.size === 0) return Decoration.none;
    const live = state.field(foldExtension, false) ?? Decoration.none;
    return diffFoldDecorationsByProximity(snapshot, live);
  },
);

function rangesTouchInclusive(
  ranges: readonly SelectionRange[],
  node: { from: number; to: number },
): boolean {
  for (const r of ranges) {
    if (r.from <= node.to && node.from <= r.to) return true;
  }
  return false;
}

/**
 * Returns the selection that decoration code should use: the drag snapshot
 * when a drag is active, otherwise the live selection ranges. The convenience
 * exists so callers don't have to remember the `state.field(..., false)` dance
 * or the fallback.
 */
function getEffectiveSelectionRanges(state: EditorState): readonly SelectionRange[] {
  return state.field(dragFrozenSelectionField, false) ?? state.selection.ranges;
}

/**
 * Annotation tag for the no-op selection nudge paired with `endDragEffect` to
 * force prosemark's `foldExtension`/`hideExtension` to rebuild. Tagged as a
 * "select" sub-event so any `transactionExtender`/`updateListener` keying off
 * `tr.isUserEvent("select")` for real user selection changes can opt out via
 * `tr.isUserEvent("select.pointer.drag-end")`.
 */
const DRAG_END_USER_EVENT = "select.pointer.drag-end";

/**
 * Pure predicate for the `pointerdown` listener. Returns the dispatch spec to
 * start the drag gate, or null to skip. Extracted so the filter logic
 * (primary-button-only, isPrimary, in-widget skip, idempotent re-entry) is
 * testable without mounting a real `EditorView`.
 *
 * The `.cm-mermaid-widget` skip is **load-bearing**, not redundant: the canvas
 * viewport's own `pointerdown` (`mermaid-canvas.ts:160`) calls
 * `e.preventDefault()` but does NOT `stopPropagation`, so canvas-internal
 * pointerdowns DO bubble to `contentDOM`. The Edit-code button only stops
 * `mousedown`, not `pointerdown` — so without this skip, every Edit-code
 * click would activate the gate and freeze `editMode` for the very toggle the
 * click is about to dispatch.
 */
function shouldStartDragGate(
  state: EditorState,
  event: { isPrimary: boolean; button: number; target: EventTarget | null },
): { effects: StateEffect<readonly SelectionRange[]> } | null {
  if (!event.isPrimary || event.button !== 0) return null;
  // Duck-type for `closest` rather than `instanceof Element` so this is
  // testable in a node environment (jsdom isn't pulled in for the unit suite).
  // Production targets always satisfy the duck check.
  const target = event.target as { closest?: (sel: string) => Element | null } | null;
  if (target && typeof target.closest === "function" && target.closest(".cm-mermaid-widget")) {
    return null;
  }
  if (state.field(dragFrozenSelectionField, false) !== null) return null;
  return { effects: startDragEffect.of(state.selection.ranges) };
}

/**
 * Pure builder for the dispatch that ends a drag. Returns null when the gate
 * is already inactive (idempotent — `pointerup`/`pointercancel`/`blur` may all
 * fire for one drag, only the first should dispatch).
 *
 * The `selection: state.selection` is the load-bearing trick: prosemark's
 * `foldExtension` only rebuilds when `tr.docChanged || tr.selection` (see
 * `node_modules/@prosemark/core/dist/main.js:315`). Without the no-op
 * selection set, clearing the field would not retrigger `buildDecorations`,
 * so widgets would stay frozen in their pre-release shape until the next
 * genuine selection or doc change. If prosemark ever tightens this to
 * "selection actually changed," this trick breaks silently — the test in
 * `mermaid.test.ts` for the post-pointerup flip is the canary.
 */
function buildEndDragDispatch(state: EditorState): {
  selection: typeof state.selection;
  effects: StateEffect<null>;
  userEvent: string;
} | null {
  if (state.field(dragFrozenSelectionField, false) === null) return null;
  return {
    selection: state.selection,
    effects: endDragEffect.of(null),
    userEvent: DRAG_END_USER_EVENT,
  };
}

const dragSelectionPlugin = ViewPlugin.fromClass(
  class {
    private readonly onWindowPointerUp: (e: PointerEvent) => void;
    private readonly onWindowPointerCancel: (e: PointerEvent) => void;
    private readonly onContentPointerDown: (e: PointerEvent) => void;
    private readonly onContentBlur: () => void;

    constructor(private readonly view: EditorView) {
      this.onContentPointerDown = (e: PointerEvent) => {
        const dispatch = shouldStartDragGate(this.view.state, e);
        if (dispatch) this.view.dispatch(dispatch);
      };
      this.onWindowPointerUp = () => this.endDrag();
      this.onWindowPointerCancel = () => this.endDrag();
      this.onContentBlur = () => this.endDrag();

      this.view.contentDOM.addEventListener("pointerdown", this.onContentPointerDown);
      this.view.contentDOM.addEventListener("blur", this.onContentBlur);
      window.addEventListener("pointerup", this.onWindowPointerUp);
      window.addEventListener("pointercancel", this.onWindowPointerCancel);
    }

    private endDrag(): void {
      const dispatch = buildEndDragDispatch(this.view.state);
      if (dispatch) {
        this.view.dispatch({
          selection: dispatch.selection,
          effects: dispatch.effects,
          annotations: Transaction.userEvent.of(dispatch.userEvent),
        });
      }
    }

    destroy(): void {
      this.view.contentDOM.removeEventListener("pointerdown", this.onContentPointerDown);
      this.view.contentDOM.removeEventListener("blur", this.onContentBlur);
      window.removeEventListener("pointerup", this.onWindowPointerUp);
      window.removeEventListener("pointercancel", this.onWindowPointerCancel);
    }
  },
);

/**
 * The full drag-freeze bundle. Mount once at the editor's top-level extension
 * list. The overlays are `Prec.high` so their decorations are processed
 * before prosemark's `hideExtension` / `foldExtension` contributions. For
 * atomic `Decoration.replace` (the block hides — heading marks, fenced
 * blocks) precedence directly decides which decoration wins at overlapping
 * ranges. For `Decoration.mark` (the inline hides — `cm-hidden-token` on
 * backticks, etc.) all contributing sources still apply; precedence here
 * just affects nest order in the rendered DOM, which is enough because the
 * relevant CSS — `font-size: 0` / `opacity: 0` — kicks in regardless of
 * which span level it lands on.
 */
const dragFreezeExtensions: Extension = [
  dragFrozenSelectionField,
  frozenHideDecorationsField,
  frozenFoldDecorationsField,
  Prec.high(frozenHideDecorationsOverlay),
  Prec.high(frozenFoldDecorationsOverlay),
  dragSelectionPlugin,
];

export {
  DRAG_END_USER_EVENT,
  buildEndDragDispatch,
  diffDecorationSet,
  diffFoldDecorationsByProximity,
  dragFreezeExtensions,
  dragFrozenSelectionField,
  dragSelectionPlugin,
  endDragEffect,
  getEffectiveSelectionRanges,
  rangesTouchInclusive,
  shouldStartDragGate,
  startDragEffect,
};
