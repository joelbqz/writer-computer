# Nested List Editing Audit

## Problem

A user writing in Writer during a live meeting reported "at some point I got
into a nested bullet points issue that I can't repro now", with no further
detail. This spec is the written trail of a systematic bug hunt over the
nested bullet/task list editing path: every scenario tried, what happened,
and what was changed. Scenarios that pass are recorded too, so the next
person does not repeat them.

Method: each scenario is driven through `EditorState` and the real commands
(`listIndent`, `listOutdent`, `listEnter`, `listBackspace`,
`computeCheckboxToggle`, `toggleBulletList`, `toggleTaskList`) with a fully
committed syntax tree (`withFullParse`), and the resulting document plus the
depth each line renders at (read back from `listDecorationsField`) are
compared to the expectation. `|` marks the caret; `·` is a space, `→` a tab.
Rendering-only behaviour (wrapping, hanging indent) is not observable this
way and is listed under "Not exercised".

## Results

FAIL rows are bugs that reproduced and were fixed in this task. PASS rows
passed before and after. NOTE rows are behaviours that match the existing
specs but are worth knowing about.

### 1. Markers and ordered parents

| Scenario                              | Before                     | Expected                | Result               |
| ------------------------------------- | -------------------------- | ----------------------- | -------------------- |
| Tab on `- b` under `* a`              | `* a⏎··- b`                | nested                  | PASS                 |
| Tab on `+ b` under `- a`              | `- a⏎··+ b`                | nested                  | PASS                 |
| Tab on `- b` under `1. a`             | no-op (`1. a` never found) | `1. a⏎···- b` (depth 1) | FAIL, fixed          |
| Shift-Tab on `···- b` under `1. a`    | `- b`                      | `- b`                   | PASS                 |
| Enter at end of `···- b` under `1. a` | `···- ` continuation       | same                    | PASS                 |
| Tab on `1. b` under `- a`             | no-op by design            | nests as `··1. b`       | Now nests (see note) |
| Tab on `2. b` under `1. a`            | no-op by design            | nests as `···2. b`      | Now nests (see note) |

Note: ordered items nest and outdent through the same tree-based path now.
Ordered lines keep their fixed 3ch hanging indent, so a nested ordered item
shows its leading source spaces rather than a depth-aware marker column. That
is a rendering follow-up, not a structural problem; the markdown is correct.

### 2. Enter on nested items

| Scenario                                   | Before                             | Expected                        | Result          |
| ------------------------------------------ | ---------------------------------- | ------------------------------- | --------------- | ----------- | ----------- |
| Enter at end, depth 2 and 3                | new line with same indent + marker | same                            | PASS            |
| Enter mid-body, depth 2                    | split, tail carries the prefix     | same                            | PASS            |
| Enter at body start, depth 2               | empty item above, text below       | same                            | PASS            |
| Enter on empty `····-                      | ` (depth 2)                        | line wiped, caret on blank line | outdent to `··- | `           | FAIL, fixed |
| Enter on empty `··-                        | ` (depth 1)                        | line wiped                      | outdent to `-   | `           | FAIL, fixed |
| Enter on empty depth-3 task                | line wiped                         | outdent, keep `[ ] `            | FAIL, fixed     |
| Enter on empty `-                          | ` (top level)                      | line wiped, caret on paragraph  | same            | PASS        |
| Enter on empty nested item in a loose list | line wiped                         | outdent to `-                   | `               | FAIL, fixed |

### 3. Backspace on nested items

| Scenario                           | Before                     | Expected (per list-prefix-interaction-zones-spec) | Result       |
| ---------------------------------- | -------------------------- | ------------------------------------------------- | ------------ | ---- |
| Backspace at body start, depth 2   | `··c` (marker + one level) | same                                              | PASS         |
| Backspace at marker start, depth 2 | `··- c` (one level)        | same                                              | PASS         |
| Backspace at body start, depth 1   | `b`                        | same                                              | PASS         |
| Backspace on empty `····-          | ` (depth 2)                | `··` (whitespace-only line)                       | same by spec | NOTE |
| Backspace on empty `··-            | ` (depth 1)                | `` (empty line)                                   | same         | PASS |
| Backspace at marker start, `→- b`  | `- b`                      | same                                              | PASS         |

Note: the depth-2 empty case leaves two invisible spaces on the line, which
the spec's "remove the marker and one indent level" rule produces literally.
Listed as a follow-up in TODOS.md rather than changed here, since the spec is
explicit.

### 4. Mixed indentation

