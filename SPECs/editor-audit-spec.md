# Editor Audit Spec (Prosemark / CodeMirror)

## Summary

Audit of the markdown editor: `apps/desktop/src/components/editor-area/`,
`apps/desktop/src/lib/prosemark-core/`, and the keystroke path through
`stores/editor-store.ts`. Findings are grouped as confirmed bugs, performance
problems on the keystroke path, and structural drift. Each finding names the
file and line, states the fix, and says how it was verified. Proposed
implementation order is at the end; items are independent unless noted.

Verification baseline: `vp test` passes (40 files, 552 tests). Three findings
were reproduced with a throwaway vitest probe (reproduction snippets inline);
the rest are from reading the code against CodeMirror's dispatch semantics
(`node_modules/@codemirror/view/dist/index.js`, `runHandlers`: DOM handlers stop
at the first handler that returns `true`).

## A. Confirmed bugs

### A1. Titled links render their title when folded

`lib/prosemark-core/hide/index.ts:65-71` hides `LinkMark` and `URL` inside a
`Link`, but Lezer emits `LinkTitle` as a sibling of `URL`:

```
Link="[text](http://x.y \"the title\")" | LinkMark="[" | LinkMark="]" | LinkMark="(" | URL="http://x.y" | LinkTitle="\"the title\"" | LinkMark=")"
```

So `[text](url "title")` folds to `text"title"`. The table-cell renderer already
hides `LinkTitle` (`table-decorations.ts:104-109`); the main hide spec does not.

Fix: add `"LinkTitle"` to `subNodeNameToHide`. Test: hide decorations over a
titled link cover the title range.

### A2. List prefix guard and Backspace fire on non-list lines

`listPrefixSelectionGuard` (`list/index.ts:333`) and `listBackspace`
(`list/index.ts:677`) use the regex-only `parseBulletTaskLineAt`, with no syntax
tree check. `listEnter`, `listIndent`, `listOutdent` gate on the tree-based
`isOnListLine`. Result: inside a fenced code block containing `- item`, the
caret cannot be placed between `-` and the space (clamped to body start), and
Backspace at body start deletes `- ` as a list operation.

Reproduced:

````ts
const doc = "```\n- item\n```\n";
let state = EditorState.create({
  doc,
  extensions: [markdown({ extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }), listExtension],
});
ensureSyntaxTree(state, doc.length, 1000);
const between = doc.indexOf("- item") + 1;
state.update({ selection: EditorSelection.cursor(between) }).state.selection.main.head; // 6, expected 5
````

Same file also carries six overlapping "is this a list line" definitions that
disagree with each other: `BULLET_TASK_LINE_RE` (space only after marker),
`LIST_LINE_PREFIX_RE`, `EMPTY_LIST_LINE_RE`, the inline regex in
`findPrevListItemIndent`, and the two in `computeCheckboxToggle*`; meanwhile the
decoration builder accepts a tab after the marker (`isMarkerTrailingChar`). A
`-\titem` line renders as a list but none of the commands treat it as one.

Fix: one `listLineAt(state, pos): ParsedListLine | null` that combines the
regex with the tree gate, is the only entry point for the guard and every
command, and is the single owner of the prefix grammar. Tests: the probe above,
Backspace inside a fence, tab-after-marker parity between rendering and Enter.

### A3. Tree-derived ViewPlugins never rebuild when the parse advances

`headingPlugin` (`heading-decorations.ts:173`), `codeBlockDecorationsExtension`
(`codeFenceExtension.ts:140`), and `blockQuoteExtension` (`blockQuote.ts:104`)
rebuild only on `docChanged || viewportChanged`. `viewportParsePlugin`'s
`forceParsing` dispatch changes neither. After a jump into an unparsed region
(Cmd+G, section rail click, anchor navigation) headings lack the
`.cm-markdown-heading` padding and hanging hash, fences lack the code
background, and blockquotes lack the bar until the user scrolls again.
`docs/editor.md` says new tree-derived fields "heal for free"; that holds only
for the StateFields that carry the `syntaxTree(startState) !== syntaxTree(state)`
guard.

Fix: add the same guard to the three plugins via a shared
`treeChanged(update)` helper in `prosemark-core/utils.ts`; update the doc to say
ViewPlugins need it too. Test: mount an `EditorView` (jsdom) on a document longer
than the initial parse budget, dispatch `forceParsing`, assert the heading line
decoration appears.

