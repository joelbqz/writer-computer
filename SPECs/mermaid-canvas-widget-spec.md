# Mermaid Canvas Widget Spec

## Summary

Render mermaid fenced code blocks inside a fixed-height "canvas" widget — like an embedded canvas pane — with pan, zoom in/out, reset, and a toggle button that flips the widget back to source for editing. Today the widget grows to fit the rendered SVG, which makes large diagrams dominate the document and makes small ones awkwardly stretched. A bounded viewport with viewport controls keeps documents scannable while still letting users explore detail.

## Goals

- Render every mermaid block inside a fixed-height, full-width container regardless of the diagram's natural size.
- Provide pan (drag) and zoom (in / out / reset to fit) controls inside the widget.
- Provide a small toggle button on the widget that enters "edit code" mode (reveals the fenced source) and another to return to the rendered diagram.
- Render synchronously per widget against a bounded cache so scrolling and theme switches stay smooth without an IntersectionObserver-driven deferral that can miss transitions.
- Keep the widget keyboard-accessible: focusable container, arrow-key pan, `+` / `-` / `0` for zoom in / zoom out / reset, `Enter` to toggle edit mode.

## Non-Goals

- Editing the diagram visually (still text-based).
- Resizing the widget per-block (no inline height control in markdown).
- Exporting the rendered diagram (PNG/SVG export is out of scope for this spec).
- Cross-document widget state — pan/zoom resets when the widget remounts.

## UX Decisions

- Default widget height: 480px (single tunable constant).
- Diagram is initially rendered "fit to viewport" — scaled so the full SVG is visible inside the canvas with a small inset.
- Two corner control clusters: an "Edit code" pill in the top-right, and a vertical `+` / `−` zoom stack in the bottom-right. Both fade in on hover/focus and stay visible while the widget has focus. Reset-to-fit is keyboard-only (`0`) — no dedicated button. No live zoom % indicator.
- Pan: click-and-drag inside the canvas, or arrow keys when focused. Cursor changes to `grab` / `grabbing`.
- Zoom: mouse wheel with `⌘`/`Ctrl` modifier, pinch on trackpad, or the +/– buttons. Zoom range clamped (0.25× – 4×). Zoom anchors on the cursor position when using wheel/pinch, and on the viewport center when using buttons.
- "Edit code" toggle dispatches a **range selection covering the entire fence** (`EditorSelection.single(fenceTo, fenceFrom)`). The reverse-anchor convention matches `selectAllDecorationsOnSelectExtension` in `@prosemark/core`. `selectionTouchesRange` is overlap-based with inclusive bounds (`a.from <= b.to && b.from <= a.to`), so a range selection always flips the syntax facet into edit mode regardless of where the head lands inside the fence. The "Preview" affordance dispatches a caret at `fenceTo + 1` (clamped) so the selection no longer overlaps the fence range.
- Errors render inside the canvas frame (border + fixed height retained) with the error message centred and styled via the `cm-mermaid-error` modifier; controls are not mounted in the error path.

## Implementation Notes

- The canvas frame is a new module (`mermaid-canvas.ts`) mounted by the existing `MermaidWidget` in `mermaid-decorations.ts`. The widget's `toDOM` builds the host shell; once the SVG has rendered, `mountMermaidCanvas` attaches the viewport, controls, and event listeners. State (zoom, panX, panY) is held as a small mutable object inside the mount closure — no reducer; the surface is small enough that the indirection isn't worth it.
- Zoom is applied by resizing the SVG element directly (via its viewBox-derived natural width/height) so the browser re-renders the vector at each zoom step instead of caching a rasterised layer. Pan is applied via `transform: translate(...)` on the stage wrapper inside an `overflow: hidden` viewport.
- `estimatedHeight` returns the fixed canvas height + outer padding. No per-source height cache; the frame is height-stable from the first frame so the heightmap settles immediately.
- "Edit code" toggle resolves the FencedCode range live at click time via `view.posAtDOM(host)` + `syntaxTree.resolveInner(pos, 1)` walking up to the enclosing FencedCode node. No positions are captured on the widget instance and no `eq()` side-effect is needed — every dispatch reads current offsets from the live tree, eliminating an entire class of stale-position bugs.
- The widget's `eq()` compares only `source` + `editMode`. The diff treats source-or-mode changes as a rebuild and structurally identical widgets as reuse — straightforward and self-contained.
- Scroll is preserved across the dispatch via `view.scrollSnapshot()`. The snapshot captures the current viewport-top doc anchor and its screen offset; CodeMirror applies the resulting `StateEffect` after the heightmap rebuild and re-scrolls so the same anchor lands at the same screen Y. This is the canonical CM6 pattern for keeping scroll stable across decoration changes — robust to the heightmap shift caused by switching between replace-decoration (canvas only) and widget-decoration (source above + canvas below).
- Render is synchronous in `toDOM`: `beautiful-mermaid` is sync, the SVG cache makes repeat renders O(map lookup), and CodeMirror only calls `toDOM` for widgets in its viewport buffer. Mounting in the same frame the wrapper enters the DOM means there's no async gap that can leave the user stuck on a "Loading…" placeholder, and no IntersectionObserver to fire spuriously after a toggle (which previously caused a "click → flash of source → mermaid re-renders" blink).
- Renderer (`beautiful-mermaid`) emits a self-contained SVG whose theming flows from CSS custom properties — pass `bg: var(--bg-base)` / `fg: var(--fg-base)` / `transparent: true` and a single cached SVG works in both light and dark themes without re-rendering. The SVG output is sanitised (script blocks and `on*=` event handlers stripped) before cache insert as defense-in-depth.
- The SVG cache is bounded LRU (~50 entries) so a long session with many distinct mermaid sources does not leak.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/mermaid-decorations.ts` — widget mounts the canvas frame, swaps `estimatedHeight` to the fixed height, range-selection toggle.
- `apps/desktop/src/components/editor-area/mermaid-renderer.ts` — sync renderer, LRU cache, output sanitisation.
- new `apps/desktop/src/components/editor-area/mermaid-canvas.ts` — frame, controls, pan/zoom.
- `apps/desktop/tests/mermaid.test.ts` — coverage for fixed-height behaviour, sanitisation, and the range-selection toggle.

## Acceptance Criteria

- Every rendered mermaid block occupies the same fixed height, regardless of diagram size.
- Drag-pan and wheel-zoom (with `⌘`/`Ctrl` modifier) work inside the widget; the +/− zoom buttons work.
- Clicking the "Edit code" toggle selects the entire fence and reveals the source for editing; clicking "Preview" (or moving the caret out of the fence) returns to the rendered canvas. Cross-widget clicks don't interfere — each click resolves its own fence range live.
- Keyboard: focusing the widget enables arrow-key pan, `+` / `-` zoom, `0` reset-to-fit, and `Enter` toggle.
- Scrolling a long document with many diagrams stays smooth; the heightmap does not jump as widgets enter/leave the viewport.
- Theme switch flips diagram colours without a visible re-render (CSS custom properties resolve at paint time); errors render inside the canvas frame with the border and fixed height retained.
