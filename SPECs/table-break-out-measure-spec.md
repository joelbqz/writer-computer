# Table Break-Out of the Editor Measure Spec (Phase B)

## Summary

A rendered markdown table was capped at the editor measure, so a dense
reference table was compressed into prose width no matter how wide the window
was. Phase B lets a table that is naturally wider than the measure grow past it,
centred, up to the pane minus a gutter — the way docs sites let wide media break
out of the prose column — and scroll inside its own box past that, so the
document itself never scrolls sideways.

Phase A (`table-column-sizing-spec.md`) stopped columns starving inside the
measure. Phase B is the width the measure could not give them.

## Goals

- A table wider than the measure grows wider than the measure, centred on it
  (equal overhang both sides), up to `pane − 2 × --writer-editor-breakout-gutter`.
- A table that already fits renders exactly as before: same width, still flush
  with the left edge of the measure.
- Past the ceiling the table scrolls inside `.cm-table-inner`. The document pane
  never gains a horizontal scrollbar.
- Only the rendered widget breaks out. A touched table unfolds to ordinary
  source lines inside the normal measure.

## Non-Goals

- JS/`colgroup` per-column width computation (Phase C).
- Changing the per-cell `max-width` cap — re-measured here, deliberately kept.

## Implementation

Three small pieces.

**1. The pane width, published from React.** `use-editor-settings.ts` observes
the editor pane and writes `--writer-editor-pane-width`. CSS cannot read it:
inside the editor every percentage resolves against `.cm-content`, which is the
width-capped box, and making an ancestor of the CodeMirror DOM a container-query
container would also make it the containing block for CM's fixed-position
tooltips. Until the first observation lands the var is unset and the break-out
width falls back to the measure, so nothing ever overhangs unmeasured.

**2. The widget boxes** (`table-decorations.ts`):

```
.cm-table-widget  display: flex; justify-content: center
.cm-table-inner   min-width: 100%; width: max-content;
                  max-width: max(100%, calc(pane − 2 × gutter));
                  flex: none; overflow-x: auto
.cm-table-widget table   width: max-content
```

- `min-width: 100%` is what keeps a narrow table unchanged: the box spans the
  measure, the table inside it is still shrink-wrapped and flush left.
- `justify-content: center` on an item that overflows its flex line overflows it
  evenly on both sides — that is the centred overhang, with no negative margins
  or transforms, so `posAtDOM`, hit-testing and the block-widget contract are
  untouched.
- `flex: none` stops the flex layout shrinking the box back to the measure.
- `width: max-content` on the table itself is the point of the change. An `auto`
  table shrinks to whatever box it is given — that _is_ the compression. At
  max-content every column takes the width it asks for (bounded per cell by
  `tableCellMaxWidthCh`) and the box scrolls if the total doesn't fit.

**3. The scroller clip** (`prosemark-theme.css`). `.cm-scroller`'s `clip-path`
clipped to the text column, which would have cut the overhang off. Both insets
are now relaxed to the break-out gutter via `min(…)`. This does not re-open the
selection-rect bleed that clip was added for: `.cm-selectionLayer` clips the
rect symmetrically at the strict text-col inset, and everything else painted
outside the text column is empty space (see
`selection-rect-bleeds-past-text-spec.md`). The relaxed clip stays as a backstop
so nothing can paint into the pane edges.

### Why the gutter is 4rem

It has to clear the section rail, whose ticks sit 18–52px in from the pane edge
(`section-rail.tsx`), so ≥ 52px. 4rem = 64px is the next round value and leaves
12px of clearance. It also equals the largest `--writer-editor-side-padding`,
which makes `appearance.editor-width: full` a no-op by construction (below).

## Measurements

All in the real WKWebView through `apps/desktop/e2e`, sidebar at its default
240px. "Window 1600" therefore means pane 1360, measure 734, ceiling
1360 − 128 = 1232.

### Break-out, window 1600

| fixture table            | natural width | box width | overhang/side | scrolls |
| ------------------------ | ------------- | --------- | ------------- | ------- |
| 2-column key/value       | 151           | 734       | 0             | no      |
| 3-column, one prose col  | 834           | 834       | 50            | no      |
| 7-column dense reference | 1011          | 1011      | 138           | no      |
| 8-column wide reference  | 1208          | 1208      | 237           | no      |
| 3-column, 64-char digest | 668           | 734       | 0             | no      |

Overhang is even to the pixel on every table that breaks out, and the widest
lands 1524px from the pane's left edge — inside the 1536px gutter line. The pane
and the editor scroller report no horizontal overflow at any width tested
(1600 / 1280 / 1000 / 860).

### The 48ch cell cap: kept, not scaled

The cap bounds how much width one column may demand. With break-out it also
decides how wide the table gets, and therefore whether it needs to scroll.
Window 1600, ceiling 1232 — table widths, then heightmap drift over the whole
fixture:

| cap  | 3-col | 7-col | 8-col | 2-col prose | tables scrolling | drift total / max |
| ---- | ----- | ----- | ----- | ----------- | ---------------- | ----------------- |
| 32ch | 678   | 855   | 1051  | 465         | 0                | 630 / 240         |
| 40ch | 756   | 933   | 1129  | 543         | 0                | 454 / 174         |
| 48ch | 834   | 1011  | 1208  | 621         | 0                | 344 / 130         |
| 64ch | 990   | 1167  | 1260  | 778         | 1                | 238 / 108         |
| 80ch | 1146  | 1292  | 1260  | 934         | 2                | 92 / 64           |
| none | 2224  | 1292  | 1260  | 1334        | 4                | 12 / 2            |

