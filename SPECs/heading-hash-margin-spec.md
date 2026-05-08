# Hanging ATX Heading Hash Markers Spec

## Goal

Render `#`/`##`/…/`######` hash markers for ATX headings in the left margin
**outside** the inner text column, so heading text aligns flush with body
content. This is the typographic treatment used by Typora, iA Writer, Bear,
and Notion.

The hash characters remain part of the markdown source — they are visually
relocated, not removed. The caret can still be placed inside them; clicking
on the margin hash places the caret in the hash region; selection across the
heading boundary highlights them correctly. Visual style is muted (~`var
(--text-muted)`) and at the same font size as the heading text.

## Current Behavior

Hash characters are managed by `@prosemark/core`'s default hide spec
(`@prosemark/core/dist/main.js:139-144`):

- When the caret is **off** the heading line, the hash range
  `[headerMark.from, min(headerMark.to + 1, node.to)]` (hash chars + the
  trailing space) is wrapped in a `Decoration.mark` with class
  `.cm-hidden-token`, which sets `font-size: 0` so the chars collapse to
  zero width.
- When the caret is **on** the heading line, no hide decoration applies and
  the hash chars render inline at their natural position, pushing the
  heading text to the right.

So today the heading line "jumps" between two layouts depending on caret
state, and there is no margin hanging.

## Design

A `ViewPlugin` scans the syntax tree for `ATXHeading[1-6]` nodes within the
visible ranges and emits two decorations per heading:

1. `Decoration.line` on the heading's first line, with class
   `cm-heading-line cm-heading-line-N` (where N is the level 1-6) and
   `position: relative` so the line forms the containing block.
2. `Decoration.mark` over `[headerMark.from, min(headerMark.to + 1, node.to)]`
   with class `cm-heading-hash`. The same range as prosemark's existing
   hide spec, so when both apply the resulting span carries both classes
   and CodeMirror merges them into a single element.

The CSS pulls the hash span out of the inline flow:

```css
.cm-editor .cm-heading-line {
  position: relative;
}
.cm-editor .cm-heading-hash {
  position: absolute;
  right: 100%; /* right edge of abs box at line's left edge */
  padding-right: 0.4em; /* gap between hash and heading text */
  color: var(--text-muted);
  white-space: pre;
  pointer-events: auto;
  font-size: inherit !important; /* override .cm-hidden-token's font-size: 0 */
}
```

`right: 100%` puts the right edge of the absolutely positioned hash span at
the left edge of its containing block (the line). The hash content extends
to the left, sitting outside the line's box in the page-padding gutter.
`padding-right` creates a small visual gap so the hash doesn't touch the
heading text.

`font-size: inherit !important` is required because prosemark's hide spec
applies `.cm-hidden-token { font-size: 0px }` to the same range. The
specificity ties (both `0,2,0`) and the runtime-injected theme is loaded
after our stylesheet, so `!important` pins our override and keeps the hash
visible in the margin in both caret-on and caret-off states.

Including the trailing space in the mark range matches what prosemark's
hide already does, so `Decoration.mark` ranges align exactly and we never
get a split span.

### Edge cases this design handles

- **Each heading level (`#`–`######`)**. The mark covers however many hashes
  the parser found; CSS doesn't care about count.
- **Caret on the heading**. Hash stays in the margin (overrides hide's
  `font-size: 0`). The chars are real source positions; typing/deleting
  them works as normal — the parser drops the heading when the trailing
  space is removed and our decorations vanish.
- **Click in the margin**. Clicking the absolutely positioned hash places
  the caret at that document position; CodeMirror's `posAtCoords` resolves
  the click to the underlying source positions regardless of the hash's
  visual offset.
- **Selection across the heading boundary**. `drawSelection` paints
  rectangles between caret positions using `coordsAtPos`; for absolutely
  positioned chars it returns their actual rendered coords, so selection
  rects land on the visible hash in the margin.
- **Wrapped headings**. Line wrapping happens inside the `.cm-line`
  element. The absolutely positioned hash is anchored to the line's
  containing block at `top: 0` (default), so it stays at the top-left of
  the first visual line. The wrapped second visual line aligns with the
  line's content edge — same as body text.
- **Mid-line `#`**. The Markdown parser only emits `ATXHeading` for
  hashes at line start followed by a space. Our scan is keyed on
  `ATXHeadingN` node names, so mid-line `#` is never decorated.
