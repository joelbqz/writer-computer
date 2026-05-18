import {
  EditorState,
  Extension,
  SelectionRange,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { unfurlFreezeFacet } from "@/lib/prosemark-core/main";

/**
 * Pointer-drag selection gate.
 *
 * Many editor decorations (prosemark's syntax-mark hider, our wiki-link /
 * mermaid / html-block / table fold widgets) are selection-aware — they
 * recompute on every selection change. During a mouse drag-selection,
 * CodeMirror emits one selection-extending transaction per mousemove. Without
 * a gate, every intermediate selection unfurls/hides markdown under the
 * cursor, the text reflows, and the drag target slips out from under the
 * mouse.
 *
 * The gate snapshots `state.selection.ranges` into `dragFrozenSelectionField`
 * on `pointerdown` and clears it on `pointerup` / `pointercancel` / blur.
 * Behaviors driven off it:
 *
 *  - **Prosemark hide/fold**: a derived `unfurlFreezeFacet` contribution
 *    flips `true` while the field is non-null. Prosemark's hide/fold
 *    `StateField`s short-circuit their `update` when the facet is `true`,
 *    so neither selection-touch additions nor removals fire mid-drag. The
 *    end-drag dispatch sets `selection: state.selection` so the unfreeze
 *    transaction itself triggers a fresh rebuild against the live selection
 *    — "always unfurl on mouseup."
 *  - **Our own decorations** (heading, wiki-link, table, html-block,
 *    mermaid): read the snapshot directly via `getEffectiveSelectionRanges`
 *    or `rangesTouchInclusive` to compute against the pre-drag selection.
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
 * `hideExtension`/`foldExtension` only rebuild when `tr.docChanged ||
 * tr.selection`. The unfreeze transaction itself clears the field (so the
 * facet flips to `false` in `tr.state`) and re-asserts selection so the
 * normal rebuild branch runs against live ranges — that's the "always unfurl
 * on mouseup" half of the contract. If prosemark ever tightens this to
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
 * list.
 */
const dragFreezeExtensions: Extension = [
  dragFrozenSelectionField,
  dragSelectionPlugin,
  unfurlFreezeFacet.compute(
    [dragFrozenSelectionField],
    (state) => state.field(dragFrozenSelectionField, false) !== null,
  ),
];

export {
  DRAG_END_USER_EVENT,
  buildEndDragDispatch,
  dragFreezeExtensions,
  dragFrozenSelectionField,
  dragSelectionPlugin,
  endDragEffect,
  getEffectiveSelectionRanges,
  rangesTouchInclusive,
  shouldStartDragGate,
  startDragEffect,
};
