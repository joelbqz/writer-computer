# Worksheet: Caret Position After History Navigation

## Task

TODO: Caret position after history navigation (`SPECs/caret-history-navigation-spec.md`).

## Reviewed

- `TODOS.md`
- `CHANGELOG.md`
- `docs/workflows/agent-loop.md`
- `docs/react-guidelines.md`
- `docs/zustand.md`
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`
- `apps/desktop/src/components/editor-area/editor-tabs.tsx`
- `apps/desktop/src/components/sidebar/file-tree-node.tsx`
- `apps/desktop/src/stores/editor-store.ts`
- `apps/desktop/src/components/editor-area/editor-pane.tsx`
- Prior commit `75792ef` (`Fix caret misplacement when switching tabs`)

## Plan

- Preserve the in-place CodeMirror document swap.
- Compare sidebar click handling against back/forward button handling.
- Preserve CodeMirror focus during mouse-driven history-button navigation.
- Remove React transition scheduling from toolbar history navigation so it commits with the same discrete priority as sidebar file selection.
- Keep CodeMirror `drawSelection()` enabled so cursor painting comes from CodeMirror's measured coordinates rather than native contenteditable caret painting.
- Update changelog and TODO state after validation.

## Results

- Reopened after user verification showed the focus-only fix was insufficient.
- Root cause: history navigation takes the same-pane in-place document swap path, but the toolbar buttons were scheduling that swap through React transition priority. Sidebar file clicks call `openFile()` directly, and when the active tab is already a file they also reuse the same editor and swap the document in place. The scheduling difference left the live editor view vulnerable to stale caret/layout state during back/forward navigation.
- Added `onMouseDown={(event) => event.preventDefault()}` to the Back and Forward toolbar buttons.
- Changed Back and Forward button clicks to call `navigateBack()` / `navigateForward()` directly instead of inside `startTransition`.
- Enabled CodeMirror `drawSelection()` for the editor.
- Removed the earlier cursor-prefix normalization and delayed-refocus experiments; they were not the root cause.
- Validation:
  - `vp check` passed with two existing E2E JS warnings unrelated to this change.
  - `vp test` passed.