- **Heading inside a list item / blockquote**. The line carries the inner
  indent (e.g. blockquote's `padding-inline-start: 1em`). The hash hangs at
  the line element's outer-left edge — at the **absolute** margin, not the
  inner content edge. We accept this as the simpler default;
  list/blockquote-nested headings are uncommon.

## Constraint: clip-path on `.cm-scroller`

The selection-rect-bleed fix
(`SPECs/selection-rect-bleeds-past-text-spec.md`) puts a `clip-path: inset
(0 var(--writer-text-col-inset))` on `.cm-scroller`
(`prosemark-theme.css:78`). This clips the painted output of the entire
scroller subtree to the inner text column.

Anything painted outside the inner text column today is empty space — the
clip turns empty space into clipped empty space. **But the design above
paints the hash outside the inner text column, so the clip eats it.** The
hash decoration as written produces zero visible change.

The selection-rect spec explicitly considered and rejected applying the
clip on `.cm-selectionLayer` instead: that layer has `position: absolute;
left: 0; top: 0; contain: size style` and no width/height, so a layer-level
clip-path either clips everything or nothing depending on browser
interpretation. The clip lives at `.cm-scroller` because that's the only
layer with real dimensions to clip against.

The `.cm-cursorLayer`, mermaid widgets, html-block widgets, table widgets
and search match decorations all live inside the inner text column; the
clip is invisible to them. Hanging heading hashes are the first proposed
content that would render outside the column.

## Options

### A. Relax the scroller clip on the left, pin selection elsewhere

Adjust the clip to expose ~4rem additional space on the left so heading
hashes can render in the page-padding gutter, and pin selection rendering
to the inner text column some other way.

The selection-rect spec considered an "Option K" fallback (a manual
selection layer that copy-pastes CodeMirror's `rectanglesForRange` with
clamped bounds) and rejected it as overkill for the original bug. With
hanging-hash on the table, Option K becomes the natural fix: a custom
selection layer renders rectangles already clamped to the text column, the
scroller's clip can be removed entirely, and both the original
selection-bleed bug and the hanging-hash use case are solved.

This is a substantial change — it overlaps with the work the
`writer-selection-bug` sibling session is doing. Coordination required.

### B. Render hashes via a sibling overlay outside `.cm-scroller`

Render the hash markers in a separate absolutely-positioned overlay element
that's a sibling of `.cm-scroller`, so it isn't subject to the clip. The
plugin tracks heading line positions on scroll/layout and updates the
overlay positions. Caret/click interaction would have to be brokered
through `posAtCoords`-style lookups since the hash chars wouldn't be in
the editor's contentDOM.

Cleaner separation but a lot more moving pieces — scroll listeners,
positional sync, focus/click handling — for a small visual feature. Doesn't
help the underlying selection-bleed bug.

### C. Render hashes inside the text column, accept heading-text offset

Use `padding-left: 3em` on the heading line plus a 3em-wide hash mark
right-aligned at the line start. Hash sits in the leftmost 3em of the
text column; heading text starts 3em to the right. Heading text is then
**not** flush with body text — the user's stated requirement is sacrificed.

Trivial to implement and ships within the clip without touching selection.
A reasonable fallback if A and B are deemed too costly, but doesn't match
the iA Writer / Bear typography.

## Recommendation

**Option A**, scoped together with the `writer-selection-bug` work.
Replacing the clip-path with a manual selection layer that's already
clamped solves both problems in one structural change. Implementing
hanging hashes today against the current clip would require Option B (a
separate overlay layer) — workable but disproportionate effort for a
visual treatment.

If A/B are not on the near-term roadmap, Option C is the pragmatic ship.

## Implementation Sketch (for Option A or B)

The decoration-side code is identical for either option — the difference
is whether the scroller clip is removed (A) or the hash is rendered to a
sibling overlay (B):

```ts
// apps/desktop/src/components/editor-area/heading-decorations.ts
const ATX_HEADING_RE = /^ATXHeading([1-6])$/;
const hashMark = Decoration.mark({ class: "cm-heading-hash" });
const lineDecos: Record<number, Decoration> = {};
for (let level = 1; level <= 6; level++) {
  lineDecos[level] = Decoration.line({
    attributes: { class: `cm-heading-line cm-heading-line-${level}` },
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const m = ATX_HEADING_RE.exec(node.name);
        if (!m) return undefined;
        const level = Number(m[1]);
        const lineFrom = view.state.doc.lineAt(node.from).from;
        decos.push({ from: lineFrom, to: lineFrom, deco: lineDecos[level]! });
        const cursor = node.node.cursor();
        if (cursor.firstChild() && cursor.name === "HeaderMark") {
          const hashEnd = Math.min(cursor.to + 1, node.to);
          decos.push({ from: cursor.from, to: hashEnd, deco: hashMark });
        }
        return false; // skip children
      },
    });
  }
  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    decos.map(({ from, to, deco }) => deco.range(from, to)),
    true,
  );
}

export const headingDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
```

Wired in `use-prosemark-editor.ts` alongside the other decoration plugins,
plus the CSS shown in [Design](#design).

## Test Plan

Manual verification with `vp dev`:

1. Open a document with all six heading levels and confirm hashes hang in
   the margin, muted, with the heading text aligned with body paragraphs.
2. Click on a heading line — hashes stay in the margin and the caret lands
   inside the hash region when clicking the hash.
3. Drag a selection from a body line into and across a heading; selection
   rects highlight the hash in the margin.
4. Type `## ` at the start of a fresh line; decoration applies as soon as
   the parser recognises the heading. Delete the trailing space; decoration
   disappears.
5. Long heading that wraps to two lines — second visual line aligns with
   body content, hash stays at the top-left.
6. Heading inside a blockquote — hash hangs at the absolute margin (left of
   the blockquote bar). Acceptable for v1.
7. With multiple headings spread across the document, scroll up/down; hashes
   stay anchored to their lines without flicker.

Automated coverage isn't strictly required — the decoration is purely
visual — but a smoke test that mounts an `EditorView` and asserts the
heading line carries `.cm-heading-line-2` and the span carries
`.cm-heading-hash` would catch regressions in the syntax-tree walk.