| Scenario                                          | Before                                       | Expected                  | Result      |
| ------------------------------------------------- | -------------------------------------------- | ------------------------- | ----------- |
| Tab on `····- c` after `····- b` (4-space parent) | `······- c` nested                           | same                      | PASS        |
| Tab on `→- c` after `→- b` (tab parent)           | `··→- c`, still depth 1 (spaces before tab)  | `→··- c`, depth 2         | FAIL, fixed |
| Tab on `→- b` under `- a` (already nested)        | `·→- b`, still depth 1 (junk space)          | no-op                     | FAIL, fixed |
| Shift-Tab on `→- c`                               | `- c`                                        | same                      | PASS        |
| Shift-Tab on `→··- c` under `→- b`                | `- c` (jumps two levels, 2 chars removed)    | `→- c`                    | FAIL, fixed |
| Tab on `···- c` (3-space sibling of `··- b`)      | `····- c` nested under b                     | same                      | PASS        |
| Tab on `··- d` after the 3-space `···- c`         | `····- d`, still depth 1; needs a second Tab | `·····- d` nested under c | FAIL, fixed |
| Shift-Tab on `···- c`                             | `··- c`, still depth 1; needs a second press | `- c` (depth 0)           | FAIL, fixed |
| Enter after `···- c`                              | `···- ` continuation                         | same                      | PASS        |

The user can always get out of the 3-space case: Shift-Tab now lifts the
item to its parent's indent in one press.

### 5. Task items

| Scenario                                  | Result                    |
| ----------------------------------------- | ------------------------- |
| Tab on `- [ ] c` under a nested bullet    | PASS                      |
| Tab on `- c` under a nested task          | PASS                      |
| Enter at end of a depth-2 checked task    | PASS (new item unchecked) |
| Backspace at body start of a depth-2 task | PASS                      |
| `computeCheckboxToggle` at depth 2 marker | PASS                      |
| Line-based toggle fallback at depth 2     | PASS                      |
| Toggle on a task nested under `1.`        | PASS                      |

### 6. Inline body content and hard-wrapped items

