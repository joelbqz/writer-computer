# List Selection and TODO Checkbox Regression

## Problem

Drag-selecting across bullet list lines could briefly snap the selection head to
the list prefix boundary instead of the text under the pointer. The root cause
was list prefix rendering with `Decoration.replace` widgets: CodeMirror's
`posAtCoords` scan could choose the replace boundary (`widgetTo`) while the
pointer was over body text.

The point-widget refactor fixes that for bullets by rendering list prefixes as
`Decoration.widget({ side: -1 })` plus a hidden source-prefix mark. TODO lines
then exposed a separate regression because their checkbox still used a native
`<input>` inside a wrapper. The input could take focus or pointer handling from
the editor during drag-selection, and nested checkboxes were visually pinned to
the wrapper's left edge instead of the nested list slot.

## Behavior

- Bullet and task prefixes render as point widgets, not replace widgets.
- Source prefix chars remain in the document and are hidden with
  `.cm-list-prefix-hidden`, so editing and Backspace semantics still operate on
  real source text. The hidden prefix keeps 1px text metrics inside a clipped
  zero-inline-width box so WebKit can still measure the line for CodeMirror's
  drawn selection layer.
- TODO checkboxes render as a single non-native `.cm-checkbox` span. The visual
  square and checkmark are CSS on `::before`; checked state is represented by a
  `cm-checkbox-checked` class.
- Nested checkboxes use the same depth-aware width and padding model as bullet
  markers, so their visual slot aligns with nested bullets and wrapped body
  text. The checkbox square is vertically centered in the editor line box so it
  sits optically centered against the task text.
- Clicking a checkbox toggles the source `[ ]` / `[x]`. The handler falls back
  to line-based task detection so nested toggles do not depend on where
  `posAtDOM` resolves inside the point widget.

## Validation

- Drag-select straight up and down across bullet and TODO lines; the selection
  head should track the pointer without jumping to the list prefix column.
- Select only the body text of a TODO line; the TODO text should receive the
  same visible `.cm-selectionBackground` highlight as bullet body text.
- Drag across a task checkbox; the editor selection should continue instead of
  losing focus to a native input.
- Toggle top-level and nested task checkboxes.
- Verify nested task checkboxes align with nested bullet markers.
- Run `vp check` and `vp test --run`.
