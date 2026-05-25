# Worksheet: Empty List Caret

## Task

TODO: Empty list caret visibility:
[`SPECs/empty-list-caret-spec.md`](../empty-list-caret-spec.md)

## Baseline

- Worktree was clean at start.
- `vp check` passed with existing warnings in `apps/desktop/e2e/wdio.conf.js`
  and `apps/desktop/e2e/specs/smoke.spec.js`.
- `vp test` passed: 23 files, 390 tests.
- `cargo fmt --check` passed.
- `cargo test` passed: 103 Rust tests.
- `cargo clippy` passed with existing warnings in search/config/images code.

## Reviewed

- `TODOS.md`
- `docs/workflows/agent-loop.md`
- `docs/editor.md`
- `docs/react-guidelines.md`
- `SPECs/list-selection-todo-checkbox-regression-spec.md`
- `apps/desktop/src/lib/prosemark-core/list/index.ts`
- `apps/desktop/src/lib/prosemark-core/syntaxHighlighting.ts`
- `apps/desktop/src/components/editor-area/prosemark-theme.css`
- `apps/desktop/tests/list-extension.test.ts`
- CodeMirror view internals around `coordsAtPos`, `LineTile.resolveInline`,
  point widgets, and `drawSelection`.

## Plan

- Keep the existing point-widget list marker design.
- Anchor the existing bullet/checkbox point widget at `prefixEnd`, after the
  hidden source prefix, so it can also serve as the empty-line caret coordinate
  target.
- Keep the hidden source prefix and marker/atomic ranges unchanged.
- Add focused list-extension tests that bullet/task marker widgets are anchored
  at the hidden prefix end for both empty and non-empty list lines.
- Update the changelog and move the TODO entry to Done after validation.

## Results

- Moved the existing bullet/task point widgets in
  `apps/desktop/src/lib/prosemark-core/list/index.ts` from `line.from` to
  `prefixEnd`. The hidden source prefix still has zero inline width, so the
  marker renders in the same gutter slot while giving `drawSelection` a
  body-column coordinate target on empty list items.
- Kept hidden source prefix marks, marker/atomic ranges, Enter, Backspace, and
  checkbox toggles unchanged.
- Added list-extension tests for bullet/checkbox marker anchors on empty and
  non-empty list lines.
- `vp test apps/desktop/tests/list-extension.test.ts` passed: 45 tests.
- Final `vp check` passed with the existing E2E warnings.
- Final `vp test` passed: 23 files, 393 tests.
- Final `cargo fmt --check`, `cargo test`, and `cargo clippy` passed;
  Rust warnings were existing search/config/images warnings.
- Browser-level CodeMirror geometry check in headless Chrome confirmed
  `coordsAtPos` on empty bullet/task items lands at the existing marker
  widget's right edge, with no extra empty-body widget in the DOM.