Bold, link, inline code, bold-only, and bold task bodies all render at the
right depth; Tab and Enter on them behave like plain bodies. PASS. The old
`feature/fix-bold-list-wrap` branch touched `softIndentExtension.ts`, which no
longer exists: list geometry moved to line-level padding in the list rewrite
(#60), so that fix is moot rather than regressed. Soft wrapping of a long
single source line is CSS (`padding-inline-start` + negative `text-indent`
on the marker line) and unchanged.

| Scenario                                                      | Before                                                       | Expected                                              | Result      |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | ----------- |
| Hard-wrapped item: `- one two⏎··three four` (reported)        | continuation line at the left margin, its two spaces visible | continuation padded to the body column, indent hidden | FAIL, fixed |
| Lazy continuation with no indent (`- one⏎two`)                | at the left margin                                           | padded to the body column                             | FAIL, fixed |
| Continuation of a nested item, a nested task, an ordered item | at the left margin                                           | padded by that item's own depth                       | FAIL, fixed |
| A nested item's own line, a blank line, a later paragraph     | untouched                                                    | untouched                                             | PASS        |

Reported by the user with a screenshot after the first round: only the
marker line of an item was decorated, so an item whose paragraph continues
on further source lines (how most formatters and editors write long items)
lost its hanging indent there. `buildListDecorations` now pads every
continuation line of the item's own `Paragraph`/`Task` node by the item's
prefix width and collapses the leading whitespace with an atomic replace
decoration (`listContinuationIndentDecoration`). Verified in the built app
with `e2e/specs/nested-list.spec.js`, which checks the body text starts at
the same x on the marker line and its continuations.

### 7. Multi-line selections across depths

| Scenario                                                | Before                                       | Expected                                 | Result      |
| ------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- | ----------- |
| Tab with `- a`, `··- b`, `····- c` selected under `- x` | a moves, b and c stay: b becomes a's sibling | whole subtree shifts one level           | FAIL, fixed |
| Tab with `- b`, `··- c`, `- d` selected under `- a`     | b moves, c stays, d moves                    | b, c, d all shift one level              | FAIL, fixed |
| Shift-Tab with a parent and children selected           | all shift (fixed 2 chars)                    | same                                     | PASS        |
| Shift-Tab, tab-indented parent + child selected         | child loses 2 chars (`\t` + space)           | child loses the parent's whitespace only | FAIL, fixed |
| Tab with nested siblings `··- b`, `··- c` selected      | c nests under b                              | same                                     | PASS        |
| Tab with everything selected, root can't nest           | no-op                                        | no-op                                    | PASS        |
| Undo after a selection Tab                              | restores document and selection              | same                                     | PASS        |

### 8. Loose lists, continuation lines, stale trees

| Scenario                                                               | Before                            | Expected               | Result      |
| ---------------------------------------------------------------------- | --------------------------------- | ---------------------- | ----------- |
| Tab on `- b` after `- a` + blank line                                  | no-op (blank line ended the scan) | `··- b` nested         | FAIL, fixed |
| Tab on `··- c` after `··- b` + blank line                              | no-op                             | `····- c` nested       | FAIL, fixed |
| Shift-Tab across a blank line                                          | `- b`                             | same                   | PASS        |
| Tab on a continuation line (`··cont`)                                  | falls through to `indentWithTab`  | same (not a list line) | PASS        |
| Depths: loose nested list, continuation, paragraph under a nested item | 0,1,1 / 0,-,1 / 0,1,-,-,1         | same                   | PASS        |
| Tab on a list line beyond the committed parse                          | falls through to `indentWithTab`  | see note               | NOTE        |

Stale-tree note. `listDecorationsField` rebuilds on every `docChanged` from
the committed tree, and on the tree changing (parse commits from the idle
worker or `viewportParsePlugin`). After a keystroke the language plugin
re-parses incrementally with a 20 ms budget, so the caret's region is
essentially always covered. If that budget is blown (very long document,
lots of list items below the caret), lines past the parse frontier render
as bare paragraphs until the next idle commit (`Work.MaxPause` = 500 ms), and
during that window Tab on such a line is not a list Tab: `isOnListLine` is
false, so `indentWithTab` inserts a literal tab. Reproduced only
artificially, with a 300 kB document constructed without a full parse. Not
changed here; recorded as a follow-up in TODOS.md. This is the most likely
explanation for a transient "nested bullets went weird, can't repro"
report on a long document, alongside the selection-Tab and empty-item-Enter
bugs above on a short one.

### 9. Paste

Pasting `- p⏎··- q` after `- a` renders 0,0,1; selecting the pasted lines and
pressing Tab yields `··- p⏎····- q`. PASS (the selection fix applies).

### 10. Bullet list shortcut (Cmd+Shift+8) and task toggle

| Scenario                                    | Before        | Expected    | Result      |
| ------------------------------------------- | ------------- | ----------- | ----------- |
| Cmd+Shift+8 on `··- b`                      | `-···- b`     | `··b`       | FAIL, fixed |
| Cmd+Shift+8 on indented plain `··text`      | `-···text`    | `··- text`  | FAIL, fixed |
| Cmd+Shift+8 with `- a` and `··- b` selected | `-···- b`     | `a⏎··b`     | FAIL, fixed |
| Task toggle on `··- b`                      | `- [ ]···- b` | `··- [ ] b` | FAIL, fixed |
| Task toggle on top-level `- b`              | `- [ ] - b`   | `- [ ] b`   | FAIL, fixed |

`-···- b` is a real nested structure per CommonMark (an empty bullet whose
content is a nested bullet), which is a plausible "nested bullet points
issue" for someone hitting the shortcut on an already-nested line.

## Changes

- `apps/desktop/src/lib/prosemark-core/list/index.ts`: Tab and Shift-Tab
  find their reference item in the syntax tree (`listItemLineAt`,
  `prevListItem`, `parentListItem`) instead of scanning previous lines for a
  smaller indent. Tab nests under the previous item at the same level using
  that item's real content column (its leading whitespace plus the marker
  span rendered as spaces, tabs preserved). Shift-Tab lifts to the parent's
  leading whitespace. Both single-caret and multi-line selection go through
  one `reindentListLines` command; in a selection, lines indented deeper
  than the last self-targeted line move with it. Enter on an empty nested
  item re-indents it to the parent's level (keeping its marker and task box)
  instead of wiping the line.
- `apps/desktop/src/components/editor-area/markdown-formatting.ts`: the
  bullet and task toggles keep leading indent, toggle nested lines in place,
  and turn a bullet into a task in place.
- `buildListDecorations` pads hard-wrapped items' continuation lines and
  collapses their source indent (see section 6).
- Tests: `tests/list-extension.test.ts` (65 → 99 cases),
  `tests/editor-formatting.test.ts` (+8); `e2e/specs/nested-list.spec.js`
  for the rendered result.

## Second pass