### A4. `foldTreeSync` is a stale workaround, duplicated, and costs three rebuilds per parse commit

`table-decorations.ts:574` and `mermaid-decorations.ts:207` each install a
plugin that, on any tree change, `setTimeout`-dispatches `{ selection }` to
"nudge" the fold field. The fold field has rebuilt on tree change itself since
commit `7a20396` (`fold/core.ts:87`). Today every parse commit therefore
triggers one real rebuild plus two follow-up transactions, each of which
re-runs hide/fold/list rebuilds, `headingSelectionGuard`, `updateCursorPos`, and
`bumpDocVersion`. The mermaid copy's comment ("foldExtension only rebuilds on
docChanged/selection", "same pattern as table-decorations.ts") is wrong.

Fix: delete both plugins. No test needed beyond the existing table/mermaid
suites.

### A5. Oversized image paste is silently dropped

`handleImagePaste` (`use-prosemark-editor.ts:244`) returns without feedback when
the clipboard image exceeds 5 MB. The paste appears to do nothing. Violates the
"fail explicitly" guardrail.

Fix: show the limit through the existing anchor-warning banner
(`showAnchorWarning` is the closest surface; rename it to a general editor
notice if reused) and `console.error`.

### A6. `prosemarkBasicSetup` carries dead and conflicting code-editor defaults

`lib/prosemark-core/basicSetup.ts`:

- `clickLinkExtension` + `defaultClickLinkHandler` never run: the app's
  `linkNavigationExtension` is `Prec.highest` and returns `true` on mousedown,
  and CodeMirror stops at the first `true`. If it ever did run it would call
  `window.open` inside the Tauri webview.
- `prosemarkMarkdownFormattingKeymap` (Mod-b/i/k/Shift-x) is shadowed by the
  app's `markdownFormatting` (`Prec.high`) and disagrees with it (`_` vs `*`
  for italic).
- `foldGutter()` builds gutter markers on every viewport update for a gutter
  hidden with `display: none` (`prosemark-theme.css:178`).
- `lintKeymap` with no linter; `searchKeymap` leaks `Mod-d`, `Mod-Shift-l`,
  `Mod-Alt-g` into a prose editor, and its `Escape` binding calls
  `closeSearchPanel` directly. With the search overlay open and focus in the
  editor, Escape removes CodeMirror's hidden panel (match highlights vanish)
  while `useEditorSearchStore.isOpen` stays `true` and the React overlay stays
  on screen.
- `autocompletion()` here and `autocompletion({ override })` in
  `wiki-link-extension.ts` both register; configs merge, so this is harmless
  but confusing.

Fix: trim `basicSetup` to what Writer uses (history, dropCursor, defaultKeymap,
historyKeymap, closeBrackets if kept, lineWrapping, and the prosemark
extensions); bind Escape to `closeEditorSearch` in the app keymap alongside
Mod-f/Mod-g. Decide explicitly whether `closeBrackets`, `bracketMatching`, and
`indentOnInput` belong in a prose editor; they auto-close `"`, `(`, `[` today.

## B. Performance on the keystroke path

### B1. Four full-document passes per keystroke outside CodeMirror

`EditorView.updateListener` (`use-prosemark-editor.ts:656`) calls
`editorApi.updateContent(path, doc.toString())` on every doc change. The store
(`editor-store.ts:1086`) then runs `inferTitle` and `getDocumentStats` on the
full string, and `useDocumentHeadings` (subscribed by `SectionRail` through
`useFileContent`) re-splits the whole document into lines on every content
change. `getDocumentStats` additionally does `Array.from(normalized…)` to count
characters, allocating one string per code point.

Measured (`getDocumentStats` alone, synthetic prose):

| document | ms per call |
| -------- | ----------- |
| 50 KB    | 4.8         |
| 200 KB   | 14.9        |
| 800 KB   | 78.6        |

Fix, in two steps: (1) count code points without allocation and drop the
redundant `normalize` passes; (2) make stats and headings deferred derivations
(throttled ~150 ms, flushed on tab switch and save) since the footer and the
rail do not need keystroke-accurate values. Keep `content` synchronous so save
and swap stay correct.

### B2. Fold and hide fields walk the whole tree, and fold builds a path string per node

