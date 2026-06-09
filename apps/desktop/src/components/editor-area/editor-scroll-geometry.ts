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
