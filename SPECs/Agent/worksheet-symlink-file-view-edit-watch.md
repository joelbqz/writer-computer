# Agent Worksheet: Symlink File View/Edit/Watch

## Task

- TODO: Symlink file view/editing/watching.
- Spec: [`SPECs/symlink-file-view-edit-watch-spec.md`](../symlink-file-view-edit-watch-spec.md).

## Context Reviewed

- Local files: `commands/fs.rs`, `commands/search.rs`, `watcher.rs`, `state.rs`, `ignore.rs`, sidebar `DirEntry` rendering/types.
- Project docs: `AGENTS.md`, `docs/consolidation.md`, `docs/workflows/agent-loop.md`, prior watcher specs.
- Zed reference: temporary clone of `zed-industries/zed` at `a565ab4`; relevant files were `crates/fs/src/fs.rs`, `crates/fs/src/fs_watcher.rs`, and `crates/worktree/src/worktree.rs`.

## Plan

- Add a Rust path-info helper to classify symlinks with target metadata while hiding broken links.
- Update directory reads and indexing to include symlinked markdown files and eagerly traverse symlinked directories with cycle guards.
- Preserve symlinked files on save by writing to the resolved target path and recording both logical and canonical paths for self-write suppression.
- Add per-window symlink target mappings and normalize watcher events so target changes refresh the logical symlink paths.
- Add `is_symlink` to `DirEntry` and render a subtle sidebar badge.

## Results

- Added a shared Rust symlink path classifier and canonical target map used by directory reads, indexing, writes, and watcher normalization.
- Directory reads and search indexing now include live symlinked markdown files and markdown-bearing symlinked directories, skip broken links, and guard symlink loops.
- Saves through live file symlinks now write to the resolved target so the logical symlink remains intact; broken symlink saves fail instead of replacing the link.
- Watcher events from canonical symlink targets are normalized back to logical workspace paths, with external target watch registrations for linked files and directories.
- Sidebar entries now carry `is_symlink` and render a compact symlink badge.

## Validation

- `vp check` passed with two pre-existing E2E lint warnings.
- `vp test` passed: 27 files, 438 tests.
- `cargo fmt --check` passed.
- `cargo test` passed: 119 tests.
- `cargo clippy` passed with pre-existing warnings in config/search/images code.