A re-audit after the four list PRs (#136, #137, #138 and the toggle fix)
merged, probing the merged code with the same method. The gap class, the
empty-item Enter outdent, the selection Tab, tab-indented lists, and the
bullet/task toggles all held up. Three inconsistencies were found and fixed.

| Scenario                                                               | Before                                                        | Expected                                              | Result      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- | ----------- |
| Loose item with a second paragraph: `- a⏎⏎··b one⏎··b two`             | `b one` at the margin with its spaces visible; `b two` padded | both lines padded, indent hidden                      | FAIL, fixed |
| Second paragraph of an item that also holds a nested list              | unpadded                                                      | padded by the item's depth                            | FAIL, fixed |
| Backspace at marker start of `→→- c` under `→- b`                      | `- c` (two characters removed, two levels)                    | `→- c`                                                | FAIL, fixed |
| Backspace at marker start of `···- b` under `1. a`                     | `·- b` (one stray space)                                      | `- b`                                                 | FAIL, fixed |
| Tab on `- b one⏎··b two` (caret on the marker line)                    | `··- b one⏎··b two` (wrapped line left behind as a lazy line) | `··- b one⏎····b two`                                 | FAIL, fixed |
| Shift-Tab on `→- b one⏎→··b two`                                       | wrapped line keeps its tab                                    | `- b one⏎··b two`                                     | FAIL, fixed |
| Tab / Shift-Tab with a lazy wrapped line indented less than the marker | untouched                                                     | untouched (it has no position relative to the marker) | PASS        |
| Enter on a continuation line                                           | lang-markdown continues the paragraph with `⏎··`              | same                                                  | PASS        |
| Single-caret Tab on a parent: `- a⏎- b⏎··- c`, Tab on b                | `··- b⏎··- c` (c becomes b's sibling)                         | open question, see below                              | NOTE        |
| List inside a blockquote with a wrapped line: `> - one⏎>···two`        | padded, but the spaces after `>` stay visible                 | collapsed                                             | NOTE        |
| `- - b` (nested marker on the same line)                               | two conflicting line decorations on one line                  | one                                                   | NOTE, older |

The first three rows share one cause: the marker line and the item's other
lines were handled by three different pieces of code. `itemParagraphLines`
now lists every line of an item's own `Paragraph`/`Task` children other
than the marker line, and both the decoration builder and
`reindentListLines` read from it, so an item renders and moves as one unit.
Backspace at the marker or body start takes its whitespace from
`reindentTarget("outdent")`, the same target Shift-Tab uses, instead of a
fixed two characters.

Single-caret Tab on a parent is a design choice rather than a bug: Obsidian
indents only the caret's line (as Writer does), Notion and Bear move the
subtree. Left as is; the selection path already moves the subtree for users
who want that. The blockquote and same-line-marker rows predate these PRs
and are cosmetic in rare documents.

## Third pass: leaving a list

Reported with a recording after the second pass: Enter on an empty bullet in
the middle of a list, then typing, and the text joined the item above. The
markdown was `- a⏎What`, a lazy continuation of `a` per CommonMark, which the
continuation padding from section 6 now renders truthfully. The dev build in
the recording predated the Enter fix, but the report held after a restart, so
the two remaining routes to the same markdown were closed and every route was
verified in the built app (`e2e/specs/list-enter-exit.spec.js`, driven with
synthetic keydown events and `execCommand("insertText")`, the same input path
a keyboard uses).

| Route                                                              | Before                                                       | After                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Enter on `- ⏐` under `- a`                                         | `- a⏎⏐` → typing joins `a`                                   | `- a⏎⏎⏐`, typing is a paragraph                                                  |
| Enter, then Backspace on `- ⏐`                                     | `- a⏎⏐` → joins                                              | `- a⏎⏎⏐`                                                                         |
| Backspace at the text start of `- ⏐foo` under `- a`                | `- a⏎foo` → joins                                            | `- a⏎⏎foo`                                                                       |
| Either, with a blank line above already                            | one blank line                                               | still one                                                                        |
| Backspace on a nested `··- ⏐b` under `- a`                         | `- a⏎b` (one level out)                                      | unchanged, per interaction spec                                                  |
| Enter/Backspace on a list line past the parse frontier (long note) | fell through to lang-markdown: marker removed, no blank line | `listLineAt` trusts the prefix grammar when `syntaxTreeAvailable` is false there |

`listExitSeparator` is the one place that decides whether leaving a list
needs a blank line; Enter and Backspace both call it.

## Not exercised

- Soft wrapping of a long single-line nested item (CSS; needs the built
  app). The line-level `padding-inline-start`/`text-indent` pair is
  depth-aware and unchanged; the hard-wrap case in section 6 is covered by
  the e2e spec.
- The click-to-caret mapping on the prefix (`listPrefixClickPosition`) and
  the checkbox click handler (DOM).
- The stale-tree window described in section 8 inside the running app.
- Rendering of nested ordered items now that Tab can create them.

## Follow-ups (in TODOS.md)

- Backspace on an empty depth-2+ item leaves a whitespace-only line (now
  the parent's whitespace rather than a fixed two spaces, but still
  whitespace).
- ~~Tab on a list line past the committed parse falls through to a literal tab.~~ Closed in the third pass.
- Nested ordered items render with a fixed 3ch indent.
- Cmd+Shift+8 on a task line strips `- ` and leaves `[ ] text`.
