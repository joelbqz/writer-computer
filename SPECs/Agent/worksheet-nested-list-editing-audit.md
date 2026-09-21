# Worksheet: nested list editing audit

TODO: "Nested list editing audit" (In Progress → Done). Spec:
[`SPECs/nested-list-editing-audit-spec.md`](../nested-list-editing-audit-spec.md).

## Reviewed

- `CLAUDE.md`, `docs/workflows/agent-loop.md`, `docs/editor.md` (tree-derived
  StateField staleness section), `docs/consolidation.md`.
- `apps/desktop/src/lib/prosemark-core/list/index.ts` in full;
  `tests/list-extension.test.ts`; `tests/helpers/parsed-state.ts`.
- Specs: list-prefix-interaction-zones, list-selection-geometry-revamp,
  empty-list-caret, list-selection-todo-checkbox-regression.
- Git: `git log -- prosemark-core/list`; the reverted commit f3e5a53
  ("Improve list indent interactions", reverted in 5449de0) introduced the
  selection Tab/Shift-Tab and an indent-spacer renderer; the selection part
  came back in 9430d89. Branches `feature/fix-indent-ul-li` and
  `feature/fix-bold-list-wrap` only touch `softIndentExtension.ts`, which
  no longer exists (list rendering was rewritten in #60), so they are moot.
- `markdown-formatting.ts` (`toggleBulletList`, `toggleTaskList`),
  `basicSetup.ts` (keymap order: list keymap at `Prec.highest`, then
  `indentWithTab` in the default keymap), `tabWidthExtension.ts` (rendering
  only; does not affect list commands), `viewport-parse.ts`, and
  `@codemirror/language`'s parse worker (`Work.Apply` 20 ms per transaction,
  `Work.MaxPause` 500 ms idle, 3 s budget per 30 s chunk).

## Approach

Wrote a throwaway probe test that ran ~60 scenarios through the real
commands and logged before/after documents plus per-line rendered depth,
then turned every failure into a test in `list-extension.test.ts` before
changing code. The probe file was deleted; the matrix lives in the spec.

## Plan

1. Replace the line-scan parent lookup (`findPrevListItemIndent`) with a
   syntax-tree lookup so Tab targets the previous item's real content column
   and Shift-Tab the parent's leading whitespace. That one change covers the
   ordered-parent, tab-indent, loose-list, and odd-indent failures.
2. Unify single-caret and selection Tab/Shift-Tab into one command that
   moves a selected parent's subtree with it.
3. Enter on an empty nested item outdents instead of wiping.
4. Make the bullet/task toggles in `markdown-formatting.ts` indent-aware.

Backspace semantics were left as the interaction-zones spec defines them.

## Results

All scenarios in the spec pass except those listed as NOTE or Not
exercised. `vp check` and `vp test` (635 tests) are green. Two commits: the
list module change, and the formatting toggle change.
