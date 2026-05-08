import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  SelectionRange,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { foldableSyntaxFacet } from "@prosemark/core";
import { renderMermaid } from "./mermaid-renderer";
import { MERMAID_CANVAS_HEIGHT, mountMermaidCanvas } from "./mermaid-canvas";

// Outer widget padding (top + bottom). The CSS rule below splits this evenly
// across top/bottom so `estimatedHeight` matches the rendered box.
const WIDGET_VERTICAL_PADDING = 16;

/**
 * Mermaid widget. Identity is just `source` + `editMode`. No position fields,
 * no eq() side-effect — fence positions are looked up live at click time from
 * the syntax tree, so there's no stale-state class of bug.
 */
class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly editMode: boolean,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return this.source === other.source && this.editMode === other.editMode;
  }

  // Fixed height regardless of diagram size, so the heightmap settles on a
  // stable value immediately.
  get estimatedHeight(): number {
    return MERMAID_CANVAS_HEIGHT + WIDGET_VERTICAL_PADDING;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-mermaid-widget";
    wrapper.contentEditable = "false";

    const host = document.createElement("div");
    host.className = "cm-mermaid-canvas";
    host.tabIndex = 0;
    wrapper.append(host);

    const onToggleEdit = () => toggleEditMode(view, host, this.editMode);

    // Synchronous render. beautiful-mermaid is sync and the SVG cache makes
    // repeat calls O(map lookup), so the wrapper paints with its final SVG in
    // the same frame it enters the DOM — no IntersectionObserver, no async
    // gap that can leave the user stuck on a placeholder.
    const result = renderMermaid(this.source);
    if (result.svg) {
      mountMermaidCanvas(host, {
        svgHtml: result.svg,
        ariaLabel: `Mermaid diagram: ${this.source.split("\n")[0]}`,
        editMode: this.editMode,
        onToggleEdit,
      });
    } else if (result.error) {
      host.classList.add("cm-mermaid-error");
      host.textContent = `Diagram error: ${result.error}`;
    }

    return wrapper;
  }

  ignoreEvent(): boolean {
    // The canvas owns all pointer/keyboard interaction inside the widget.
    // Without this CodeMirror would also process clicks and try to place the
    // caret at the replaced range, hijacking the toggle and zoom buttons.
    return true;
  }
}

/**
 * Compute the dispatch payload for an edit/preview toggle click.
 *
 * Preview → edit: select the entire fence range. `selectionTouchesRange` in
 * `@prosemark/core` is overlap-based with inclusive bounds, so any selection
 * overlapping the fence flips the syntax facet into edit mode and the source
 * appears above the canvas.
 *
 * Edit → preview: caret to fenceTo+1 (clamped to docLength) so the selection
 * no longer overlaps the fence range.
 */
export function computeToggleSelection(
  editMode: boolean,
  fenceFrom: number,
  fenceTo: number,
  docLength: number,
): { anchor: number; head?: number } {
  if (editMode) {
    return { anchor: Math.min(fenceTo + 1, docLength) };
  }
  // Reverse anchor (anchor=fenceTo, head=fenceFrom) matches the convention
  // used by `selectAllDecorationsOnSelectExtension` in @prosemark/core.
  return { anchor: fenceTo, head: fenceFrom };
}

/**
 * Find the FencedCode node enclosing the position of `host` in the document.
 *
 * `posAtDOM` for a `Decoration.widget` at `node.to` returns exactly `node.to`,
 * and `resolveInner(node.to, 1)` resolves to the node *starting* at that
 * offset (a sibling, not the fence). We try side=-1 first (which prefers the
 * node *ending* at the boundary, the common case for an edit-mode widget),
 * and fall back to side=1 for the replace-mode case where the widget covers
 * `[node.from, node.to]`.
 */
function findEnclosingFencedCode(view: EditorView, host: HTMLElement) {
  const pos = view.posAtDOM(host);
  const tree = syntaxTree(view.state);
  for (const side of [-1, 1] as const) {
    let node = tree.resolveInner(pos, side);
    while (node.name !== "FencedCode" && node.parent) node = node.parent;
    if (node.name === "FencedCode") return node;
  }
  return null;
}

