# Code Block Horizontal Scroll Spec

## Goal

Fenced code blocks (and the frontmatter block, which shares their styling)
must never wrap. A line wider than the editor column is clipped and the whole
block scrolls horizontally, the way a rendered `<pre>` does on GitHub, instead
of breaking mid-token and destroying indentation.

## Constraints

- The editor runs `EditorView.lineWrapping` globally; code lines are `.cm-line`
  siblings under `.cm-content` with `.cm-fenced-code-line` line decorations.
  There is no wrapper element per block to make a scroll container out of.
- `drawSelection` paints the caret and selection in layers outside the lines.
  If a line scrolled natively (`overflow-x: auto`/`hidden`), those layers would
  not follow it until the next view update, and CodeMirror's own
  scroll-into-view would scroll single lines out of step with their block.

## Design

- Theme: `.cm-fenced-code-line` gets `white-space: pre` and `overflow-x: clip`.
  `clip` (not `hidden`) keeps the line from becoming a scroll container.
- State: `codeBlockScrollField` (`codeFenceScroll.ts`) holds one pixel offset
  per block, keyed by the block's start position. `setCodeBlockScroll` sets it;
  entries map through edits and are pruned when their position no longer
  starts a code block. An offset of zero removes the entry.
- Rendering: `codeFenceExtension` reads the field and adds
  `style="text-indent:-<offset>px"` to every line decoration of a scrolled
  block. Because it is a decoration, the rebuild goes through a transaction,
  which redraws the caret and selection layers.
- Input: a `wheel` handler on the content DOM intercepts horizontal-dominant
  gestures over a code line, clamps the new offset to the widest rendered line
  of the block minus the visible width, and dispatches the effect. Vertical
  gestures fall through to the page.
- Caret: on `selectionSet` / `geometryChanged` the plugin measures the main
  caret against its line's content box and dispatches the smallest offset
  change that reveals it (deferred with `setTimeout` because measure writes run
  inside the update cycle). The same pass clamps visible blocks whose offset
  exceeds their maximum after the editor widened.
- Scrollbar: lines aren't scroll containers, so there is no native scrollbar.
  A CodeMirror `layer` draws one thumb per overflowing block whose closing
  line is rendered, 3px above the block's bottom edge and spanning its content
  box. The thumb's width is the visible share of the content (at least 24px)
  and its position tracks the offset (`thumbGeometry`). Dragging it takes
  mouse moves on the window for the length of the drag and dispatches `setCodeBlockScroll`.

## Validation

- Unit tests (`tests/code-fence-scroll.test.ts`): block lookup, field
  set/remove/remap/prune, per-line `text-indent` decoration, geometry helpers
  (including thumb size and position), theme rules.
- E2E (`e2e/specs/code-block-scroll.spec.js`): long line renders unwrapped at
  the same height as a short one; a synthetic horizontal wheel scrolls all
  lines together; the offset clamps at the widest line and returns to zero;
  moving the caret to the end of the long line reveals it; the thumb sits on
  the block's bottom edge at the scrolled position, and dragging it to the
  start scrolls the block back to zero.
