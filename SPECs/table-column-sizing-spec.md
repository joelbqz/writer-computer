# Table Column Sizing Spec (Phase A)

## Summary

Rendered markdown tables (the folded `TableWidget`) distribute column width badly
in real documents. Some columns are starved so hard that ordinary words break
mid-word — `protectio` / `n`, `<canonical` / `>` — while a long-prose column in
the same table has width to spare. Phase A fixes this with CSS only, inside the
editor's existing `--writer-editor-max-width` measure.

## Root cause

`EditorView.lineWrapping` (`apps/desktop/src/lib/prosemark-core/basicSetup.ts`)
makes CodeMirror apply its base `.cm-lineWrapping` rule to `.cm-content`:

```
white-space: break-spaces;
word-break: break-word;    /* Safari fallback */
overflow-wrap: anywhere;
```

The table widget's cells inherit it. Per CSS Text 3, `anywhere` — unlike
`break-word` — contributes its break opportunities to **min-content** intrinsic
sizing. Each column's minimum therefore collapses to roughly one character, so
the auto table layout algorithm is free to squeeze any column to nothing. It
then distributes the available width in proportion to each column's max-content,
which hands almost everything to the longest-prose column and starves the
medium ones until their words shred.

Three smaller problems compounded it:

- `min-width: 6em` on every `th`/`td` was a floor pointing the wrong way: it
  inflated trivial columns (`#`, `dayMax`) while doing nothing for starved ones.
- Headers were centered (the browser `th` default) against left-aligned bodies.
- Cells were middle-aligned, so a short cell floated in the centre of a tall row.

## Goals

- No mid-word breaking of ordinary prose in rendered table cells.
- No uniform minimum width: a one-character column should be one character wide.
- A single prose column cannot take so much width that its neighbours starve.
- Headers align with their bodies; an explicit `:---:` / `---:` still wins.
- Cells align to the top of their row.

## Non-Goals

- Horizontal scrolling for wide tables (Phase B).
- Letting tables break out of the editor measure (Phase B).
- JS/`colgroup` column-width computation (Phase C).
- A more accurate `estimateTableWidgetHeight` (see Follow-ups).

## Implementation

All in `tableTheme` in
`apps/desktop/src/components/editor-area/table-decorations.ts`:

- `overflow-wrap: break-word` + `word-break: normal` on `th`/`td`, neutralizing
  the inherited `anywhere`. Column minimums go back to "longest word".
- `max-width: 48ch` per cell, replacing the removed `min-width: 6em`.
- `vertical-align: top` on cells.
- `text-align: left` on `th`. Alignments parsed from the delimiter row are
  applied as inline styles by the widget, so they still win.

### Why 48ch

Measured in the real WKWebView across seven fixture tables. `max-width` on a
table cell clamps the column's max-content _demand_, so the auto layout stops
over-serving the hog and every other column gets its natural width. The cap has
a cost, though: a table whose only wide column is prose shrinks below the
measure and grows taller. Column widths in px at the 734px measure:

| cap  | index+label+prose      | starved middle column | code-chip column |
| ---- | ---------------------- | --------------------- | ---------------- |
| none | 37 / 101 / 594 (h 267) | 111 — 3-line ribbon   | 231              |
| 30ch | 37 / 101 / 293 (h 443) | 238                   | 290              |
| 40ch | 37 / 101 / 391 (h 355) | 226                   | 279              |
| 48ch | 37 / 101 / 469 (h 289) | 205                   | 253              |
| 56ch | 37 / 101 / 547 (h 289) | 188                   | 231              |

30ch and 40ch visibly stunt ordinary single-prose tables (433px and 530px wide
in a 734px measure). 48ch keeps them close to natural width while still giving a
starved column enough to read, and lands at roughly half the measure — a
defensible rule: no single column may demand more than about half the line.

### Long unbreakable tokens

`break-word` does not feed min-content sizing, so a token longer than the cap
cannot shred — it has to push its column wider. Without a cap, a table holding a
64-character digest blows out to 855px, spilling past the measure _and_ past the
scrollable pane. The `max-width` prevents this: it clamps the column below the
token's intrinsic width, and `break-word` then breaks the token because it
genuinely cannot fit on a line. So overlong tokens break, but only as a last
resort, and the table stays inside the measure. No special rule for `code` is
needed; `email:<canonical>` and `createLoginOtpSender` render intact.

## Acceptance Criteria

- No run of letters/digits in a prose cell renders across two line boxes.
- A one-character column is under 60px wide (was pinned at 96px by the 6em floor).
- A medium column beside a long-prose column keeps enough width to read.
- Body cells compute `vertical-align: top`; unaligned headers compute `left`;
  `:---:` computes `center` and `---:` computes `right`.
- Covered by `apps/desktop/e2e/specs/table-column-sizing.spec.js`.

## Follow-ups

- **Phase B** — wide tables breaking out of the measure / horizontal scrolling.
  Done: `table-break-out-measure-spec.md`. It re-measured the 48ch cap and kept
  it, and cut the drift below from 944px/425px to 344px/130px on its own fixture.
- `estimateTableWidgetHeight` still assumes one visual line per row, so a
  document of prose-heavy tables grows under the reader on first scroll-through.
  Measured cold on the pathological fixture: 527px total drift with this change
  versus 483px before it, largest single jump 417px versus 280px. The estimate
  is unchanged by Phase A; the cap trades width for height in exactly the
  starvation cases, which slightly widens the gap. A wrapping-aware estimate
  needs column widths, which is Phase C territory.
