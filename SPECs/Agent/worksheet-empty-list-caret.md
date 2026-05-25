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
- Add a zero-width cursor measurement point widget only for empty bullet/task
  list bodies, placed at `prefixEnd`.
- Keep the hidden source prefix and marker/atomic ranges unchanged.
- Add focused list-extension tests that empty bullet/task lines receive the
  measurement widget and non-empty lines do not.
- Update the changelog and move the TODO entry to Done after validation.

## Results

- Added `EmptyListBodyWidget` in
  `apps/desktop/src/lib/prosemark-core/list/index.ts`. It is emitted only for
  empty bullet/task bodies at `prefixEnd`, after the hidden source prefix, so
  `drawSelection` can measure the caret on the visible body column.
- Kept existing bullet/task point widgets, hidden source prefix marks,
  marker/atomic ranges, Enter, Backspace, and checkbox toggles unchanged.
- Added list-extension tests for empty bullet, empty task, and non-empty list
  decoration behavior.
- `vp test apps/desktop/tests/list-extension.test.ts` passed: 45 tests.
- Final `vp check` passed with the existing E2E warnings.
- Final `vp test` passed: 23 files, 393 tests.
- Final `cargo fmt --check`, `cargo test`, and `cargo clippy` passed;
  Rust warnings were existing search/config/images warnings.
- Browser-level visual check was started but interrupted before completion; the
  fix was validated through CodeMirror decoration shape and full project tests.
