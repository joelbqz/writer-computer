# Mermaid Fullscreen Diagram Spec

## Summary

Add an "expand" button to the mermaid canvas widget that opens the rendered
diagram in a viewport-sized `<dialog>`. The fullscreen view reuses the same
pan/zoom canvas, so users can explore detail on large or dense diagrams
without leaving the document.

## Goals

- One-click way to view a mermaid diagram at full viewport size.
- Reuse the existing canvas pan/zoom controls inside the fullscreen view —
  no second control surface to learn or maintain.
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

- Expand affordance: an "⛶" icon button in the existing top-right control
  cluster, to the left of "Edit code". Fades in on hover/focus like the
  other controls.
- Fullscreen dialog: native `<dialog>` opened with `showModal()`. Esc, the
  ✕ close button, or a click on the backdrop dismisses.
- Backdrop: `--bg-base` at 70% opacity with a 4px blur, so the document
  underneath stays faintly visible as a contextual anchor.
- Inside the dialog, controls (close, zoom) are persistently visible (no
  hover-to-reveal) — the dialog is a deliberate, focused view, so the
  affordances should be obvious on first paint.

## Implementation Notes

- New module `mermaid-fullscreen.ts` exports `openMermaidFullscreen(source,
  ariaLabel)`. It renders the SVG via `renderMermaid` (cached), creates a
  `<dialog class="cm-mermaid-fullscreen">`, mounts a fresh canvas host
  inside it via `mountMermaidCanvas`, calls `dialog.showModal()`, and
  removes the dialog from the DOM on `close`.
- `mountMermaidCanvas` now accepts optional `onToggleEdit`, `onExpand`, and
  `onClose` callbacks. Each present callback mounts the matching button in
  a shared top-right cluster (`.cm-mermaid-canvas-top`). The in-editor
  widget wires `onToggleEdit` + `onExpand`; the fullscreen dialog wires
  only `onClose`.
- All canvas styles moved from `EditorView.baseTheme` into
  `mermaid-canvas.css`. The base theme scopes selectors under the editor's
  root class, so its rules don't reach a `<dialog>` mounted at
  `document.body`. The CSS file is imported by `mermaid-decorations.ts`
  (which is already loaded as part of the editor extensions), so the
  stylesheet ships exactly once.
- The fullscreen canvas reuses `fitToViewport`, so a freshly opened dialog
  always starts with the diagram centered and scaled to fill the viewport.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/mermaid-canvas.ts` — optional
  toggle/expand/close callbacks, shared top-right control cluster.
- `apps/desktop/src/components/editor-area/mermaid-decorations.ts` — wire
  `onExpand`, drop the in-source `baseTheme`, import the CSS file.
- new `apps/desktop/src/components/editor-area/mermaid-fullscreen.ts` —
  dialog open/teardown.
- new `apps/desktop/src/components/editor-area/mermaid-canvas.css` —
  consolidated widget + dialog stylesheet.

## Acceptance Criteria

- Hovering or focusing a mermaid widget reveals an "⛶" button next to the
  "Edit code" toggle.
- Clicking the expand button opens a fullscreen dialog containing the same
  diagram with the same pan/zoom controls.
- Pressing Esc, clicking the ✕ button, or clicking the dialog backdrop
  closes the dialog and returns focus to the editor.
- The fullscreen dialog respects the active theme (light/dark) without
  re-rendering the SVG.
- The in-editor widget, including its existing pan/zoom and edit toggle,
  continues to behave as before.
