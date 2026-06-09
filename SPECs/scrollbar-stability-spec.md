# Scrollbar Stability Spec

## Summary

Scrolling a long markdown document (repro: `SPECs/reveal-in-sidebar-and-external-watcher-spec.md` — 248 lines, ~33 headings, ~57 list items, 3 small code fences, no tables/images) makes the document height keep changing, so the scrollbar thumb resizes and jumps. The editor should converge the CodeMirror heightmap once, invisibly, right after a document is opened/switched/reloaded, and keep widget estimates accurate so the thumb stays stable.

## Diagnosis

CodeMirror 6 virtualizes rendering: unmeasured lines get a uniform estimate (`HeightOracle.heightForLine` ≈ 28.8px here: 16px font × 1.8 line-height, × a wrap-count guess). Writer's typography makes real lines diverge systematically:

| Line type              | Actual height | Estimate error     | Source                                                                                                                       |
| ---------------------- | ------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| H1/H2/H3 heading       | 44.8–62px     | +16 to +33px each  | `1.6/1.4/1.2em` font scale (`syntaxHighlighting.ts`) + `padding-top: 1rem` on `.cm-markdown-heading` (`prosemark-theme.css`) |
| Blank separator line   | ~16px         | −12.8px each       | `.cm-line:has(> br:only-child) { line-height: 1 }` (`prosemark-theme.css`)                                                   |
| Long wrapped list item | varies        | ± one or more rows | hanging indent vs the oracle's wrap guess                                                                                    |

Scrolling converts estimates to measurements in viewport-sized chunks of mixed sign, so `scrollHeight` changes continuously and the thumb dances. Compounding causes:

1. Document switches are full-doc replace transactions on one persistent `EditorView` (`use-prosemark-editor.ts`), which reset the entire heightmap — convergence restarts on every open and on every external-watcher reload.
2. Scroll restore is a raw pixel offset recorded against a converged heightmap and replayed against a freshly-estimated one — it lands on the wrong content and then drifts.
3. `ImageWidget` and `HtmlBlockWidget` have no `estimatedHeight` (images also reserve no dimensions before async load), so docs containing them get additional height jumps. Tables and mermaid already implement the estimate pattern (`table-virtualization-scroll-stability-spec.md`).
4. CM6's built-in scroll anchoring works with the ancestor scroller but is gated on focus/wheel recency, and it only stabilizes content — it cannot stop the thumb from dancing.

Enabling facts verified in `@codemirror/view`: `view.requestMeasure()` + `view.elementAtHeight(0)` force a synchronous render+measure of the current viewport; measured heights persist (new height samples don't thrash the oracle unless base lineHeight/charWidth change); browsers paint only between tasks, so multiple `scrollTop` writes inside one rAF callback never paint intermediate positions — a warm-up pass needs no visual freeze.

## Goals

- Scrollbar thumb does not change size or position while scrolling an already-open long document, in either direction, including immediate far thumb-drags.
- Switching to a file and back restores the same visible content, stable immediately.
- External-watcher reloads keep the visible content in place and re-converge invisibly.
- Block widgets (image, HTML) provide deterministic height estimates before first measurement.
- Warm-up is bounded (~250ms budget) and degrades gracefully on very large documents.

## Non-Goals

- Changing typography (blank-line `line-height: 1` and heading padding are deliberate design).
- Replacing the native scrollbar with a custom one.
- Re-warming after window resizes or editor font-size changes (re-wrap re-introduces estimates; accepted).
- Pixel-perfect image height prediction on first-ever encounter (the per-URL cache makes later encounters exact).

## Implementation Stages

1. **Instrumentation** — `heightmap-debug.ts` ViewPlugin behind `localStorage["writer:debug-heightmap"] = "1"` (DEV only): logs contentHeight/scrollHeight deltas per measure cycle with line-type attribution. Stays in-tree as the regression tool.
2. **Widget estimates** — `estimatedHeight` for `ImageWidget` (per-URL measured-height cache + 200px default, `requestMeasure` on load) and `HtmlBlockWidget` (deterministic heuristic from sanitized block elements, mirroring the table estimate pattern).
3. **Heightmap warm-up** — `heightmap-warmup.ts`: after mount/swap/reload, step the outer scroller through the document forcing synchronous parse+measure per chunk inside rAF tasks (14ms chunk budget, 250ms total, 200-step cap), always exiting each task at the restore target so intermediate positions never paint. Progress tracked by `view.viewport.to` (document positions, immune to anchor-compensation pixel shifts). Aborts if the user scrolls mid-warm-up.
4. **Anchor-based scroll persistence** — save `{pos, offsetPx}` of the top visible line at navigation time (not per scroll event); restore through the warm-up target so file switches land on the exact content. Raw `scrollPos` stays as fallback.

## Acceptance Criteria

- With the debug flag on: opening the repro doc shows a warm-up burst, then scrolling the full range in both directions logs zero `heightChanged` deltas; thumb is visually stable.
- Far thumb-drag immediately after open: no mid-drag thumb resize.
- File switch away/back restores the same visible content (line + offset after stage 4).
- External edit reload keeps visible content in place; warm-up reruns.
- Docs that fit in the initial viewport skip warm-up.
- Image docs: at most one height correction per image on first load; none on reopen (cache hit).
- `vp check` and `vp test` pass; new focused tests cover image/html estimates, warm-up termination/cancel, and the scroll-anchor store action.

## Validation

Manual, dev app with `localStorage.setItem("writer:debug-heightmap", "1")`:

1. Open the repro doc; observe warm-up logs settle ≤250ms; scroll full range both directions — no height deltas, stable thumb.
2. Thumb-drag far into the doc right after open — no mid-drag resize.
3. Switch file and back — same content visible.
4. `touch` the open file externally — content stays in place, warm-up reruns.
5. Open a doc with images — one correction per image first time, none on reopen.
6. Open a short doc — warm-up skips (log).
