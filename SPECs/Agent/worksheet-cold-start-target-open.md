# Worksheet: Cold-Start Target Open

## Task

TODO: `Cold-start target open` in `TODOS.md`.

User request from Joel: if Writer cold-starts from the CLI or an OS file/folder open target, ignore the previous workspace/session and open only that target. Single-file launches must start with the sidebar closed. Prefer passing launch state from Rust to the webview before React renders.

## Files and Docs Reviewed

- `AGENTS.md`
- `TODOS.md`
- `docs/workflows/agent-loop.md`
- `docs/react-guidelines.md`
- `docs/zustand.md`
- `docs/consolidation.md`
- `docs/vite-plus.md`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/open_target.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/commands/startup.rs`
- `apps/desktop/src-tauri/src/commands/workspace.rs`
- `apps/desktop/src/hooks/use-open-drop.ts`
- `apps/desktop/src/stores/workspace-store.ts`
- `apps/desktop/src/stores/editor-store.ts`
- `apps/desktop/src/stores/settings-store.ts`
- `apps/desktop/tests/stores.test.ts`

## Investigation

- Cold-start targets are already canonicalized into `PendingOpenPayload` on the Rust side and returned by `get_startup_state`.
- `get_startup_state` already prefers a pending-open workspace over the most recent workspace for bundle prefetch.
- The bug is that the pending-open bundle still includes the workspace's saved session. The frontend restores that session first, then processes the target. File launches can therefore resurrect prior tabs, and folder launches reopen prior files.
- Sidebar visibility is currently only a settings value. A file-launch override can be applied during startup hydration without persisting a settings change.

## Plan

- Add target-only restore-bundle mode in Rust. Pending-open startup uses it; ordinary restore and user workspace switches keep session restore.
- Update frontend startup hydration so a pending-open bundle is hydrated with the pending payload and not processed a second time.
- Override `appearance.sidebar-visible` to `false` in the startup settings snapshot for file launches only.
- Add focused tests in `apps/desktop/tests/stores.test.ts` for file/folder target hydration and sidebar override.
- Update `CHANGELOG.md`, move TODO to Done, run frontend and Rust validation, then commit and open a PR.

## Implementation

- Added `RestoreBundleMode` to the Rust workspace restore path. `restore_workspace` still restores sessions; `get_startup_state` uses `LaunchTarget` mode for pending opens, skipping session loading and prefetching the requested file when present.
- Extended `workspace-store.restoreFromBundle` to accept an optional launch target. When provided, it ignores any session in the bundle and either opens exactly the target file or creates the launcher tab for a folder target.
- Updated startup hydration to apply the file-launch sidebar override before settings reach React, and to avoid processing the same pending-open payload twice when the restore bundle already handled it.
- Runtime pending opens with no current workspace now use the same target-only frontend hydration path.
- Routed cold-start macOS `RunEvent::Opened` payloads into the empty main window instead of creating a secondary window, so dock/app drag opens also flow through `get_startup_state` pending-open hydration.
- Added store tests for file target hydration, folder target hydration, and sidebar override behavior.

## Validation

- `corepack pnpm install --frozen-lockfile` — used because `vp` was not initially on PATH and dependencies were not installed in the worktree.
- `./node_modules/.bin/vp test apps/desktop/tests/stores.test.ts` — passed, 51 tests.
- `./node_modules/.bin/vp check` — passed with existing warnings in `apps/desktop/e2e/specs/smoke.spec.js` and `apps/desktop/e2e/wdio.conf.js`.
- `./node_modules/.bin/vp test` — passed, 440 tests.
- `cargo fmt --check` — passed after installing a minimal Rust toolchain and rustfmt.
- `cargo test` — blocked by missing native Linux build dependency: `pkg-config` is absent, so `glib-sys` cannot run `pkg-config --libs --cflags glib-2.0 'glib-2.0 >= 2.70'`.
- `cargo clippy` — blocked for the same missing `pkg-config` / `glib-sys` build step.
