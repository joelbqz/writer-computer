# Mermaid Drag-Selection Edit-Mode Flip Spec

## Summary

Today, dragging a text selection through (or into) a mermaid block widget flips the widget from its rendered SVG canvas into source/edit-mode view _while the mouse is still down_. The flip changes the document's vertical layout mid-drag (the source lines reappear above the canvas), shifts the heightmap, and is implicated in selection-rectangle rendering glitches across the widget. We want the widget to stay in its pre-drag visual state for the duration of the drag-selection, and only re-evaluate edit mode when the selection settles (pointer release).

## Problem

### What flips

`mermaidFoldExtension` in `apps/desktop/src/components/editor-area/mermaid-decorations.ts:186-211` returns one of two decoration shapes for each mermaid fence:

- `selectionTouchesRange === false` → `Decoration.replace({ block: true, inclusiveStart: true })` over the entire fence — the source lines are hidden and replaced by the canvas widget. ("Preview" mode.)
- `selectionTouchesRange === true` → `Decoration.widget({ block: true })` anchored at `node.to` — the fence's source lines remain visible, and the canvas is rendered as an additional block widget _below_ the source. ("Edit" mode.)

The two decoration shapes have very different vertical extents, so a flip between them mid-drag causes:

1. The fence's source lines (3+ lines for a typical diagram) appear/disappear above the canvas.
2. The CodeMirror heightmap re-measures, the viewport's vertical offset shifts.
3. The drag's running mouse coordinates now resolve to different document positions, scrambling the selection extension.
4. The selection rectangle drawn by CodeMirror (and any sibling decoration layers) renders over different lines than the user is targeting.

### Repro steps