/**
 * Toggle the edit/preview state for the fence containing `host`.
 *
 * Resolves the FencedCode range live from the syntax tree at click time —
 * no positions captured on the widget, no eq() side-effect — so the dispatch
 * always uses current offsets even after above-fence text has shifted.
 *
 * Scroll is preserved across the dispatch via `view.scrollSnapshot()`. The
 * heightmap shift between `Decoration.replace` (canvas only) and
 * `Decoration.widget` (source + canvas) would otherwise jump the viewport.
 */
function toggleEditMode(view: EditorView, host: HTMLElement, editMode: boolean): void {
  const fence = findEnclosingFencedCode(view, host);
  if (!fence) return;

  const sel = computeToggleSelection(editMode, fence.from, fence.to, view.state.doc.length);
  view.dispatch({
    selection:
      sel.head !== undefined
        ? EditorSelection.single(sel.anchor, sel.head)
        : { anchor: sel.anchor },
    effects: view.scrollSnapshot(),
  });
  // `view.focus()` would call `contentDOM.focus()` without `preventScroll`,
  // letting the browser auto-scroll to bring the caret into view. Anchor the
  // viewport with `preventScroll: true` instead.
  view.contentDOM.focus({ preventScroll: true });
}

/**
 * Extract info string and code content for a FencedCode node. Lezer's tree:
 *   FencedCode → CodeMark, CodeInfo, CodeText, CodeMark
 * Multiple CodeText children can occur (e.g. blockquoted fences); we
 * concatenate their slices.
 */
function parseFencedCode(
  state: { doc: { sliceString(from: number, to: number): string } },
  node: {
    node: {
      firstChild: {
        name: string;
        from: number;
        to: number;
        nextSibling: typeof node.node.firstChild;
      } | null;
    };
  },
): { info: string; source: string } | undefined {
  let info = "";
  let source = "";

  let child = node.node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") {
      info = state.doc.sliceString(child.from, child.to);
    } else if (child.name === "CodeText") {
      source += state.doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }

  if (!info) return undefined;
  return { info, source };
}

/**
 * Drag-selection gate.
 *
 * The prosemark `foldExtension` rebuilds decorations on every transaction with
 * `tr.selection` — including the per-mousemove transactions emitted by a
 * pointer drag-selection. Without a gate, the mermaid widget would flip
 * between Preview and Edit mode mid-drag the instant the extending selection
 * touches the fence range, jolting the layout under the user's cursor.
 *
 * On `pointerdown` we snapshot the current selection ranges; while the
 * snapshot is non-null, `buildDecorations` evaluates the editMode predicate
 * against the *frozen* snapshot instead of the live selection. On
 * `pointerup`/`pointercancel`/blur we clear the snapshot and dispatch a
 * no-op `selection: state.selection` to nudge `foldExtension` to recompute
 * with the now-live selection.
 *
 * TODO(consolidation): the field, effects, and ViewPlugin below are
 * domain-neutral — `dragFrozenSelectionField` doesn't mention mermaid. If a
 * second block widget (table, image, future) needs the same "freeze
 * decoration choice across a pointer drag" behaviour, extract this section
 * into `editor-area/drag-selection-gate.ts` and have both decoration modules
 * import the shared field. Don't pre-extract — wait for the second consumer.
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
 * Annotation tag for the no-op selection nudge that paired with
 * `endDragEffect` to force `foldExtension` to rebuild. Tagged as a "select"
 * sub-event so any `transactionExtender`/`updateListener` keying off
 * `tr.isUserEvent("select")` for real user selection changes can opt out via
 * `tr.isUserEvent("select.pointer.drag-end")`.
 */
const DRAG_END_USER_EVENT = "select.pointer.drag-end";

/**
 * Pure predicate for the `pointerdown` listener. Returns the dispatch spec
 * to start the drag gate, or null to skip. Extracted so the filter logic
 * (primary-button-only, isPrimary, in-widget skip, idempotent re-entry) is
 * testable without mounting a real `EditorView`.
 *
 * The `.cm-mermaid-widget` skip is **load-bearing**, not redundant: the
 * canvas viewport's own `pointerdown` (`mermaid-canvas.ts:160`) calls
 * `e.preventDefault()` but does NOT `stopPropagation`, so canvas-internal
 * pointerdowns DO bubble to `contentDOM`. The Edit-code button only stops
 * `mousedown`, not `pointerdown` — so without this skip, every Edit-code
 * click would activate the gate and freeze `editMode` for the very toggle
 * the click is about to dispatch.
 */
