# Worksheet: Symlink support

## Task

TODO: Symlink support — [`SPECs/symlink-support-spec.md`](../symlink-support-spec.md). Add support for symlinked markdown files/folders in the sidebar and search index, preserve symlinks on save, and translate watcher events for symlink targets back to visible workspace paths.

## Workspace state

- Branch: `feature/symlink`
- Initial git state: clean (`## feature/symlink...origin/master`).
- Baseline validation: `cd apps/desktop/src-tauri && cargo test` passed (108 tests; existing dead-code warnings only).

## Docs and code reviewed

- `TODOS.md`
- `docs/workflows/agent-loop.md`
- `docs/consolidation.md`
- `SPECs/external-file-watcher-spec.md` (prior canonical-path and watcher assumptions)
- Context7 docs for `ignore::WalkBuilder::follow_links(true)` and symlink-loop handling
- Context7/local source docs for `notify` watcher behavior; `notify` 7 FSEvents canonicalizes watched paths
- `apps/desktop/src-tauri/src/commands/fs.rs`
- `apps/desktop/src-tauri/src/commands/search.rs`
- `apps/desktop/src-tauri/src/watcher.rs`
- `apps/desktop/src-tauri/src/ignore.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src/hooks/use-file-watcher.ts`
- `apps/desktop/src/stores/workspace-store.ts`

## Plan

1. Add a small Rust `symlink` helper module as the single source of truth for:
   - symlink-aware write target resolution
   - workspace symlink alias collection
   - watcher event path translation from canonical targets to visible link paths
2. Update sidebar directory reads to classify entries using symlink-following metadata and make recursive markdown checks cycle-safe with canonical-directory visited tracking.
3. Update workspace indexing to follow symlinks via `ignore::WalkBuilder::follow_links(true)` and add tests for symlinked files/folders and cycles.
4. Update writes to preserve symlink files by atomically replacing the canonical target, not the link path; record both link and target for self-write suppression.
5. Update watcher startup to collect aliases, best-effort watch outside-root symlink targets, dynamically sync aliases on membership changes, and process translated logical paths only.
6. Update `WorkspaceIgnore::load` to follow symlinked directories so sidebar fallback filtering stays aligned with the indexer.
7. Add Rust tests and run Rust validation.

## Risks / tradeoffs

- Following symlinked folders can index large external trees if the user links them into a workspace; this is the expected behavior for supporting symlinked folders.
- On platforms where notify already reports symlink-path events, translation dedupes logical paths and should be harmless.

## Implementation summary

- Added `apps/desktop/src-tauri/src/symlink.rs` for symlink-following metadata, write-target resolution, alias collection, and watcher path translation.
- Updated sidebar reads to follow symlink targets for classification and to use canonical visited-directory tracking for recursive markdown checks.
- Updated search indexing and workspace ignore loading to follow symlinked directories while relying on `ignore` loop detection.
- Updated saves to replace a symlink target atomically rather than replacing the symlink; write echo suppression records both the visible link path and target path.
- Updated watcher startup to collect symlink aliases, best-effort watch outside-root targets, dynamically add target watches when new symlinks appear, remove stale alias translations when symlinks disappear, and emit/index only logical workspace paths.
- Updated direct markdown-file open-target handling so final-path symlinks stay keyed by the visible link path.
- Added Rust unit coverage for symlinked files/folders, symlink cycles, write-through preservation, ignore rules inside symlinked folders, open-target paths, watcher alias translation, dynamic alias sync, and subtree indexing through links.

## Validation

- `vp install` — completed; lockfile unchanged.
- `vp check` — completed with existing E2E JS lint/type warnings (`no-floating-promises` in `apps/desktop/e2e/specs/smoke.spec.js`, redundant type constituent in `apps/desktop/e2e/wdio.conf.js`).
- `vp test` — passed (27 files, 438 tests).
- `cd apps/desktop/src-tauri && cargo test symlink` — passed (20 tests) after dynamic watcher sync follow-up.
- `cd apps/desktop/src-tauri && cargo test` — passed (123 tests).
- `cd apps/desktop/src-tauri && cargo clippy` — completed with existing warnings in `search.rs`, `config.rs`, and `images.rs`.
- `cd apps/desktop/src-tauri && cargo fmt --check` — passed.
