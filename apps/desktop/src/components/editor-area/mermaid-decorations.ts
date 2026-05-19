import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { foldableSyntaxFacet } from "@/lib/prosemark-core/main";
import { renderMermaid } from "./mermaid-renderer";
import { MERMAID_CANVAS_HEIGHT, mountMermaidCanvas } from "./mermaid-canvas";
import { openMermaidFullscreen } from "./mermaid-fullscreen";
import "./mermaid-canvas.css";
import {
  DRAG_END_USER_EVENT,
  buildEndDragDispatch,
  dragFrozenSelectionField,
  endDragEffect,
  rangesTouchInclusive,
  shouldStartDragGate,
  startDragEffect,
} from "./drag-selection-gate";

// Outer widget padding (top + bottom). `mermaid-canvas.css` splits this
// evenly across top/bottom so `estimatedHeight` matches the rendered box.
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
    const ariaLabel = `Mermaid diagram: ${this.source.split("\n")[0]}`;
    const onExpand = () => openMermaidFullscreen(this.source, ariaLabel);

    // Synchronous render. beautiful-mermaid is sync and the SVG cache makes
    // repeat calls O(map lookup), so the wrapper paints with its final SVG in
    // the same frame it enters the DOM — no IntersectionObserver, no async
    // gap that can leave the user stuck on a placeholder.
    const result = renderMermaid(this.source);
    if (result.svg) {
      mountMermaidCanvas(host, {
        svgHtml: result.svg,
        ariaLabel,
        editMode: this.editMode,
        onToggleEdit,
        onExpand,
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
  // `dragFrozenSelectionField` is also part of `dragFreezeExtensions` (mounted
  // once globally in `use-prosemark-editor.ts`). Including it here makes the
  // mermaid spec self-contained: callers/tests that wire `mermaidDecorations()`
  // into a state without the global gate still get the field they need. State
  // fields dedupe by identity, so the duplicate is a no-op in production.
  return [dragFrozenSelectionField, mermaidFoldExtension, foldTreeSync];
}

// Re-exported for tests — actual definitions live in `./drag-selection-gate`.
export {
  DRAG_END_USER_EVENT,
  buildEndDragDispatch,
  dragFrozenSelectionField,
  endDragEffect,
  rangesTouchInclusive,
  shouldStartDragGate,
  startDragEffect,
};