function shouldStartDragGate(
  state: EditorState,
  event: { isPrimary: boolean; button: number; target: EventTarget | null },
): { effects: StateEffect<readonly SelectionRange[]> } | null {
  if (!event.isPrimary || event.button !== 0) return null;
  // Duck-type for `closest` rather than `instanceof Element` so this is
  // testable in a node environment (jsdom isn't pulled in for the unit
  // suite). Production targets always satisfy the duck check.
  const target = event.target as { closest?: (sel: string) => Element | null } | null;
  if (target && typeof target.closest === "function" && target.closest(".cm-mermaid-widget")) {
    return null;
  }
  if (state.field(dragFrozenSelectionField, false) !== null) return null;
  return { effects: startDragEffect.of(state.selection.ranges) };
}

/**
 * Pure builder for the dispatch that ends a drag. Returns null when the gate
 * is already inactive (idempotent — `pointerup`/`pointercancel`/`blur` may
 * all fire for one drag, only the first should dispatch).
 *
 * The `selection: state.selection` is the load-bearing trick: prosemark's
 * `foldExtension` only rebuilds when `tr.docChanged || tr.selection` (see
 * `node_modules/@prosemark/core/dist/main.js:315`). Without the no-op
 * selection set, clearing the field would not retrigger
 * `buildDecorations`, so the widget would stay frozen in its pre-release
 * shape until the next genuine selection or doc change. If prosemark ever
 * tightens this to "selection actually changed," this trick breaks
 * silently — the test in `mermaid.test.ts` for the post-pointerup flip is
 * the canary.
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

const mermaidFoldExtension = foldableSyntaxFacet.of({
  nodePath: "FencedCode",
  // Without `keepDecorationOnUnfold`, `@prosemark/core`'s foldExtension
  // returns early as soon as the live selection touches the fence range and
  // never calls `buildDecorations` (see node_modules/@prosemark/core/dist/
  // main.js:300). That short-circuit is what would let the source flip into
  // view mid-drag — and it would also pre-empt our drag gate. With this flag
  // set, prosemark always delegates the decoration choice to us, so we own
  // the entire Preview/Edit decision and can hold it stable across a drag.
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node, selectionTouchesRange) => {
    const parsed = parseFencedCode(state, node);
    if (!parsed) return undefined;

    if (!parsed.info.trim().toLowerCase().startsWith("mermaid")) return undefined;

    const source = parsed.source.trim();
    if (!source) return undefined;

    // While a pointer drag-selection is active, evaluate editMode against the
    // pre-drag selection snapshot so the widget doesn't flip mid-drag. The
    // gate is cleared on pointerup, at which point the live selection is used.
    const frozen = state.field(dragFrozenSelectionField, false);
    const editMode = frozen ? rangesTouchInclusive(frozen, node) : selectionTouchesRange;

    const widget = new MermaidWidget(source, editMode);

    if (editMode) {
      // Selection overlaps the fence: show raw source, render the canvas as
      // a block widget below.
      return Decoration.widget({ widget, block: true }).range(node.to);
    }

    // Selection outside: replace the entire fence with the rendered canvas.
    return Decoration.replace({ widget, block: true, inclusiveStart: true }).range(
      node.from,
      node.to,
    );
  },
});

const mermaidTheme = EditorView.baseTheme({
  ".cm-mermaid-widget": {
    padding: `${WIDGET_VERTICAL_PADDING / 2}px 0`,
  },
  ".cm-mermaid-canvas": {
    position: "relative",
    height: `${MERMAID_CANVAS_HEIGHT}px`,
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    backgroundColor: "transparent",
    overflow: "hidden",
    outline: "none",
  },
  ".cm-mermaid-canvas:focus-visible": {
    outline: "2px solid var(--accent)",
    outlineOffset: "-2px",
  },
  ".cm-mermaid-canvas-viewport": {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
  },
  ".cm-mermaid-canvas-viewport.is-dragging": {
    cursor: "grabbing",
  },
  ".cm-mermaid-canvas-stage": {
    position: "absolute",
    top: "0",
    left: "0",
    transformOrigin: "0 0",
  },
  ".cm-mermaid-canvas-stage svg": {
    display: "block",
    maxWidth: "none",
  },
  // xychart series palette: keep all series close to the accent in hue and
  // lightness instead of the default rainbow shifts. beautiful-mermaid scopes
  // its own `--xychart-color-N` defaults to `svg { … }` (specificity 0,0,0,1);
  // this rule is 0,0,2,1 so it wins, and the derived `--xychart-bar-fill-N`
  // expressions (which read `--xychart-color-N` via color-mix) follow along
  // for free.
  ".cm-mermaid-canvas-stage svg[data-xychart-colors]": {
    "--xychart-color-1": "color-mix(in srgb, var(--accent) 45%, var(--fg-base) 55%)",
    "--xychart-color-2": "color-mix(in srgb, var(--accent) 20%, var(--fg-base) 80%)",
    "--xychart-color-3": "color-mix(in srgb, var(--accent) 8%, var(--fg-base) 92%)",
    "--xychart-color-4": "color-mix(in srgb, var(--accent) 4%, var(--fg-base) 96%)",
    "--xychart-color-5": "color-mix(in srgb, var(--accent) 2%, var(--fg-base) 98%)",
    "--xychart-color-6": "var(--fg-base)",
    "--xychart-color-7": "var(--fg-base)",
  },
  ".cm-mermaid-canvas-edit, .cm-mermaid-canvas-zoom-btn": {
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    backgroundColor: "var(--surface-card)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    font: "inherit",
    lineHeight: "1",
    opacity: "0",
    transition: "opacity 120ms ease-out, background-color 120ms ease-out, color 120ms ease-out",
  },
  ".cm-mermaid-canvas:hover .cm-mermaid-canvas-edit, .cm-mermaid-canvas:focus-within .cm-mermaid-canvas-edit, .cm-mermaid-canvas:hover .cm-mermaid-canvas-zoom-btn, .cm-mermaid-canvas:focus-within .cm-mermaid-canvas-zoom-btn":
    {
      opacity: "1",
    },
  ".cm-mermaid-canvas-edit:hover, .cm-mermaid-canvas-zoom-btn:hover": {
    backgroundColor: "var(--surface-subtle)",
    color: "var(--text-primary)",
  },
  ".cm-mermaid-canvas-edit": {
    position: "absolute",
    top: "8px",
    right: "8px",
    padding: "5px 10px",
    fontSize: "12px",
  },
  ".cm-mermaid-canvas-zoom": {
    position: "absolute",
    bottom: "8px",
    right: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  ".cm-mermaid-canvas-zoom-btn": {
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    padding: "0",
  },
  // Errors render inside the canvas frame (the .cm-mermaid-canvas class is
  // kept on the host) — this just centres the error text and switches its
  // colour so the frame border + fixed height stay intact.
  ".cm-mermaid-canvas.cm-mermaid-error": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.5em 1em",
    color: "var(--text-error, #ff6b6b)",
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: "0.85em",
    textAlign: "center",
  },
});

/**
 * Workaround: foldExtension only rebuilds on docChanged/selection, not on syntax
 * tree progression. When the incremental parser finishes after initial load, folds
 * stay stale. This plugin detects tree changes and nudges a rebuild.
 * (Same pattern as table-decorations.ts)
 */
const foldTreeSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) !== syntaxTree(update.startState)) {
        setTimeout(() => {
          update.view.dispatch({ selection: update.view.state.selection });
        });
      }
    }
  },
);

export function mermaidDecorations() {
  return [
    dragFrozenSelectionField,
    dragSelectionPlugin,
    mermaidFoldExtension,
    mermaidTheme,
    foldTreeSync,
  ];
}

// Exported for tests.
export {
  DRAG_END_USER_EVENT,
  buildEndDragDispatch,
  dragFrozenSelectionField,
  endDragEffect,
  rangesTouchInclusive,
  shouldStartDragGate,
  startDragEffect,
};
