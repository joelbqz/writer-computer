# Cmd+F Polish Spec

## Summary

Three follow-ups to the existing in-document find overlay (`editor-search-overlay.tsx` + `editor-search-store.ts`):

1. The editor often scrolls **past** the active match — the document moves but the highlight ends up under the top/bottom fade mask and progressive blur (or fully off-screen), so the user has to scroll back manually to see it.
2. `Cmd+G` does not advance to the next match. The standard macOS Find behavior (Cmd+G next / Cmd+Shift+G previous) is missing.
3. There is no spatial indicator of where matches are in the document. IDE-style match marks along the scrollbar would let users see distribution at a glance and click to jump.

## Goals

- When a user opens find (Cmd+F), types a query, or steps through matches, the active match is always rendered inside the **clear** region of the editor — never scrolled past it, never under the top/bottom fade mask or the progressive blur overlay.
- `Cmd+G` advances to the next match. `Cmd+Shift+G` goes to the previous match. Both work whether the find overlay has focus or the editor has focus, as long as the overlay is open and the query is non-empty.
- A scrollbar overview shows the position of every match in the document so the user can see density / distribution and click any mark to jump there.
- Behavior matches the macOS platform convention so muscle memory from Safari / Chrome / Notes / Xcode carries over.

## Non-Goals

- Reworking the visual design of the find overlay.
- Changing the match-highlighting style itself (CodeMirror `cm-searchMatch` / `cm-searchMatch-selected`).
- A full minimap (rendered text thumbnails). The scrollbar overview is just colored marks.
- Find-in-folder / global search — that lives in the fuzzy-search-grep spec.
- Changing `Cmd+H` (find-and-replace) or any other editor shortcut.

## Background

`apps/desktop/src/components/editor-area/editor-scroll-container.tsx` wraps the editor in a vertical fade mask plus two `ProgressiveBlur` overlays at the top and bottom:

- The scroll container has `mask-image: linear-gradient(to bottom, transparent 5%, black 15%, black 85%, transparent)`. So content in the top ~15% and bottom ~15% is partially or fully transparent.
- Each `ProgressiveBlur` is a `pointer-events-none` overlay 120px tall pinned to the top or bottom edge with a backdrop blur.

CodeMirror's default `findNext` / `findPrevious` (`@codemirror/search`) scrolls the match into view but only guarantees it is within the scrollable bounds — it does not know about our mask. A match that lands within ~120px of the top or bottom edge appears faded or blurred and is easy to miss.

`Cmd+F` is wired in `apps/desktop/src/components/editor-area/use-prosemark-editor.ts` at `Prec.highest` via `keymap.of([{ key: "Mod-f", run: ... }])`. There is no entry for `Mod-g` or `Mod-Shift-g`, so the keystroke either falls through to CodeMirror's default (currently mapped to "Go to line" per `docs/keyboard-shortcuts.md`) or is unhandled.

## Behavior

### Match visibility

- After every search action (open, query change, next, previous, replace), the active match must be visible inside the clear zone. Today the editor frequently overshoots: the document scrolls but the highlight lands above/below the visible area or under the fade.
- "Clear zone" = the visible region not obscured by either the mask gradient transition or the 120px progressive-blur overlay. Treat the safe top inset and safe bottom inset as a single source of truth — derive both from the constants already in `editor-scroll-container.tsx` (`FADE_DISTANCE`, mask stops) rather than hard-coding numbers in the search code.
- The scroll adjustment must not flicker or fight CodeMirror's own `scrollIntoView`. Prefer a single `EditorView.scrollIntoView` dispatch with `y: "center"` (or an explicit margin equal to the top/bottom safe insets), instead of letting CodeMirror's default scroll run and then correcting afterwards.
- Apply the same logic when the overlay is first opened with an existing selection that is the first match.

### Scrollbar match overview

