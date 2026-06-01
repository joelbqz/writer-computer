# Worksheet: Virtual Workspaces

## Task

TODO: `Virtual workspaces` linked to `SPECs/virtual-workspaces-spec.md`.

User request: implement named virtual file/folder collections exposed through `writer workspace ...`, with absolute-path references, folder nesting, graceful missing references, and safety semantics.

## Git State

Initial worktree status was clean on `feature/virtual-workspaces...origin/master`. An unrelated existing TODO item was already in `In Progress`; left intact.

## Reviewed

- `TODOS.md`
- `docs/workflows/agent-loop.md`
- `docs/consolidation.md`
- `docs/vite-plus.md`
- `SPECs/writer-cli-spec.md`
- `apps/desktop/src-tauri/src/writer_cli.rs`
- `apps/desktop/src-tauri/src/open_target.rs`
- `apps/desktop/src-tauri/src/commands/workspace.rs`
- `apps/desktop/src-tauri/src/commands/fs.rs`
- `apps/desktop/src-tauri/src/commands/search.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src/stores/workspace-store.ts`
- `apps/desktop/src/components/sidebar/file-tree.tsx`
- `apps/desktop/src/components/sidebar/file-tree-node.tsx`

## Baseline Validation

- `vp install` could not run because `vp` is not installed in this environment.
- `cargo test writer_cli` and `cargo test open_target` both failed before tests ran because `pkg-config` is missing and `glib-sys` cannot build.

## Plan

1. Add a Rust virtual-workspace module that owns persistence, path validation, folder expansion, virtual URI parsing, and virtual index generation.
2. Extend the dependency-free `writer` CLI parser with `workspace` subcommands and route mutations through the new module.
3. Teach desktop startup/open paths to carry a virtual workspace URI through `PendingOpenPayload`.
4. Teach workspace open, directory reads, and search indexing to branch on virtual workspace state.
5. Mark virtual `DirEntry` values with `missing` and render missing entries read-only in the sidebar.
6. Disable sidebar context menus for virtual workspaces so create/duplicate/rename/delete cannot mutate referenced files.
7. Update changelog and move the TODO to Done after validation.

## Notes

- Sub-agent plan/implementation review from `agent-loop.md` is not available because the current tool policy allows spawning only when the user explicitly requests delegation.
- Virtual workspace file watching across many referenced roots is intentionally deferred; the first pass is a safe read-only folder view plus normal file reads/writes for opened markdown files.
- Installed missing Linux build dependencies (`pkg-config`, GLib, GTK3, WebKitGTK 4.1) so the Rust/Tauri crate can build and test in this worktree.
- `vp` was not globally installed. Used Corepack to run `pnpm install --frozen-lockfile`, then ran the local `./node_modules/.bin/vp install`.

## Implementation Summary

- Added `virtual_workspace.rs` as the single Rust owner for virtual workspace persistence, absolute-path validation, CSV parsing, virtual URI handling, virtual directory reads, virtual search indexing, missing-reference reporting, and safety tests.
- Extended the `writer` CLI with `workspace new/list/open/add/remove/delete`.
- Taught desktop startup/open-window paths to route `writer-workspace://<name>` payloads through the normal pending-open flow.
- Added virtual workspace state to per-window `WorkspaceState`, with virtual directory reads and search indexes built from stored references instead of a real workspace root.
- Marked directory entries with `source_path` and `missing`, rendered missing entries as unavailable, and disabled filesystem-mutating sidebar/context-menu and command-palette creation paths while a virtual workspace is open.

## Final Validation

- `cargo test` — passed: 112 Rust tests.
- `cargo fmt --check` — passed.
- `cargo clippy` — passed with existing warnings in unrelated modules.
- `./node_modules/.bin/vp install` — passed after Corepack/Pnpm dependency install.
- `./node_modules/.bin/vp check` — passed with 0 errors and existing e2e lint warnings.
- `./node_modules/.bin/vp test` — passed: 27 files, 436 tests.
- `./node_modules/.bin/vp run build -r` — not accepted by this Vite+ version (`Task "build" not found`).
- `./node_modules/.bin/vp run desktop#build` — passed; production desktop frontend build completed with existing chunk-size/dynamic-import warnings.
