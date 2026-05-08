# Selection Rectangle Bleeds Past Text Across Block Widgets Spec

## Problem

Multi-line text selections in the editor render as a single giant filled
rectangle that extends well beyond the actual selected character range.
Instead of following the text-rope geometry (per-line runs clamped to
character bounds and to where the text column lives), the selection covers
surrounding side-padding on the page, the whitespace to the right of short
lines, and overlaps adjacent block widgets — most visibly the mermaid canvas
widget — as one solid coloured strip.

Reference: `/Users/joel/.claude/image-cache/19f92838-5102-477c-b602-e81dded59646/1.png`
shows a selection started near `### 4. Batch 2 Shapes` and dragged down to
inside the second mermaid fence (caret visible at `C --> D([Stadium])`). The
brown selection rectangle:

- starts above the heading and extends down to the caret line
- spans the full width of the editor's outer page area, well past where any
  text actually ends
- visually overlaps the first rendered mermaid canvas, the heading after it,
  and the top of the second fence — as one continuous rectangle rather than
  per-line runs

### Repro steps

1. Open a markdown document containing two short headings separated by a
   rendered mermaid fenced code block (any non-trivial `graph LR` works).
2. Click somewhere inside the first heading line and drag the selection
   down past the mermaid block, the next heading, and into the second
   mermaid block (or anywhere a few lines below the first heading).
3. Observe the selection background renders as one giant rectangle from the
   left page padding to the right page padding, vertically spanning every
   line and widget in between.

## Root Cause

Two interacting facts produce the giant rectangle:

### 1. Page side-padding is on `.cm-content`, not `.cm-line`

`apps/desktop/src/components/editor-area/prosemark-theme.css:60-66` puts the
4rem (`--writer-editor-side-padding`) horizontal page padding on
`.cm-content`:

```css
.cm-editor .cm-content {
  …
  max-width: var(--writer-editor-outer-width, calc(734px + 4rem + 4rem));
  margin: 0 auto;
  padding: 0 var(--writer-editor-side-padding, 4rem) 100px;
  …
}
```

`.cm-line` keeps the CodeMirror base-theme default, which is
`padding: 0 2px 0 6px` (see
`@codemirror/view@6.40.0/dist/index.js:6780-6783`).

### 2. CM6's `drawSelection` computes the between-line filler rect from `.cm-line` padding applied to `.cm-content`'s bounding rect

`drawSelection()` is enabled in
`apps/desktop/src/components/editor-area/use-prosemark-editor.ts:431`. It
delegates to `RectangleMarker.forRange` → `rectanglesForRange` in
`@codemirror/view@6.40.0/dist/index.js:9223-9253`:

```js
let lineElt = content.querySelector(".cm-line"),
    lineStyle = lineElt && window.getComputedStyle(lineElt);
let leftSide  = contentRect.left  + parseInt(lineStyle.paddingLeft);   // + 6
let rightSide = contentRect.right - parseInt(lineStyle.paddingRight);  // − 2
…
if (visualStart && visualEnd && visualStart.from == visualEnd.from && …) {
  return pieces(drawForLine(range.from, range.to, visualStart));
} else {
  let top    = visualStart ? drawForLine(range.from, null, visualStart) : drawForWidget(startBlock, false);
  let bottom = visualEnd   ? drawForLine(null, range.to,  visualEnd)   : drawForWidget(endBlock, true);
  let between = [];
  if (… spans more than one block …)
    between.push(piece(leftSide, top.bottom, rightSide, bottom.top));
  return pieces(top).concat(between).concat(pieces(bottom));
}
```

The "between" branch paints **one** rectangle from `leftSide` to `rightSide`
spanning vertically from the bottom of the first visual line to the top of
the last visual line. With our CSS:

- `contentRect.left` is the left edge of the whole `.cm-content` _box_,
  which already includes the 4rem of `padding-left` we added.
- `lineStyle.paddingLeft = 6px` (CM6 default on `.cm-line` — the writer's
  4rem is _not_ on `.cm-line`).
