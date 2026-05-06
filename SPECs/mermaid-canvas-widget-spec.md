# Mermaid Canvas Widget Spec

## Summary

Render mermaid fenced code blocks inside a fixed-height "canvas" widget — like an embedded canvas pane — with pan, zoom in/out, reset, and a toggle button that flips the widget back to source for editing. Today the widget grows to fit the rendered SVG, which makes large diagrams dominate the document and makes small ones awkwardly stretched. A bounded viewport with viewport controls keeps documents scannable while still letting users explore detail.

## Goals

- Render every mermaid block inside a fixed-height, full-width container regardless of the diagram's natural size.
- Provide pan (drag) and zoom (in / out / reset to fit) controls inside the widget.
- Provide a small toggle button on the widget that enters "edit code" mode (reveals the fenced source) and another to return to the rendered diagram.
- Preserve the existing lazy-render, theme-sync, and cached-height behaviour so scrolling and theme switches stay smooth.
- Keep the widget keyboard-accessible: focusable container, arrow-key pan, `+` / `-` / `0` for zoom in / zoom out / reset, `Enter` to toggle edit mode.

## Non-Goals

- Editing the diagram visually (still text-based).
- Resizing the widget per-block (no inline height control in markdown).
- Exporting the rendered diagram (PNG/SVG export is out of scope for this spec).
- Cross-document widget state — pan/zoom resets when the widget remounts.

## UX Decisions

- Default widget height: ~360px (single tunable constant; revisit after dogfooding).
- Diagram is initially rendered "fit to viewport" — scaled so the full SVG is visible inside the canvas with a small inset.
- A floating control cluster sits in the bottom-right of the widget: zoom out, zoom %, zoom in, reset, and an "Edit code" toggle. Controls fade in on hover/focus and stay visible while the widget has focus.
- Pan: click-and-drag inside the canvas, or arrow keys when focused. Cursor changes to `grab` / `grabbing`.
- Zoom: mouse wheel with `⌘`/`Ctrl` modifier, pinch on trackpad, or the +/– buttons. Zoom range clamped (e.g. 0.25× – 4×). Zoom anchors on the cursor position when using wheel/pinch, and on the viewport center when using buttons.
- "Edit code" toggle behaves the same as moving the caret into the fence today: the rendered widget collapses, the source becomes editable, and a "Done" / "Preview" affordance returns to the rendered view. This must reuse the existing `selectionTouchesRange` path rather than introducing a parallel mode.
- Errors render inside the canvas frame using the existing `cm-mermaid-error` style, with controls hidden.

## Implementation Notes

- The canvas frame is a new component (`MermaidCanvas`) owned by the existing `MermaidWidget` in `mermaid-decorations.ts`. The widget's `toDOM` mounts the frame; the frame manages its own pan/zoom state via a small reducer.
- Pan/zoom is applied via a CSS `transform: translate(...) scale(...)` on the SVG wrapper inside an `overflow: hidden` viewport. Avoid touching the SVG's intrinsic attributes so the cached `getCachedHeight` path stays meaningful for the frame's outer height.
- Replace `estimatedHeight` lookup so it returns the fixed canvas height instead of the cached SVG height. The current per-source height cache becomes irrelevant for the outer widget, but keep it for the inner SVG so "fit to viewport" can compute an accurate initial scale before the SVG measures.
- "Edit code" toggle dispatches a CodeMirror selection change that places the caret inside the fenced node — that already triggers `selectionTouchesRange` and re-renders the source. Do not invent a new decoration mode.
- IntersectionObserver-based lazy render stays as-is.
- Theme sync stays as-is; on theme change the widget rebuilds, pan/zoom resets to fit (acceptable trade-off given how rare theme toggles are mid-session).
- Pan/zoom must not capture editor shortcuts when the widget is not focused.
- Keep all event listeners on the wrapper element so `destroy()` can release them along with the IntersectionObserver.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/mermaid-decorations.ts` — widget mounts the canvas frame, swaps `estimatedHeight` to the fixed height.
- `apps/desktop/src/components/editor-area/mermaid-renderer.ts` — no functional change expected; possibly export a helper for measuring the rendered SVG's intrinsic size for "fit to viewport".
- new `apps/desktop/src/components/editor-area/mermaid-canvas.ts` — frame, controls, and pan/zoom reducer.
- `apps/desktop/tests/mermaid.test.ts` — add coverage for fixed-height behaviour and edit-toggle dispatch.

## Acceptance Criteria

- Every rendered mermaid block occupies the same fixed height, regardless of diagram size.
- Drag-pan and wheel-zoom (with modifier) work inside the widget; +/–/reset buttons in the control cluster work; a zoom % indicator updates live.
- Clicking the "Edit code" toggle reveals the fenced source for editing; clicking "Preview" (or moving the caret out of the fence) returns to the rendered canvas.
- Keyboard: focusing the widget enables arrow-key pan and `+` / `-` / `0` zoom; `Enter` toggles edit mode.
- Scrolling a long document with many diagrams stays smooth; the heightmap does not jump as widgets enter/leave the viewport.
- Theme switch still re-renders diagrams correctly; errors render inside the canvas frame.
