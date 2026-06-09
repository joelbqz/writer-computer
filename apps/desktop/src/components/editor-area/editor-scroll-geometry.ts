import type { EditorView } from "@codemirror/view";

/* Writer's editor delegates scrolling to an ancestor: `.cm-scroller` is
   `overflow: visible` and the surrounding `EditorScrollContainer` owns the
   scrollbar (see docs/editor.md). These helpers are the single source of
   truth for locating that scroller and converting between document pixels
   and scroller offsets. */

export function findScrollContainer(root: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = root.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function findOuterScroller(view: EditorView): HTMLElement | null {
  return findScrollContainer(view.dom);
}

/* A scroll position expressed as content, not pixels: the line block whose
   `from` is `pos`, scrolled `offsetPx` past the top of the scroller's
   content area (negative = the block top sits below the content top).
   Pixel offsets go stale whenever the heightmap re-estimates (doc swap,
   reload); anchors re-resolve against the current heightmap. */
export interface ScrollAnchor {
  pos: number;
  offsetPx: number;
}

// Screen Y where the scroller's content area starts. `clientTop` matters:
// EditorScrollContainer has a 12px transparent border-top.
export function scrollerContentTop(scroller: HTMLElement): number {
  return scroller.getBoundingClientRect().top + scroller.clientTop;
}

/* scrollTop that puts `docPixel` (document coordinates — the space of
   `view.lineBlockAt(pos).top`, 0 = top of the first line) at the top of
   the scroller's content area, clamped to the scrollable range. The same
   `view.documentTop + block.top` layout-model math as the search
   scrollHandler (see docs/editor.md). */
export function scrollTopForDocPixel(
  view: EditorView,
  scroller: HTMLElement,
  docPixel: number,
): number {
  const delta = view.documentTop + docPixel - scrollerContentTop(scroller);
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return Math.max(0, Math.min(scroller.scrollTop + delta, max));
}

/* The anchor currently at the top of the scroller's content area.
   `lineBlockAtHeight` forces a synchronous measure — call this at
   navigation time (swap/unmount/warm-up), never per scroll event. */
export function deriveScrollAnchor(view: EditorView, scroller: HTMLElement): ScrollAnchor {
  const docPixel = scrollerContentTop(scroller) - view.documentTop;
  const block = view.lineBlockAtHeight(docPixel);
  return { pos: block.from, offsetPx: docPixel - block.top };
}

// Where the scroller should sit to put `anchor` back at the content top,
// resolved against the current heightmap. Clamps pos for shrunk docs.
export function resolveScrollAnchorTop(
  view: EditorView,
  scroller: HTMLElement,
  anchor: ScrollAnchor,
): number {
  const pos = Math.min(anchor.pos, view.state.doc.length);
  const block = view.lineBlockAt(pos);
  return scrollTopForDocPixel(view, scroller, block.top + anchor.offsetPx);
}