`fold/core.ts:21-73` iterates every node in the document on every doc change
and every selection change, and for each node builds a `lineage` array and
joins it into a path string before checking any spec (lines 28-35). All eight
registered specs use a bare node name (`Table`, `FencedCode`, `HTMLBlock`,
`Math`, `Image`, `HorizontalRule`, `Dash`, `Emoji`). `hide/core.ts:38` also
re-runs `checkSpec` over all specs on every rebuild.

Fix: at facet-combine time index specs by terminal node name
(`Map<string, FoldableSyntaxSpec[]>`); in `enter`, look up by `node.name` and
build the path only for specs whose `nodePath` contains `/` or is a function.
Compute `selectionTouchesRange` lazily. Move `checkSpec` into `combine`. This is
the cheapest large win for long documents because these run on caret moves,
not only edits.

### B3. Heading selection guard force-parses the whole document

`headingSelectionGuard` (`heading-decorations.ts:238-252`): whenever any
selection endpoint is within 7 characters of a line start (every Enter, the
first characters of any line, clicks near the margin) it walks the entire tree
via `collectHeadingNoGoZones`, and when the transaction changed the document it
first calls `ensureSyntaxTree(state, state.doc.length, 50)`: a synchronous parse
of the whole document with a 50 ms budget, per keystroke, until the document is
fully parsed. `findZoneEndingAt` (line 257) walks the whole tree on every
ArrowLeft at a heading start.

Fix: zones are per line. Parse only to the end of the furthest endpoint line
and iterate only the endpoint lines (`tree.iterate({ from: line.from, to:
line.to })`). Same for `findZoneEndingAt`.

### B4. HTML block sanitisation runs on every selection change

`html-block-decorations.ts:205` calls `sanitizeHTML` (DOMParser + tree walk +
DOMPurify) inside `buildDecorations`, which the fold field runs on every doc and
selection change, once per HTML block, with no cache.

Fix: bounded LRU keyed by raw block text, matching `mermaid-renderer.ts` and
`math-renderer.ts`. Extract the shared LRU into `lib/lru.ts` while here; the
two renderers already duplicate it.

### B5. Blockquote measure pass per keystroke

`blockQuote.ts:38-71` iterates the whole tree and calls `coordsAtPos` twice per
nested `QuoteMark` inside `requestMeasure` on every doc change and viewport
change.

Fix: restrict to `view.visibleRanges` and add the tree-change guard from A3.

### B6. Tab switch rebuilds the whole extension set twice to reset history

`use-prosemark-editor.ts:813-822` reconfigures the entire `prosemarkBasicSetup`
compartment to `[]` and back. That tears down and recreates the hide, fold, and
list StateFields (two full rebuilds against the old document) plus every keymap,
before the document swap triggers a third rebuild. The comment claims this
preserves decoration plugins; it does not for the ones inside `basicSetup`.

Fix: put only `history()` in the compartment.

### B7. Image `src` resolution via a subtree MutationObserver

`image-src-resolver.ts` observes `childList` on the whole editor DOM and walks
`addedNodes` with `querySelectorAll("img")` on every DOM update.

Fix: an `imageSrcResolver` facet read by `ImageWidget.toDOM`,
`ImageEmbedWidget.toDOM`, and `HtmlBlockWidget.toDOM`. Removes the observer and
the one-frame window where an image is inserted with an unresolved `src`.

### B8. Arrow-key widget reveal scans every fold decoration

`revealBlockOnArrow.ts:17,44` iterates the full fold decoration set from the
start on every ArrowUp/Down, twice. Use `decorations.between(lineAbove.from,
lineBelow.to, …)`.

## C. Structure and drift

### C1. Duplicated helpers

- Link URL extraction exists three times: `getLinkHref`/`getRawUrl`
  (`use-prosemark-editor.ts:296-333`), `getUrlFromLink`/`getRawUrl`
  (`prosemark-core/clickLink.ts`), `linkHref` (`table-decorations.ts:293`).
- `findScrollContainer` and `findOuterScroller` (`use-prosemark-editor.ts:92-110`)
  are the same function.
- `scrollHeadingIntoView` (`use-prosemark-editor.ts:339`) and `scrollToHeading`
  (`section-rail.tsx:31`) are the same function.
