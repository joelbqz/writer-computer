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

- Mechanism: whole-window WKWebView page zoom (see spec for the tradeoff against editor-font zoom).
- New: `lib/zoom.ts` (ladder, normalize/step, `applyWindowZoom` with dedupe and explicit error log), `hooks/zoom-api.ts` (`zoomIn`/`zoomOut`/`resetZoom` over `setSetting`, no-op at bounds), `tests/zoom.test.ts` (10 tests), `e2e/specs/window-zoom.spec.js`.
- Changed: schema (`window.zoom`), settings store side effect, `lib/tauri.ts` wrapper, keyboard hook, command palette, Mermaid canvas modifier guard, capability permission, `docs/keyboard-shortcuts.md`, CHANGELOG, TODOS.
- No Rust code changed; `cargo test`/`clippy`/`fmt --check` run to validate the capability compiles. JS-only shortcut handling: no View menu needed.
- Verification: `vp check` 0 errors, `vp test` 607/607, cargo test 168/168. Runtime: `e2e/specs/window-zoom.spec.js` against the `--features e2e` build, 8/8 passing (Cmd+=, Cmd+Shift+=, numpad +/−, Cmd+-, Cmd+0, Alt chord ignored, persistence across reload with `window.innerWidth` ≈ base/1.25, palette commands present and working, `editor.font-size` unchanged).
