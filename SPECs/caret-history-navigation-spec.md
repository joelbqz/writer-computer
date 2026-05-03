# Caret Position After History Navigation

## Problem

Back/forward navigation swaps files inside the active CodeMirror view, like sidebar file clicks do when the active tab is already a file. The important difference was the toolbar history buttons: they wrapped `navigateBack()` / `navigateForward()` in `startTransition`, while sidebar file clicks call `openFile()` directly.

That made history navigation run through React transition priority even though it is a discrete input action that changes the active document in a live editor view. The visible failure mode was the caret painting at the `.cm-content` left edge while the rendered line started after the editor side padding.

## Goal

When navigating back or forward between files in the same tab, the visible caret should stay aligned with the rendered document content.

## Approach

- Keep the existing in-place document swap so ProseMark decorations do not flash raw markdown.
- Keep the sidebar-style `mousedown` focus guard on history buttons so mouse navigation does not blur CodeMirror before the swap.
- Run back/forward navigation as a direct discrete action instead of wrapping it in `startTransition`; history changes should commit at input priority, matching sidebar file selection.
- Enable CodeMirror's `drawSelection()` extension so the visible cursor is drawn by CodeMirror from measured editor coordinates instead of relying on the browser's native contenteditable caret.

## Validation

- `vp check`
- `vp test`
- Manual smoke: click A -> B from the sidebar, then use Back -> Forward toolbar buttons with headings near the saved cursor and verify the caret remains visually aligned.