- `selectAllDecorationsOnSelectExtension` (`fold/core.ts:114`) and
  `htmlBlockSelectOnMouseDown` (`html-block-decorations.ts:288`) are the same
  with an interactive-target filter added. Give the core helper an optional
  `ignoreTarget` predicate.
- `onPaste` and `onPastePlain` (`use-prosemark-editor.ts:481-492`) are
  identical; "Paste as plain text" is a no-op duplicate menu item.

### C2. Editor commands are registered in three places

`formattingCommands` (`markdown-formatting.ts:361`) holds ids and chords; an
`extraCommands` record is rebuilt inside `onRunCommand` on every invocation
(`use-prosemark-editor.ts:510`); `editor-context-menu.ts` hardcodes the ids a
third time along with hand-written accelerator strings (`"CmdOrCtrl+B"` vs
`"Mod-b"`). Adding a command touches three files.

Fix: one registry `{ id, run, label, chord? }`; derive the keymap, the menu
items, and the accelerator display from it (chord → accelerator is a pure
string mapping).

### C3. Two independent caret-clamping transaction filters

`headingSelectionGuard` and `listPrefixSelectionGuard` each implement "compute
no-go zones for the lines under the selection, clamp, return
`[tr, { selection }]`". A shared `caretNoGoZones` facet (each extension
contributes `(state, line) => Zone[]`) behind a single filter makes the next
one (table source lines, math) a one-file change, and lets B3's line scoping
apply to both.

### C4. `use-prosemark-editor.ts` is 860 lines of mixed concerns

Extension assembly, link navigation, context menu wiring, image and
frontmatter paste, the frontmatter `---` shortcut, viewport parse plumbing, and
the React hook live in one file. Split into `link-navigation.ts`,
`editor-clipboard.ts`, `viewport-parse.ts`, `editor-extensions.ts`, and keep
the hook to mount/swap/dispose.

### C5. Stale documentation and comments

- `docs/editor.md` File map: mermaid is described as "canonical conditional
  replace ↔ widget" and table as "canonical replace-only". Both are inverted
  today: mermaid always replaces (editing happens in-canvas, no
  `selectionTouchesRange` branch); table is conditional replace ↔ source-line
  styling.
- `docs/editor.md` "Block widgets" section cites mermaid for the
  `selectionTouchesRange`-driven edit-mode pattern that no longer exists.
- `drag-selection-gate.ts:96-101` justifies the `.cm-mermaid-widget` skip with
  an `editMode` freeze that no longer exists and cites `mermaid-canvas.ts:160`.
- `mermaid-decorations.ts:146` declares a hand-rolled structural type for
  `parseFencedCode` instead of `SyntaxNodeRef`; `MermaidWidget.eq` compares
  `body` and `fenceText` when `fenceText` alone determines both.
- `list/index.ts:78` hardcodes `text-indent: -3.4ch` against
  `LIST_UNIT_CH = 3` with no comment explaining the 0.4.

## Status

All five groups landed as one commit each (see `git log` for
`editor-audit-spec`). Deliberately left as-is:

- C3 (shared caret no-go-zone facet): deferred until a third clamp source
  exists.
- `closeBrackets()` stays in the basic setup; whether a prose editor should
  auto-close `"`, `(`, `[` is a product decision, not a bug.
- The `-3.4ch` ordered-list `text-indent` is left unexplained rather than
  guessed at.
- Test fixtures now commit the full parse via `tests/helpers/parsed-state.ts`
  (`withFullParse`); the pre-existing intermittent failures in the mermaid and
  fold tests came from `EditorState.create`'s wall-clock parse budget expiring
  under a loaded runner.

## Proposed order

1. **Zero-risk cleanups** (one PR): A4 delete `foldTreeSync` ×2; B6
   history-only compartment; A1 `LinkTitle`; A3 tree-change guard in three
   plugins; C1 dedupes; C5 doc and comment fixes. Tests: titled-link hide,
   heading rebuild after `forceParsing`.
2. **Keystroke performance** (one PR, measured before/after with the 200 KB and
   800 KB fixtures from B1): B1, B2, B3, B4, B5, B7, B8.
3. **List consolidation** (one PR): A2 with the probe as a regression test.
4. **Setup and commands** (one PR): A6 basicSetup trim and Escape binding, A5
   paste error, C2 command registry.
5. **Mechanical split** (one PR): C4, then C3 if the third clamp source shows
   up.
