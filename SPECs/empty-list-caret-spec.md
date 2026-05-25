# Empty List Caret Spec

## Problem

Empty unordered list items (`- `) and empty task items (`- [ ] `) can appear to
lose the blinking caret when the selection sits at the end of the marker. The
list renderer hides the source prefix with `.cm-list-prefix-hidden` and renders
the visual bullet or checkbox as a point widget. That works for lines with body
text because CodeMirror can measure the body text side of the caret. On an empty
item there is no body text, so the caret position is at the end of the hidden
zero-inline-width prefix and `coordsAtPos(..., side: 1)` has no visible inline
box to measure.

## Behavior

- Empty bullet and task list lines keep the visible marker/checkbox treatment
  used by non-empty list lines.
- The source marker stays real markdown text and remains hidden with the same
  clipped prefix span so Backspace, Enter, and checkbox toggles keep working.
- The bullet/checkbox marker point widget is anchored at the end of the hidden
  source prefix, so the existing marker provides a visible-layout coordinate
  target at the list body column when the item is empty.
- Non-empty list lines use the same marker anchoring and continue to use their
  body text as the normal text measurement target.

## Validation

- Place the caret after `- ` and after `- [ ] `; the caret should blink at the
  body column next to the bullet/checkbox.
- Type from each empty item; inserted text should appear after the marker with
  normal list alignment.
- Backspace and Enter on empty bullet/task lines should keep their existing
  behavior.
- Run `vp check` and `vp test`.