- When the find overlay is open and the query has matches, render a thin column of marks along the right gutter aligned with the scroll container, with one mark per match positioned proportionally to the match's offset in the document.
- The mark for the **active** match is rendered in a distinct color (the accent) and slightly larger; inactive matches use a muted color.
- Clicking a mark scrolls to and selects that match (re-using the next/prev scroll logic so it lands in the clear zone).
- The overview lives outside the masked scroll area so its marks are not faded by the same gradient as the editor content. It can sit inside the existing `SCROLLBAR_GUTTER` strip on the right edge of `editor-scroll-container.tsx`.
- Hidden when the find overlay is closed or the query is empty. No marks rendered for "no matches".
- Performance: cap the rendered marks (e.g. coalesce at most one mark per pixel of gutter height) so a query with thousands of matches doesn't tank scroll perf. Recompute on doc / query change only, not on every scroll.

### Keyboard

- `Cmd+G` while the overlay is open and the query is non-empty: advance to next match (`findNext`), regardless of whether the overlay's input or the editor has focus.
- `Cmd+Shift+G` while the overlay is open and the query is non-empty: previous match (`findPrevious`).
- If the overlay is closed, `Cmd+G` should re-open the overlay using the last query (CodeMirror's standard behavior). Empty last query: open with empty input, no error.
- These bindings live alongside the existing `Mod-f` entry in `use-prosemark-editor.ts` (or a small shared array), at `Prec.highest`, so they take priority over any inherited CodeMirror default that currently maps `Cmd+G` to "Go to line".
- The find-input `onKeyDown` in `editor-search-overlay.tsx` already handles Enter / Shift+Enter for next/previous. Add `Cmd+G` / `Cmd+Shift+G` there too so the input doesn't swallow them.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/editor-scroll-container.tsx` — export the fade-distance constants (or a derived `getSafeScrollMargin()`), and host the scrollbar-overview gutter slot. No change to existing fade behavior.
- `apps/desktop/src/components/editor-area/editor-search-store.ts` — centralize next/previous helpers that compute the safe scroll margin and dispatch a single `scrollIntoView` effect; expose the current match list (offsets) for the overview.
- `apps/desktop/src/components/editor-area/editor-search-overlay.tsx` — call the shared helpers from Enter / arrow-button paths; add `Cmd+G` / `Cmd+Shift+G` to `onFindKeyDown`.
- `apps/desktop/src/components/editor-area/editor-search-overview.tsx` (new) — renders the scrollbar match marks, subscribes to the search store, handles click-to-jump.
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts` — register `Mod-g` and `Mod-Shift-g` keybindings at `Prec.highest`.
- `docs/keyboard-shortcuts.md` — replace the `Cmd+G → Go to line` row with `Cmd+G → Find next` and add `Cmd+Shift+G → Find previous`. Confirm "Go to line" isn't relied on elsewhere; if it is, pick a non-conflicting binding or drop it.
- Frontend tests under `apps/desktop/tests/` covering: scroll margin computation, next/previous keybinding wiring, overlay key handling, and overview mark positioning / click-to-jump.

## Acceptance Criteria

- Opening Cmd+F on a long document and stepping through matches with Enter, the next/prev arrow buttons, or `Cmd+G` / `Cmd+Shift+G` always lands the active match in the clear zone — the editor never overshoots the highlight or hides it under the fade.
- `Cmd+G` advances to the next match and `Cmd+Shift+G` returns to the previous match, both from the find input and from the editor.
- "Go to line" no longer fires on `Cmd+G` (or has been remapped intentionally and documented).
- With find open and a query that has matches, the right gutter shows one mark per match. The active mark is visually distinct. Clicking a mark scrolls to that match and updates the active state.
- The overview is hidden when find is closed or the query is empty, and remains responsive on documents with thousands of matches.
- `docs/keyboard-shortcuts.md` reflects the new bindings.
- No regression to Cmd+F open behavior, selection pre-fill, replace, or match counter.