- So `leftSide = contentRect.left + 6` ≈ 6px from the editor's outer-page
  left edge, far to the **left** of where text actually starts (text starts
  another ~58px in, where cm-content's padding ends).
- Symmetrically on the right, `rightSide` lands ~2px from the page outer
  edge, far past where text ends.

The "between" filler therefore spans the **entire writer page width** —
plus is tall enough to cover every line and block widget between the start
and end visual lines. That's the giant brown rectangle in the screenshot.

### 3. Block widgets are transparent, so the rect shows through them

`mermaid-decorations.ts:218-225` styles `.cm-mermaid-canvas` with
`backgroundColor: "transparent"`. CodeMirror's selection `cm-layer` is
appended to `.cm-scroller` with `z-index: -1` (below `.cm-content`). Because
`.cm-content`, `.cm-line`, the mermaid wrapper, and the canvas are all
transparent, the selection rectangle is visible through the mermaid
widget — hence the appearance of the selection "covering" the rendered
mermaid block.

The hypothesis list in the task contained a number of plausible causes;
ruling them in/out:

- **(1)** `coordsAt` / `block: true` widget mis-measurement: not the cause.
  CM6 explicitly bypasses `drawForLine` for non-text blocks via
  `drawForWidget`, but in the screenshot both endpoints are on text lines —
  the consolidated "between" rect is the standard CM6 path.
- **(2)** Custom `drawSelection` replacement / custom selection layer:
  ruled out — `drawSelection()` is used as-is, no custom layer in the
  codebase.
- **(3)** Theme rule applying selection bg to a parent container: ruled
  out — `prosemark-theme.css:42-46` only colours `.cm-selectionBackground`
  and `::selection`, both correct selectors.
- **(4)** Accidental select-all: ruled out — the visible caret terminates
  inside the text, the selection has a real anchor and head.
- **(5)** Atomic block widgets confusing per-line iteration: ruled out —
  no `EditorView.atomicRanges` configured in the codebase, and CM6's
  per-line iteration only matters for the start/end lines, not the
  consolidated middle rect.

## Proposed Fix

The first attempt moved the page inset from `.cm-content` onto `.cm-line`,
expecting CM6's `lineStyle.paddingLeft/Right` to then clamp the
between-rect to the text column. That fixed the heading/paragraph case but
broke list items: `@prosemark/core`'s `softIndentExtension`
(`@prosemark/core/dist/main.js:1082-1100`) measures each list line's bullet
width at viewport time and applies an _inline_
`style="padding-inline-start: 22px; text-indent: -22px"` (or similar) on
the line. Inline styles win over CSS, so `lineStyle.paddingLeft` for any
line under softIndent control reverts to the small bullet-aligned value,
not the 4rem we wanted. Whichever line `content.querySelector(".cm-line")`
returns first determines the between-rect's left edge, and list-item text
on _other_ lines bleeds past it (visible in `5.png`: list bullets and
the start of list-item words sit to the left of the brown rectangle).

We can't reliably compose with prosemark's per-line inline padding from
CSS, so trying to drive the between-rect bounds via cm-line padding is the
wrong layer. Instead, **clip the selection painting to the text column at
the scroller**:

- Restore the original `.cm-content { padding: 0 var(--side-padding) 100px }`
  so list-item bullets remain in the text column visually (the original
  Writer aesthetic — softIndent's relative offsets compose with the
  cm-content inset and bullets land at `cm-content content-left + 6px`).
- Add `clip-path: inset(0 X)` on `.cm-scroller` where `X` is the
  computed text-column inset:
  ```
  X = max(
    var(--writer-editor-side-padding),
    (100% - var(--writer-editor-outer-width)) / 2 + var(--writer-editor-side-padding)
  )
  ```
  When the editor pane is wider than `--writer-editor-outer-width`,
  `cm-content` is centered inside the pane, so the text column starts at
  `(pane − outer)/2 + side-padding` from the scroller's left edge. When
  the pane is narrower, `cm-content` fills the pane and the text column
  starts at `side-padding`. The `max(…)` picks whichever applies.

`drawSelection` still computes its broken rect (we don't touch
`leftSide`/`rightSide`), but the parts that extend into the page-padding
gutters are simply not painted. Cursor and text already live inside the
clipped column, so nothing else changes.

This is a CSS-only change at a single declaration site. No JS / extension
modifications, no widget compensations, no blockquote bar adjustments.

### Why clip the scroller and not the layer

CM6's `cm-selectionLayer` is `position: absolute; left: 0; top: 0;
contain: size style` with no width/height — its box is 0×0, so a
`clip-path` on the layer itself would clip everything (or nothing,
depending on browser interpretation). The scroller has real dimensions
(it spans the editor pane horizontally and the document height vertically
via `overflow: visible !important`), and clipping at the scroller level
applies to the layer's painted descendants without needing to override
CM6's layer sizing.

### Why this doesn't affect anything other than the bug

Within `.cm-scroller`, the painted content is:

- `.cm-content`'s text — already inside the text column (cm-content has
  `4rem` padding on each side, so all text sits inside the clip area).
- `.cm-cursorLayer`'s cursor — at character coords, inside the text
  column.
- Block widgets (mermaid, table, html-block) — inside cm-content, inside
  the text column.
- Search match decorations — paint as inline backgrounds on cm-line text,
  inside the text column.
- `.cm-selectionLayer`'s rect — extends past the text column when the
  selection is multi-line. _This_ is the only thing the clip targets.

Anything painted outside the text column today is empty space. The clip
turns empty space into clipped empty space — no visible change.

## Edge Cases / Risks

- **List-item bullets at the clip boundary.** With cm-content padding
  4rem and softIndent's `padding-inline-start: indentWidth + 6;
text-indent: -indentWidth;`, a bullet renders at
  `cm-line.outer-left + 6` = `text-col-left + 6`, just inside the clip
  area. The bullet character is fully visible. (If softIndent's
  `text-indent` ever exceeded `indentWidth + 6` and pushed a bullet to
  `text-col-left - n`, that bullet would be partially clipped — not the
  case for any list pattern softIndent currently emits.)
- **`clip-path` creates a stacking context.** CM6 sets the selection
  layer's `z-index: -1` so it paints behind cm-content. After clip-path,
  cm-scroller becomes a stacking context, but the layer's
  `z-index: -1` still positions it behind cm-content within that stacking
  context. Cursor (`z-index: 150`) still paints above text. Verified by
  inspecting `cm-layer` styling at `@codemirror/view@6.40.0/dist/index.js:9349`.
- **Resize / pane width changes.** The clip inset is recomputed on every
  layout (CSS `calc` with `100%` reads the live element width). Both
  pane-wider-than-outer and pane-narrower-than-outer cases are covered by
  the `max(…)`.
- **Scroll position.** cm-scroller's height is the full document height
  (Writer's `overflow: visible !important` shifts scroll to the parent
  `EditorScrollContainer`). The clip-path's vertical extent is `0 0`
  (full height), so selection at any document position is fully visible
  vertically.
- **Mermaid edit mode.** Source lines inside an edit-mode fence render as
  ordinary `.cm-line`s — selection clipping behaves exactly like for any
  other text line.
- **RTL text.** Writer is LTR-only. The clip is symmetric (same inset on
  left and right), so it works for any text direction without
  modification.
- **Browser support.** `clip-path: inset()` and the `max()` /
  `calc(… 100% …)` combo are supported in WebKit (macOS) and Chromium
  (Windows), which covers Tauri's WebView.
- **Performance.** `clip-path` on a large container is composited by the
  browser; should not affect typing or scroll perf in practice. If a
  regression shows up under profiling, fall back to a manual selection
  layer (`Option K` in the discussion notes — copy-paste of CM6's
  `rectanglesForRange` with our own bounds).

## Test Plan

Manual verification with `vp dev`:

1. **No widgets, single line.** Click-drag a selection inside one
   paragraph. Selection rect stays within the character range of the
   selection — unchanged from before.
2. **No widgets, multi-line.** Drag a selection across two or three plain
   paragraphs. Confirm the between-line filler rectangle:
   - left edge stops at the start of the text column (where text begins on
     each line), not at the editor outer edge.
   - right edge stops at the end of the text column (where line wrap
     happens), not at the editor outer edge.
3. **Across one rendered mermaid block.** Place caret on the line above a
   rendered mermaid fence, drag selection down to a line below it.
   Confirm:
   - the filler rectangle is clamped to the text column horizontally.
   - the rectangle vertically covers the mermaid widget area (the widget
     is still under the selection — that is correct), but does not extend
     into the page padding columns to either side.
4. **Across two rendered mermaid blocks (the screenshot scenario).** Drag
   from the heading above the first fence down into the middle of the
   second fence. Confirm the same clamping; verify the second fence
   correctly enters edit mode (its source becomes visible — handled by
   existing `selectionTouchesRange` logic) without the selection rect
   suddenly jumping shape.
5. **Inside a mermaid in edit mode.** Click into the source of an
   edit-mode mermaid and drag a selection across a few code lines. Source
   lines are now `.cm-line`s, so selection should look like normal text
   selection clamped to the text column.
6. **Wrapped line.** Find or insert a paragraph long enough to wrap.
   Select across the wrap point. Confirm the selection rect breaks at the
   wrap column (not the page edge) on both visual lines.
7. **Empty line in the middle.** Selection across `text\n\ntext`. The
   blank visual line gets a thin rect inside the text column, not a
   full-width strip.
8. **Cmd-A / select-all.** Whole-document selection. Filler rect spans
   text column from top to bottom; widgets are vertically covered, not
   horizontally over-painted.
9. **Selection inside a code fence (non-mermaid).** Selection inside
   `text` or `js` blocks behaves the same — code lines are still
   `.cm-line`s.
10. **Light + dark themes.** Repeat (3) in both themes. Confirm the
    accent-derived `--editor-selection-bg` reads correctly against the
    page background and through any block widgets without any
    contrast regressions.

Automated coverage: not strictly required (this is a CSS-only geometry
change), but if `apps/desktop/tests/` already exercises `drawSelection`
geometry, update those snapshots / measurements to reflect the new
clamped left/right.
