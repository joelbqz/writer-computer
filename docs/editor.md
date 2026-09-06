# Editor Notes

Patterns and gotchas for the CodeMirror editor in `apps/desktop/src/components/editor-area/`. Each rule earned its place by costing real time. Apply them when extending or reviewing editor code.

## Use the layout model, not the rendered DOM, for positions

Prefer:

- `view.lineBlockAt(pos)` → `BlockInfo` with `top`/`bottom`/`height` in document coordinates.
- `view.documentTop` → screen y of the first line.

Over:

- `view.coordsAtPos(pos)` → can return `null` for positions outside the rendered viewport. CodeMirror only measures lines that are currently virtualized into the DOM; matches further down the document have no `Rect` until they scroll into view.
- `view.contentDOM.getBoundingClientRect()` → affected by virtualization padding and async layout.

Match screen position, valid for any document position:

```ts
const block = view.lineBlockAt(pos);
const matchScreenY = view.documentTop + block.top;
```

`coordsAtPos` returning `null` is a silent failure: a `scrollHandler` that returns `false` falls back to CodeMirror's default scroll, which doesn't know about app-level fades, masks, or other ancestor overlays. If you only test in-viewport cases, the bug ships.

## Choose the right scroll API for who owns the scroll container

CodeMirror's built-in scroll APIs assume the editor owns its scroll container (`view.scrollDOM`, by default `.cm-scroller`):

- `search()` config's `scrollToMatch` — customize the scroll effect for findNext/findPrevious.
- `EditorView.scrollMargins` facet — declare top/bottom/left/right regions of the scroll container that should be treated as off-screen (e.g. for a fixed gutter or fade).

These are correct when `view.scrollDOM` is the actual scrolling element.

In Writer's editor, `.cm-scroller` has `overflow: visible !important` (see `prosemark-theme.css`) and the surrounding `EditorScrollContainer` is the real scroller. CodeMirror's default scroll walks up to scroll ancestors generically, but `scrollMargins` only applies to `view.scrollDOM`'s computation — so the match can still land under the outer container's fade.

When the scrollable element is an ancestor:

- Use `EditorView.scrollHandler.of(...)` to take over scrolling.
- Find the ancestor scroller by walking `view.dom.parentElement` for the first element with `overflowY: auto | scroll`.
- Scroll it yourself with `scroller.scrollTo({ top, behavior: "auto" })`. `behavior: "smooth"` is async and gets interrupted by rapid keystrokes (e.g. Cmd+G held down).
- Account for `clientTop` if the ancestor has a border (Writer's container has a 12px transparent border-top to give the mask gradient room).

Reference: `EditorView.scrollHandler.of((view, range) => …)` in `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`.

## Block widgets: pick the decoration shape

Common shapes for widgets that own a block region:

- **Replace-only.** Always `Decoration.replace`. Use when the widget doesn't need to expose source for editing and interaction lives inside the widget itself. Canonical example: `mermaid-decorations.ts` — the fence is always replaced by the canvas, and editing happens in the canvas's nested editor, which writes the whole fence back via `writeFenceText`.
- **Conditional replace ↔ widget.** `Decoration.replace` over `[node.from, node.to]` when the selection doesn't overlap the node; `Decoration.widget(...).range(node.to)` (anchored at the end) when it does, so the source becomes editable next to the rendered widget. Canonical example: `fold/image.ts`. Driven by `selectionTouchesRange`, the third arg passed to `foldableSyntaxFacet`'s `buildDecorations`.
- **Conditional replace ↔ source-line styling.** `Decoration.replace` when the selection is outside the block; line decorations when selection touches the block and the source should stay editable in the main editor. Canonical example: `table-decorations.ts`, which renders a folded table preview with safe inline markdown inside cells, then unfolds a touched table into codeblock-styled markdown source lines rather than a nested editor.

Don't invent a parallel "edit mode" flag that isn't wired through `selectionTouchesRange`. The fold extension already manages that state — duplicating it produces drift between the two sources of truth.

## Enter edit mode by range-selecting the fence, not by placing a caret

`selectionTouchesRange` from `@prosemark/core` is overlap-based with inclusive bounds (`a.from <= b.to && b.from <= a.to`, see `node_modules/@prosemark/core/dist/main.js:30`). A range selection covering the whole fence reliably flips it true regardless of where the head lands.

```ts
view.dispatch({
  selection: EditorSelection.single(fenceTo, fenceFrom), // reverse-anchor convention
  effects: view.scrollSnapshot(),
});
```

Caret-placement at a single point inside the fence is fragile: empty fences, boundary positions, multi-line content, and stale offsets all break it. Mirror what `selectAllDecorationsOnSelectExtension` (`@prosemark/core`) does — it's the canonical pattern.

## Don't store document positions on widget instances

Widget identity is its visual state — `source`, `editMode`, etc. — never positions. Positions are derived state owned by the syntax tree.

- Don't capture `node.from`/`node.to` on the widget at construction. Above-fence edits shift them and the widget lives across rebuilds.
- Don't try to keep them current via an `eq()` side-effect (mutating the kept instance from `other`). It looks like it works in isolation and silently fails across multi-fence diffs and decoration-shape transitions.
- Look up positions live at click time:

```ts
const pos = view.posAtDOM(host);
const tree = syntaxTree(view.state);
let node = tree.resolveInner(pos, side);
while (node.name !== "FencedCode" && node.parent) node = node.parent;
```

`eq()` should compare only the visual identity. Let CM rebuild when that changes; don't mutate kept instances to compensate.

## `posAtDOM` boundaries: try `resolveInner` with both sides

A `Decoration.widget(...).range(node.to)` returns `posAtDOM(host) === node.to`. `resolveInner(node.to, 1)` resolves to the node _starting_ at `node.to` — the next sibling, not the FencedCode that ends there. The walk up never finds the fence.

For widgets anchored at boundary positions, try `side = -1` first (prefers the node ending at the boundary), fall back to `side = 1`:

```ts
for (const side of [-1, 1] as const) {
  let node = tree.resolveInner(pos, side);
  while (node.name !== target && node.parent) node = node.parent;
  if (node.name === target) return node;
}
return null;
```

## Buttons inside widgets: `mousedown.preventDefault()`

A button inside the widget that dispatches a transaction will race the editor's focus state. Default browser behavior on mousedown:

1. Browser focuses the button → editor blurs.
2. Click handler runs → `view.dispatch(...)`.
3. Decoration rebuilds → button DOM destroyed → focus reverts to body.
4. Our `view.contentDOM.focus({preventScroll: true})` runs.

Steps 1–4 race with CM's own focus tracking; the visible result is the caret landing at click coordinates instead of the dispatched selection, or focus landing nowhere useful.

Add to every in-widget button:

```ts
b.addEventListener("mousedown", (e) => {
  e.preventDefault(); // keep the editor focused
  e.stopPropagation(); // keep CM's pointerdown handlers from competing
});
```

Combine with `ignoreEvent: true` on the widget so CM skips its own pointer/click handling for events inside the widget DOM.

**Gotcha: `mousedown.stopPropagation` does not stop `pointerdown`.** They're separate event types — the browser dispatches both for a click, and stopping one doesn't filter the other. If you wire an editor-level handler on `pointerdown` (e.g., a drag-selection gate that listens on `view.contentDOM`), the in-widget button's `mousedown` stop won't suppress it. Filter inside the editor-level handler instead — typically `event.target instanceof Element && event.target.closest('.cm-your-widget')`. See `mermaid-decorations.ts`'s `shouldStartDragGate` for the canonical filter.

## Heightmap-shifting transitions: include `view.scrollSnapshot()`

Any decoration switch that changes block heights (replace ↔ widget, fold/unfold, widget appearing/disappearing) shifts the heightmap. Without compensation the viewport jumps.

```ts
view.dispatch({
  selection: ...,
  effects: view.scrollSnapshot(),
});
```

`scrollSnapshot` captures the viewport-top doc anchor and its screen offset; CM applies the resulting `StateEffect` after the heightmap rebuild and re-scrolls so the same anchor lands at the same screen Y. Don't roll your own `coordsAtPos`-delta scroll math — it depends on layout being flushed and is brittle.

**Caveat: `scrollSnapshot` only affects `view.scrollDOM`, not ancestor scrollers** (per CM's own doc comment; both capture and apply use `scrollDOM.scrollTop`). In Writer, `.cm-scroller` doesn't scroll — the outer `EditorScrollContainer` does — so the snapshot is close to a no-op here. What actually keeps the viewport stable across height changes is CM's measure-loop scroll anchoring, which does adjust the discovered ancestor scroller — but only while the editor has focus or a wheel/touch event happened in the last 100ms. Corollary: widgets whose DOM changes height after insertion (async image decode, deferred renders) must keep `estimatedHeight` truthful and call `view.requestMeasure()` when their height settles, so the anchoring runs while the user is still interacting. `fold/image.ts` does this with a module-level measured-height cache keyed by image URL, reserving the cached height on the `<img>` until it (re)loads.

## Tree-derived StateFields go stale in unparsed regions

`syntaxTree(state)` returns a frozen snapshot committed at the last `LanguageState` flip — not the live parse context. `ensureSyntaxTree` advances the live context and returns the fresh tree, but `syntaxTree(state)` keeps returning the old one until some later transaction commits a new `LanguageState` (`forceParsing` = `ensureSyntaxTree` + that dispatch). Lezer's background worker fills the tree in `requestIdleCallback` slices, which starve during continuous scrolling and are budget-capped on long documents.

Consequence: any `StateField` that builds decorations by iterating `syntaxTree(state)` (list geometry, hide, fold) renders nothing for regions the committed tree hasn't reached — scrolled-into list items lose their hanging indent, markers show raw, etc. The fields' `syntaxTree(startState) !== syntaxTree(state)` rebuild guards only fire once a parse-commit transaction lands.

`viewportParsePlugin` in `use-prosemark-editor.ts` closes the gap: on `viewportChanged` into a region where `syntaxTreeAvailable` is false, it defers a `forceParsing(view, viewport.to + overshoot)` (dispatching inside an update cycle is illegal, hence the `setTimeout`). Mount and tab-swap paths call `advanceViewportParse` for the same reason. Don't add per-field force-parses.

The parse-commit transaction that `forceParsing` dispatches changes neither the doc nor the viewport. So every tree-derived decoration source, StateField **and** ViewPlugin, must rebuild on the tree itself changing. Use `treeChanged(update)` from `prosemark-core/utils.ts`:

```ts
update(update: ViewUpdate) {
  if (update.docChanged || update.viewportChanged || treeChanged(update)) rebuild();
}
```

The StateFields (`hideExtension`, `foldExtension`, `listDecorationsField`) and the ViewPlugins (`headingPlugin`, `codeBlockDecorationsExtension`, `blockQuoteExtension`) all carry it. Without it a region jumped into (Cmd+G, section rail, anchor) keeps stale decorations until the next scroll. Don't add a "tree sync" plugin that re-dispatches a selection to nudge a rebuild; that was the old workaround and it tripled the rebuild cost per parse commit.

## Synchronous render in `toDOM` beats IntersectionObserver-deferred

If your renderer is sync and cache-backed (or cheap to call), paint in `toDOM`. The async-deferred path adds a "Loading…" gap users see, can re-fire after a toggle (producing a visible flash), and has no real benefit when the cache makes repeat renders O(map lookup). CM only calls `toDOM` for widgets in its viewport buffer anyway.

Reference: `mermaid-decorations.ts` mounts the canvas synchronously in `toDOM`; the SVG cache is bounded LRU and the output is sanitised before reaching `innerHTML`.

## Test the dispatch path, not just the helpers

Pure-helper tests (`computeToggleSelection`-style) catch math bugs but not focus races, `posAtDOM` boundary errors, or cross-widget interference. The actual contract is "click does the right thing in CM," which only an integration test can verify.

When a widget has a click → dispatch → mode-change cycle, mount a real `EditorView` with two instances and simulate clicks. Assert against `view.state.selection.main` and `view.state.field(foldExtension)`, not against helper outputs.

## File map

- `mermaid-decorations.ts` — canonical replace-only block widget with in-widget editing. Reference for live position lookup (`findEnclosingFencedCode`) and writing the fence back from a nested editor.
- `fold/image.ts` — canonical conditional replace ↔ widget, plus the measured-height cache for async-loading content.
- `table-decorations.ts` — canonical conditional replace ↔ source-line styling; uses `selectAllDecorationsOnSelectExtension` for click-to-select.
- `prosemark-core/links.ts` — `linkUrlAt` / `rawUrlAt`, the one place that resolves a link destination from a document position.
- `prosemark-core/imageSrc.ts` — `imageSrcResolverFacet` / `resolveImageSrc`; widgets resolve `<img src>` in `toDOM` (Writer provides the facet from `image-src-resolver.ts`), so no DOM observer rewrites images after insertion.
- `editor-scroll.ts` — `findOuterScroller` / `scrollPosToSafeTop`, the one place that scrolls the ancestor container to a document position.
- `editor-extensions.ts` — `createEditorExtensions`, the one place the extension list is assembled. Pieces: `editor-search-extensions.ts` (hidden search panel, `EditorView.scrollHandler` for the ancestor-scroller case, Mod-f / Mod-g / Escape), `link-navigation.ts` (click-to-follow, `followLink`), `editor-clipboard.ts` (image + frontmatter paste), `editor-body-menu.ts` (right-click menu), `viewport-parse.ts`. `use-prosemark-editor.ts` only mounts, swaps, and disposes the view.
- `node_modules/@prosemark/core/dist/main.js:30` — `selectionTouchesRange` semantics.