48ch is the largest cap at which **every** fixture table reaches its natural
width with no scrolling at all: the widest is 1208 against a 1232 ceiling. 64ch
pushes one table into scrolling, 80ch two, uncapped four — and uncapped also
puts a single prose column at 1859px on one line, which is not a line anyone
reads. Raising the cap trades wrapping for horizontal scrolling, which is the
worse of the two: wrapped text is still readable in place.

Scaling the cap with the available width does not pay at the other end either.
At window 1000 (measure 680, no break-out room) the number of tables that have
to scroll is 2 at 32ch and 3 at both 40ch and 48ch — so shrinking the cap on a
narrow pane buys one table, at the price Phase A already measured and rejected:
the 3-column table grows from 250px to 360px tall and reads as stunted. The cap
stays a flat `48ch`, and with it Phase A's protection against pathological
tokens: the 64-character digest column is clamped at 469px in every variant
except `none`.

### Heightmap drift: better, not worse

`estimateTableWidgetHeight` still assumes one visual line per row. Measured on
the same fixture at window 1600, summing |actual − estimated| per table:

|                               | total drift | largest single |
| ----------------------------- | ----------- | -------------- |
| Phase A layout (no break-out) | 944px       | 425px          |
| Phase B (break-out)           | **344px**   | **130px**      |

Break-out means wider tables, wider tables wrap less, and less wrapping is
exactly what the estimate assumes. Phase B claws back Phase A's regression and
then some — 64% less total drift, 69% smaller worst jump. The estimator itself
is unchanged; a wrapping-aware one still needs column widths, which is Phase C.

### `appearance.editor-width: full`

A no-op for break-out, verified two ways. The ceiling is `pane − 128` and full's
measure is `pane − 2 × side-padding` where side-padding tops out at exactly 4rem,
so at a wide window the ceiling equals the measure (both 1232 at window 1600) and
at a narrow one it is smaller, and the `max(100%, …)` floor pins the box to the
measure. Emulated at window 1600: every table's box is 1232, overhang 0,
nothing scrolls.

**Note — the setting does not currently reach the layout at all.** App.css
composes `--writer-editor-outer-width` on `:root`, and var() references inside a
custom property are substituted where the property is _declared_. The per-pane
override of `--writer-editor-max-width` in `use-editor-settings.ts` is therefore
inert, and `.cm-content` is pinned to the `:root` default of 734px in both modes
(observed: `--writer-editor-max-width` computes to `720px` on `.cm-content`
while `--writer-editor-outer-width` still reads `calc(734px + …)`). That is a
pre-existing bug, out of scope here, and it is also why this spec's break-out
width is composed at its point of use instead of in a `:root` shorthand.

### The scroll affordance

`overflow-x: auto` plus `overscroll-behavior-x: contain` (so flicking a table
does not chain to the document or trigger a back-swipe) and
`scrollbar-gutter: stable`. The gutter computes to `stable` and costs nothing
under macOS overlay scrollbars — measured box height equals table height on
every table — and reserves the strip only for users who force classic
scrollbars, where it stops the table changing height as it becomes scrollable.

A scroll-position-aware edge fade was built and rejected on measurement:

- The mask version needs `mask-attachment: local` to cancel the fade once the
  content's end is on screen. WebKit here reports
  `CSS.supports("mask-attachment", "local") === false`, and with the property
  ignored both layers pin to the box and cancel each other everywhere — no fade
  at all, at any scroll position.
- The `background-attachment: local` version needs an opaque page-background
  colour for the cover gradient. Writer's `--bg` is deliberately translucent
  (`--bg-opacity`), so the cover would either leave a permanent shadow residue
  on every table or punch an opaque patch through the vibrancy.
- An unconditional fade is not an option: a broken-out table's box is exactly its
  own width by construction, so the fade would eat the table's right border
  whenever it is not scrolling.

So a scrolling table is cut at the box edge, as it is on GitHub and most docs
sites. Doing better needs JS — a shared observer toggling a class on scroll and
resize — which is per-widget listeners in the editor's hot path for a cosmetic
gain. Left as a follow-up.

## Acceptance Criteria

- A table narrower than the measure has zero overhang, is not a scroll
  container, and keeps its previous width.
- A wider table overhangs evenly (≤1px difference) and stays inside the
  `--writer-editor-breakout-gutter` on both sides of the pane.
- Neither the document pane nor `.cm-scroller` ever scrolls horizontally.
- When the pane is too narrow to break out, the box stays at the measure and the
  table scrolls inside it.
- A touched table's `.cm-table-source-line`s stay inside the measure.
- Covered by `apps/desktop/e2e/specs/table-break-out.spec.js`;
  `table-column-sizing.spec.js` (Phase A) still passes unchanged.

## Follow-ups

- **Phase C** — JS/`colgroup` column-width computation, and with it a
  wrapping-aware `estimateTableWidgetHeight`.
- A conditional scroll fade, if the bare cut proves annoying in daily use.
- `appearance.editor-width` is inert (see above); fixing it changes the default
  layout for every document, so it wants its own task.
- At panes narrower than about 1050px the measure itself already reaches into
  the section rail's 18–52px zone. That predates this change — break-out never
  applies at those widths — but it is the same collision, one layer down.