1. Open a markdown document containing a ` ```mermaid ` fenced block. Wait for it to render as the canvas widget (Preview mode).
2. Click somewhere a few lines _above_ the mermaid block to place the caret outside the fence.
3. Hold the primary mouse button and drag straight down through the mermaid widget without releasing.
4. Observe: as soon as the extending selection's `to` enters `[fence.from, fence.to]`, the widget collapses, the fence source appears above the canvas, the page layout jumps, and the selection visualisation behaves erratically across the widget.
5. Release the mouse — the final selection settles, but the visual disturbance during the drag was the bug.

A symmetric variant: position caret _inside_ the fenced source (widget already in Edit mode), drag down past the canvas to text below the fence. The widget collapses back to canvas mid-drag the moment the drag's `from` leaves the fence range — equally disruptive.

### Why it's bad

- The flip is a layout change driven by selection state, not by user intent. The user is making a selection, not toggling display mode.
- Mid-drag layout shifts make the selection feel unpredictable: target line and visual line diverge after the flip.
- Heightmap shifts during a drag are a known source of selection-rectangle rendering glitches; this issue likely contributes to the rectangle/widget rendering anomaly the sibling `writer-selection-bug` worktree is investigating, even if the underlying causes are not identical.

## Root cause

The mermaid extension piggybacks on `@prosemark/core`'s `foldableSyntaxFacet`, which is enabled by a `StateField<DecorationSet>` (`foldExtension`) that rebuilds **on every transaction with `tr.docChanged || tr.selection`** (see `node_modules/.../@prosemark/core/dist/main.js:310-318`). For each FencedCode node it computes:

```js
selectionTouchesRange(state.selection.ranges, node);
// where rangeTouchesRange(a, b) = a.from <= b.to && b.from <= a.to
// (main.js:30-35)
```

That overlap check is inclusive on both ends and uses the _live_ `state.selection`. CodeMirror's pointer-driven selection extension dispatches a transaction (with `tr.selection` set) on every meaningful mousemove, so every drag-extending transaction triggers `foldExtension` to rebuild.

There are actually **two** failure points in the prosemark code path that conspire to produce the visible flip:

**1. The early return when `selectionTouchesRange` is true.** Look at `main.js:300`:

```js
if (!spec.keepDecorationOnUnfold && selectionTouchesRange_) return;
if (spec.buildDecorations) {
  const res = spec.buildDecorations(state, node, selectionTouchesRange_);
  ...
}
```

The mermaid spec doesn't set `keepDecorationOnUnfold`, so the moment the live selection touches the fence, prosemark **bails out of the iterate callback before `buildDecorations` is ever called** for that node. `foldExtension`'s decoration set therefore omits any decoration for the fence — and CodeMirror falls back to rendering the underlying markdown source. _That_ is the flip the user sees: not Decoration.replace → Decoration.widget, but Decoration.replace → no decoration at all.

A consequence: the existing `if (selectionTouchesRange) return Decoration.widget(...)` branch in `mermaid-decorations.ts:202` is unreachable today. It looks like it was written for the eventual "source above + canvas below" Edit-mode shape, but without `keepDecorationOnUnfold` set, prosemark intercepts before that branch can run.

**2. No notion of "drag in progress."** Even if `keepDecorationOnUnfold` were set, prosemark would still call `buildDecorations(state, node, selectionTouchesRange_)` on _every_ drag-extending transaction with the live `selectionTouchesRange_` value. The mermaid `buildDecorations` uses that boolean directly as `editMode`, and `MermaidWidget.eq` (`mermaid-decorations.ts:25-27`) compares `source + editMode` — so a flip of `editMode` rebuilds the widget DOM and toggles the decoration shape every mousemove that crosses the fence boundary.

Together: prosemark's early return removes the decoration on first crossing, and even with the early return disabled, the live-selection-driven recomputation would still produce the flip. The fix has to address _both_.

The intentional "click Edit code" path (`mermaid-canvas.ts` "Edit code" button → `toggleEditMode` in `mermaid-decorations.ts:132-148`) dispatches `EditorSelection.single(fenceTo, fenceFrom)` _synchronously_ with no associated mousemove flow — that path needs to keep working (range overlapping the fence → flip into Edit mode).

## Proposed fix

Two pieces, both in `mermaid-decorations.ts`. No fork of `@prosemark/core`, no change to the foldable facet contract.

**Piece A: take ownership of the decoration choice from prosemark.** Set `keepDecorationOnUnfold: true` on the mermaid spec. With this flag, prosemark stops short-circuiting on `selectionTouchesRange_` and always delegates to `buildDecorations(state, node, selectionTouchesRange_)`. We can then pick Preview vs Edit unconditionally inside our callback, and prosemark never strips the decoration out from under us. As a side benefit this also activates the previously-unreachable `Decoration.widget` Edit-mode branch (source above + canvas below), matching the comment in the existing code and the original mermaid SPEC's intent.

**Piece B: gate `editMode` on a "drag in progress" snapshot of the selection.** Freeze the `editMode` answer for the duration of a drag against the selection captured at drag start; on pointer release, drop the freeze and let `editMode` re-evaluate against the live selection.

### Mechanism

1. **Drag-state state field.** A `StateField<readonly SelectionRange[] | null>` named `dragFrozenSelectionField`:
   - `null` = no drag in progress (the common case).
   - non-null = drag in progress; the value is the snapshot of `state.selection.ranges` taken at drag start.
   - Updated by two `StateEffect`s: `startDragEffect` (carries the snapshot) and `endDragEffect` (clears).
   - Mapped through `tr.changes` on every transaction so the snapshot stays valid against an evolving document (cheap; effectively a no-op while user is dragging since drag-selection doesn't mutate the doc).

2. **Pointer view plugin.** A `ViewPlugin` registered alongside `mermaidFoldExtension` that:
   - On `pointerdown` on `view.contentDOM` (primary button only, `e.isPrimary`, `e.button === 0`), dispatches `startDragEffect.of(view.state.selection.ranges)`.
   - On `pointerup` / `pointercancel` registered on `window` (so a release outside the editor still clears the gate), dispatches `endDragEffect.of(null)`.
   - Also clears on `blur` of `contentDOM` as a safety net.
   - Does **not** preventDefault — it observes only.
   - Skips if the pointerdown's `event.target` is inside `.cm-mermaid-widget` (the canvas already owns its own pan-drag and a canvas-internal drag must not freeze the editor's mermaid edit-mode evaluation; CodeMirror's selection extension also doesn't run from there).
   - Skips if the gate is already active (idempotent — a second pointerdown without an intervening pointerup leaves the original snapshot in place).

3. **Gated `buildDecorations`.** With `keepDecorationOnUnfold: true` set on the spec, prosemark always calls our callback. Inside:

   ```ts
   const frozen = state.field(dragFrozenSelectionField, false);
   const editMode = frozen ? rangesTouchInclusive(frozen, node) : selectionTouchesRangeArg;
   ```

   `rangesTouchInclusive` uses the same overlap predicate as `@prosemark/core`'s `rangeTouchesRange`. When the gate is inactive, the third argument is the live `selectionTouchesRange_` from prosemark, so behaviour collapses to "what prosemark would do if `keepDecorationOnUnfold` had simply been on from the start."

4. **Re-flush on pointerup.** When `endDragEffect` clears the field, the transaction has `tr.selection === false` and `tr.docChanged === false`, so `foldExtension` would not automatically rebuild. The `endDragEffect`-dispatching transaction therefore also includes `selection: view.state.selection` — a no-op selection set that flips `tr.selection` truthy. `foldExtension` rebuilds, the gate is now `null`, and `editMode` is recomputed against the live selection. The pairing is one-shot; the resulting transaction does not retrigger pointerup and so does not loop.

### Composition with the "click Edit code" path

`toggleEditMode` (`mermaid-decorations.ts:132-148`) is invoked from the `mountMermaidCanvas` callback on the "Edit code" button click. The button's `mousedown` calls `event.stopPropagation()` (`mermaid-canvas.ts:271`-ish), but **`mousedown.stopPropagation` does not stop the corresponding `pointerdown`** — they're separate event types. The editor's `pointerdown` handler therefore _does_ see the event; what stops the gate from activating is the `target.closest(".cm-mermaid-widget")` skip in `shouldStartDragGate` (the widget wrapper has class `cm-mermaid-widget`). With the gate suppressed, `toggleEditMode` then dispatches `EditorSelection.single(fenceTo, fenceFrom)` with `tr.selection` truthy. `foldExtension` rebuilds, gate is `null`, `editMode = selectionTouchesRangeArg` (which is `true` because the dispatched range overlaps the fence) → widget flips to Edit mode as today. ✓

The reverse direction ("Preview" button → caret at `fenceTo + 1`) is symmetric: button click is inside `.cm-mermaid-widget`, the widget skip suppresses the gate, dispatched caret is outside the fence, live `selectionTouchesRange` is `false`, widget flips back to Preview.

## Edge cases / risks

- **Keyboard selection (`Shift+ArrowDown` extending into a fence).** No `pointerdown`/`pointerup` flow; the drag gate stays `null`; behaviour unchanged from today (flips immediately on each keystroke). Acceptable in this spec — keyboard selection is discrete (each keystroke is a "settled" selection in its own right) and there is no clean cross-keystroke "selection in progress" signal. If we revisit, a short debounce on `editMode` transitions could unify the two paths, but it is out of scope here.
- **Drag started inside an already-Edit-mode fence and ending outside.** Frozen ranges include a caret/range inside the fence → `frozen.some(touches)` returns `true` for the entire drag → widget remains in Edit mode (source visible) until pointerup. On release, gate clears, live overlap is re-evaluated; if the final selection no longer touches the fence the widget snaps to Preview. Correct: user can drag-select out of the fence without the widget collapsing under their cursor.
- **Drag started outside and ending inside the fence.** Frozen ranges don't touch fence → widget stays as canvas during drag → on pointerup, live overlap is true → flip to Edit mode. Single, clean transition at the moment of release.
- **Drag passing through multiple mermaid blocks.** Each block independently evaluates against the same frozen ranges. All stay in their pre-drag state through the drag and re-evaluate together on pointerup.
- **Click inside an already-Edit-mode widget (a click on a source-line character).** `pointerdown` → snapshot taken → CodeMirror moves the caret → `pointerup` → snapshot cleared → live evaluation. The brief gate window contains a single non-extending click, which doesn't change `editMode` either way. No regression.
- **Cancellation: Escape mid-drag, alt-tab, focus loss, browser-driven pointer cancellation.** `pointerup` on `window` is the primary clear; `pointercancel` and `blur` on `contentDOM` are belt-and-suspenders. If somehow all three were missed (no realistic scenario today), the next user-driven transaction will not clear the gate — so we should also add a defensive clear on the very first transaction after `view` reports `e.buttons === 0` via a `pointermove` listener. Optional; only add if QA reveals stuck states.
- **Touch / trackpad gestures.** `pointerdown`/`pointerup` cover both mouse and touch in WebKit (Tauri's renderer); Apple trackpad force-click variants still emit standard pointer events. No special casing needed.
- **Canvas-internal pan-drag (the user pans the rendered diagram by dragging inside the canvas).** The canvas viewport's own `pointerdown` (`mermaid-canvas.ts:160`) calls `e.preventDefault()` but does **not** `stopPropagation`, so canvas-internal pointerdowns _do_ bubble to `contentDOM`. The `target.closest(".cm-mermaid-widget")` check in `shouldStartDragGate` is therefore **load-bearing**, not redundant — it's what stops the editor's drag gate from activating on a canvas pan (and on Edit-code/Preview button clicks, see "Composition with the click Edit code path" above).
- **Cross-widget rendering coupling with `writer-selection-bug`.** That worktree is independently investigating a selection-rectangle rendering issue that may or may not share root cause. This fix should reduce the _frequency_ of mid-drag heightmap shifts, which may incidentally make the rectangle bug less visible — but we should not assume the two are the same problem. Don't merge or coordinate.
- **State-field allocation pressure.** A new state field that maps through every transaction is essentially free (`null` 99.9% of the time, and even when set the snapshot is a small array). No measurable perf risk.
- **Re-flush dispatch loop risk.** The "re-flush on pointerup" trick (option 1: include `selection: state.selection` on the `endDragEffect` transaction) is a one-shot — the resulting transaction does **not** trigger another `pointerup` and so does not loop. Verify in tests.

## Files expected to change

- `apps/desktop/src/components/editor-area/mermaid-decorations.ts` — add `dragFrozenSelectionField` (StateField + Effects), the pointer ViewPlugin, gate the `editMode` computation in `mermaidFoldExtension.buildDecorations`, register the new pieces alongside the existing `mermaidTheme` / `foldTreeSync` / `mermaidFoldExtension` returned by `mermaidDecorations()`.
- `apps/desktop/tests/mermaid.test.ts` — add coverage for the gate behaviour (see Test plan).
- _No changes_ to `mermaid-canvas.ts`, `mermaid-renderer.ts`, `use-prosemark-editor.ts`, or `@prosemark/core`.

## Test plan

### Manual verification (primary)

1. **Drag through Preview-mode widget.** Open a doc with a rendered mermaid canvas. Click a few lines above the canvas. Drag straight down past the canvas without releasing. _Expect:_ canvas remains rendered for the entire drag; no source lines appear; layout does not jump.
2. **Drag-release with selection settling inside fence.** Same setup; release while the drag's `to` is within the fence. _Expect:_ on release, widget flips to Edit mode (source above + canvas below) once.
3. **Click Edit code button.** Click the "Edit code" pill on a Preview-mode widget. _Expect:_ widget flips to Edit mode immediately (today's behaviour preserved).
4. **Drag out of an Edit-mode widget.** Position caret inside the fenced source. Drag down through the canvas into text below the fence. _Expect:_ source lines remain visible during the entire drag; on release, if final selection doesn't overlap the fence, widget snaps to Preview.
5. **Shift+arrow into fence (keyboard).** Position caret above a Preview-mode widget; press `Shift+ArrowDown` until the selection enters the fence. _Expect:_ widget flips to Edit mode immediately on the keystroke that crosses the fence boundary (out of scope for this fix; document as a known difference from the drag case).
6. **Drag across multiple consecutive mermaid blocks.** Set up two mermaid blocks separated by a few lines. Drag from above the first to below the second. _Expect:_ both remain in Preview during the drag; both re-evaluate on release.
7. **Mouse release outside the editor.** Start a drag inside the editor; release outside the contentDOM (e.g., on the sidebar). _Expect:_ the gate clears (window-level `pointerup`); next selection-changing action behaves normally.
8. **Window blur mid-drag.** Start a drag; alt-tab away. Return. _Expect:_ gate cleared (via `blur`); editor responsive.
9. **Pan inside a rendered canvas.** Mouse-drag inside the rendered SVG to pan the diagram. _Expect:_ canvas pans; editor selection unaffected; no edit-mode flip.

### Automated (vitest)

- `dragFrozenSelectionField` records the snapshot on `startDragEffect`, clears on `endDragEffect`, and survives doc-changing transactions via `tr.changes` mapping.
- Synthesise an `EditorState` with a fence and a selection range outside the fence, set the gate active with frozen ranges that don't touch the fence, then update `state.selection` to a range that _does_ touch the fence; assert `mermaidFoldExtension`'s decoration is `Decoration.replace` (canvas only) — i.e. the gate held.
- Same setup with the gate cleared: assert decoration is `Decoration.widget` — i.e. live behaviour.
- Click-Edit-code path: dispatch `EditorSelection.single(fenceTo, fenceFrom)` against an inactive gate; assert decoration becomes `Decoration.widget`.
- Pointer ViewPlugin in JSDOM: simulate `pointerdown` on contentDOM, assert the field becomes non-null; simulate `pointerup` on `window`, assert it returns to `null`; also assert the post-`pointerup` transaction triggers `foldExtension` to recompute.

## Acceptance criteria

- Drag-selecting through, into, or out of a mermaid block does not change the widget's rendered/source state until the user releases the pointer.
- The "Edit code" button click continues to flip the widget into Edit mode synchronously.
- The "Preview" affordance continues to flip the widget back to Preview synchronously.
- No measurable regression in scrolling, typing, or layout for documents containing many mermaid blocks.
- Existing mermaid tests pass; new tests for the gate pass.
