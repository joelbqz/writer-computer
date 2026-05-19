# Mermaid Fullscreen Diagram Spec

## Summary

Add an "expand" button to the mermaid canvas widget that opens the rendered
diagram in a viewport-sized overlay. The fullscreen view reuses the same
pan/zoom canvas, so users can explore detail on large or dense diagrams
without leaving the document.

## Goals

- One-click way to view a mermaid diagram at full viewport size.
- Reuse the existing canvas pan/zoom controls inside the fullscreen view —
  no second control surface to learn or maintain.
- Include the same reset-to-fit control as the inline canvas so users can
  recover from exploratory panning/zooming without closing the overlay.
- Close via `Esc`, a close button, or backdrop click.
- Theme-aware: dialog background, border, and controls follow the same CSS
  custom properties as the in-editor canvas.

## Non-Goals

- Editing the diagram from the fullscreen view. The dialog is a read-only,
  enlarged view; "Edit code" stays on the in-editor canvas.
- Persisting pan/zoom across open/close cycles. Each open re-fits the
  diagram to the dialog's viewport, mirroring the in-editor first-paint
  behavior.

## UX Decisions

- Expand affordance: an "⛶" icon button at the top of the bottom-right
  vertical cluster, directly above the `+` / `−` zoom buttons. Fades in
  on hover/focus like the other controls.
- Fullscreen overlay: a fixed-position `<div>` (`position: fixed; inset:
0; z-index: 9999`) appended to `document.body`. Esc, the ✕ close
  button, or a click on the backdrop dismisses.
- Backdrop: `--bg-base` at 92% opacity with a 4px blur, so the document
  underneath stays faintly visible as a contextual anchor.
- Inside the overlay, controls (close, reset, zoom) are persistently visible (no
  hover-to-reveal) — the fullscreen view is a deliberate, focused view,
  so the affordances should be obvious on first paint.

## Implementation Notes

- New module `mermaid-fullscreen.ts` exports `openMermaidFullscreen(source,
ariaLabel)`. It renders the SVG via `renderMermaid` (cached), creates a
  `<div class="cm-mermaid-fullscreen">` with `role="dialog"` and
  `aria-modal="true"`, mounts a fresh canvas host inside it via
  `mountMermaidCanvas`, appends the overlay to `document.body`, and
  removes it on close. A capture-phase `keydown` listener on `document`
  handles Esc so the editor never sees the event. Focus is restored to
  the previously-focused element on close.
- `mountMermaidCanvas` accepts optional `onToggleEdit`, `onExpand`, and
  `onClose` callbacks. Each present callback mounts the matching button:
  toggle/close in the top-right cluster, expand at the top of the
  bottom-right vertical cluster (above zoom). The in-editor widget wires
  `onToggleEdit` + `onExpand`; the fullscreen overlay wires only
  `onClose`.
- All canvas styles moved from `EditorView.baseTheme` into
  `mermaid-canvas.css`. The base theme scopes selectors under the editor's
  root class, so its rules wouldn't reach the overlay mounted at
  `document.body`. The CSS file is imported by `mermaid-decorations.ts`
  (which is already loaded as part of the editor extensions), so the
  stylesheet ships exactly once.
- The fullscreen canvas reuses `fitToViewport`, so a freshly opened
  overlay always starts with the diagram centered and scaled to fill
  the viewport.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/mermaid-canvas.ts` — optional
  toggle/expand/close callbacks, shared top-right control cluster.
- `apps/desktop/src/components/editor-area/mermaid-decorations.ts` — wire
  `onExpand`, drop the in-source `baseTheme`, import the CSS file.
- new `apps/desktop/src/components/editor-area/mermaid-fullscreen.ts` —
  overlay open/teardown.
- new `apps/desktop/src/components/editor-area/mermaid-canvas.css` —
  consolidated widget + overlay stylesheet.

## Acceptance Criteria

- Hovering or focusing a mermaid widget reveals an "⛶" button above the
  zoom controls.
- Clicking the expand button opens a fullscreen overlay containing the
  same diagram with the same pan/zoom controls.
- Pressing Esc, clicking the ✕ button, or clicking the backdrop closes
  the overlay and returns focus to the previously-focused element.
- The fullscreen overlay respects the active theme (light/dark) without
  re-rendering the SVG.
- The in-editor widget, including its existing pan/zoom and edit toggle,
  continues to behave as before.
