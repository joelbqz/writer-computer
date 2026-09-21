# Off-Viewport Selection Line Height Spec

## Summary

Scrolling a long note still jumped after the `@codemirror/view` 6.43.12 upgrade: the document and the scrollbar thumb moved abruptly, sometimes by a heading's worth of height, when the line holding the caret scrolled out of the viewport. Reproduced on a 168-line planning note (H1, wide table, two code blocks, long list items) with the caret left on the H1: the moment line 1 left the viewport its height-map entry dropped from 92px to 29px and everything above the viewport shifted up by 63px.

## Cause

CodeMirror keeps the main selection's anchor and head lines rendered wherever the viewport is (`ViewState.updateForViewport` adds a one-line viewport per off-screen selection end), and the measure loop writes what those lines measure at into the height map, exactly like viewport lines. But `view.visibleRanges` covers only the main viewport, and every plugin that builds decorations from it, including `@codemirror/language`'s own tree highlighter, leaves those lines bare. A heading holding the caret is rendered as a plain `.cm-line` with no font-size, weight, padding or line-height, measures at paragraph height, and that height replaces the measured 92px. When it scrolls back in, it grows again. The same applies to any line whose height depends on viewport-scoped decorations: code block lines (mono font, first/last padding), blockquote lines, wrapped paragraphs whose marks change the wrap.

CodeMirror's measure-loop anchoring re-scrolls the ancestor scroller to hide such shifts only while the editor has focus or within 100ms of a wheel or touch event. In Writer the outer container scrolls, not `.cm-scroller`, so a scrollbar drag, a scroll right after opening a note without clicking into it, or the tail of a momentum scroll shows the jump; the document height changing moves the thumb even when anchoring hides the content shift.

## Goals

- Lines CodeMirror renders outside the viewport get the same decorations as viewport lines, so their measured height matches what they measure at in the viewport.
- One shared definition of "what CodeMirror renders", used by every plugin that decorates from the visible ranges.
- Rebuild only when that set changes: a caret moving between lines inside the viewport must not trigger rebuilds that `update.viewportChanged` did not.

## Non-Goals

- Changing when CodeMirror renders the selection's lines or measures them.
- Compensating the scroll position after the fact. The height map must be right; the scroll math already is.

## Implementation

- `apps/desktop/src/lib/prosemark-core/utils.ts` — `offscreenSelectionLines(view)` mirrors `updateForViewport`: the lines of `selection.main.anchor` and `head` when outside `view.viewport` (bounds inclusive). `renderedRanges(view)` is `view.visibleRanges` plus those lines, sorted and disjoint. `renderedRangesChanged(update)` is `update.viewportChanged`, or `update.selectionSet` with a different set of off-viewport lines before and after.
- Every plugin that iterated `view.visibleRanges` now iterates `renderedRanges(view)` and rebuilds on `renderedRangesChanged(update)` instead of `update.viewportChanged`: `heading-decorations.ts` (also dedupes a heading touched by two ranges), `wiki-link-extension.ts`, `codeFenceExtension.ts`, `tabWidthExtension.ts`, `blockQuote.ts`.
- `apps/desktop/src/lib/prosemark-core/offscreenSelectionHighlight.ts` — the tree highlighter in `@codemirror/language` cannot be pointed at extra ranges, so this plugin runs the same `highlightTree` walk with the state's highlighters (`highlightingFor`) over just the off-viewport selection lines, at the same `Prec.high`. When the lines scroll back in it returns `Decoration.none` and the tree highlighter covers them in the same update. Registered in `prosemarkBasicSetup`.
- `codeFenceScroll.ts` keeps reading `view.visibleRanges`: it measures horizontal scroll offsets of visible blocks and has nothing to do with height.

## Verification

- `apps/desktop/tests/rendered-ranges.test.ts` covers the three helpers: bounds, deduplication, ordering, and which selection changes count.
- Playground (`vp run playground#dev`), note above loaded, `.pg-editor` restyled as a fixed-height scroller, editor blurred, `scrollTop` stepped 250px at a time while diffing `view.lineBlockAt(line.from).height` for every line against the previous step. Before: line 1 changed 92.1 → 28.8 the step it left the viewport. After: no line above the viewport changes height across the whole pass with the caret on the H1, inside a code block, or on a 500-character list item, and the caret line's DOM carries its highlight marks at 92.125px while scrolled out.
