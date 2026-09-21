# Worksheet: View Zoom Shortcuts

TODO: "View zoom shortcuts" (In Progress). Spec: [`SPECs/view-zoom-shortcuts-spec.md`](../view-zoom-shortcuts-spec.md).

## Reviewed

- `docs/keyboard-shortcuts.md`, `docs/react-guidelines.md`, `docs/zustand.md`, `docs/consolidation.md`, `docs/workflows/agent-loop.md`.
- `hooks/use-keyboard-shortcuts.ts` — global handler; reads stores at event time; Cmd+1..9 claims digits 1–9 only.
- `hooks/use-sidebar.ts` (`toggleSidebar`) and `hooks/workspace-api.ts` — the imperative-API pattern for non-component callers.
- `stores/settings-store.ts` — `applySettingsSideEffects` is the funnel every write path (hydrate, set, reset, reconcile, rollback) reaches. `setSetting` still queues a disk write when the value is unchanged, so callers that may be at a bound must bail themselves.
- `lib/theme.ts` — cssVar bindings and the "skip undefined values" convention that tests rely on.
- `shared/settings.schema.json`, `lib/settings-schema.ts`, `src-tauri/src/config.rs` — `scope: "global"` keys reject workspace writes; `range` carries min/max/step; no hidden flag, so a schema entry always renders in Preferences. `RangeControl` displays `Math.round(value)`, which drove the percent representation.
- `components/command-palette/index.tsx` — inline command list.
- `components/editor-area/mermaid-canvas.ts` — bare `+`/`=`/`-`/`0` keydown handler without a modifier check; conflicts with Cmd chords.
- `src-tauri/src/lib.rs` `install_app_menu` — Preferences accelerator pattern; not needed (see spec).
- `src-tauri/capabilities/default.json` — covers `main` and `w-*` (workspace and standalone windows share the prefix).
- `src-tauri/src/watcher.rs` — `settings:changed` fires only for workspace `.writer/config`, so global writes are not broadcast between windows.
- wry 0.55 `wkwebview/mod.rs` `zoom()` → `setPageZoom`; tauri 2.11 `Webview::set_zoom` (macOS 11+); `@tauri-apps/api` 2.10 `Webview.setZoom` → `plugin:webview|set_webview_zoom`.
- Irrelevant: `zoomHotkeysEnabled` window config (off; a native hotkey path would bypass persistence).

## Plan

- Schema: `window.zoom` range 50–300 step 5, default 100, global.
- `lib/zoom.ts`: stop ladder, `normalizeZoom`, `zoomInFrom`, `zoomOutFrom`, `applyWindowZoom` (dedupe, skip undefined, log failures). Bounds and default read from the schema entry.
- `lib/tauri.ts`: `setWebviewZoom(scale)` wrapper over `getCurrentWebview().setZoom`.
- `stores/settings-store.ts`: call `applyWindowZoom` from `applySettingsSideEffects`.
- `hooks/zoom-api.ts`: `zoomIn`, `zoomOut`, `resetZoom` write through `setSetting`, skipping no-op writes.
- Keyboard hook + palette wire to the API; Mermaid canvas ignores Cmd/Ctrl chords; capability gains `core:webview:allow-set-webview-zoom`.
- Docs rows, CHANGELOG, tests in `tests/zoom.test.ts`.

## Result

- Mechanism: editor text zoom. First landed as whole-window WKWebView page zoom (commit be5eeae); the human asked for editor-only scope, so the follow-up commit swaps the mechanism: `editor.zoom` (percent, cssVar `--writer-editor-zoom`), `editor.font-size` rebound to `--writer-editor-base-font-size`, and `App.css` derives `--writer-editor-font-size` from the two. No permission, no IPC, no zoom-specific side effect.
- New: `lib/zoom.ts` (ladder, normalize/step), `hooks/zoom-api.ts` (`zoomIn`/`zoomOut`/`resetZoom` over `setSetting`, no-op at bounds), `tests/zoom.test.ts`, `e2e/specs/editor-zoom.spec.js`.
- Changed: schema, `App.css`, keyboard hook, command palette, Mermaid canvas modifier guard, `docs/keyboard-shortcuts.md`, CHANGELOG, TODOS.
- No Rust code changed. JS-only shortcut handling: no View menu needed.
- Verification: recorded in the final report; `e2e/specs/editor-zoom.spec.js` checks the rendered `.cm-content` font size scales while the sidebar font size and `window.innerWidth` stay fixed, that a changed Font Size is multiplied, persistence across reload, and the palette commands.
