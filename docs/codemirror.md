# CodeMirror Notes

Two rules that took us a few wrong turns to learn. Apply both when working with the CodeMirror editor in `apps/desktop/src/components/editor-area/`.

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

## Scope `scrollHandler` to the scroll targets you actually want to override

`EditorView.scrollHandler.of(...)` runs for **every** scroll target the view processes — including CodeMirror's default cursor tracking on typing. A handler that unconditionally rewrites geometry will jolt the viewport on every keystroke.

Gate the handler on a `StateField` of intent that reads the current transaction's user-event tags, then `return false` for transactions you don't own so CodeMirror's default scroll runs unimpeded:

```ts
const searchScrollIntent = StateField.define<boolean>({
  create: () => false,
  update: (_value, tr) => tr.isUserEvent("select.search") || tr.isUserEvent("input.replace"),
});

EditorView.scrollHandler.of((view, range) => {
  if (!view.state.field(searchScrollIntent)) return false; // typing, cursor moves, etc.
  // …safe-zone scroll math…
});
```

Two subtleties:

- **Recompute on every transaction.** Don't early-return to "preserve" the previous value across effect-only transactions — the flag would latch `true` after a search nav and a later unrelated `scrollIntoView` effect would inherit it.
- **`isUserEvent` is prefix-matching with `.` separators.** `isUserEvent("select.search")` matches both `"select.search"` and `"select.search.matches"`. Likewise `"input.replace"` covers `"input.replace.all"`. One check per family is enough.

User events emitted by `@codemirror/search` (v6.x): `findNext` / `findPrevious` / `jumpToMatch` → `select.search`; `replaceNext` → `input.replace`; `replaceAll` → `input.replace.all`. Typing emits `input.type`, paste emits `input.paste`, plain cursor moves emit `select` — none match the gate.

Return values: `false` falls through to CodeMirror's default scroll; `true` means handled (no further scrolling). Use `true` (not `false`) when the match is already inside the safe zone and you want to suppress any scroll, otherwise the default handler will run and undo your no-op.
