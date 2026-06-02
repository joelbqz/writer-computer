# Symlink File View/Edit/Watch

## Summary

Writer should handle symlinked markdown files and symlinked directories like other local-first editors do: the sidebar shows the logical path inside the workspace, editing a symlinked file writes through to its target without replacing the link, and filesystem events from resolved targets refresh the visible symlink path.

The implementation follows the relevant parts of Zed's worktree model as reviewed from `zed-industries/zed` commit `a565ab4`: keep symlink metadata separate from target file/dir classification, preserve logical worktree paths in the UI, and maintain canonical-target mappings so watcher events can be translated back to symlink paths.

## Goals

- Show live `.md` and `.markdown` symlink files in the sidebar and search results.
- Eagerly scan symlinked directories that contain markdown, while respecting existing hidden-path and gitignore filters.
- Preserve symlink files during save by writing to the resolved target instead of atomically replacing the link.
- Translate watcher events from symlink targets back to the logical symlink paths visible in Writer.
- Add a subtle sidebar badge for symlink entries.

## Non-Goals

- Broken symlinks stay hidden from the markdown tree.
- No new setting for lazy/eager symlink traversal.
- No polling watcher fallback for filesystems that do not deliver native events.
- Rename and delete operate on the symlink path itself, not the target.

## Implementation Notes

- Add a single Rust helper for path classification so directory reads, indexing, watcher updates, and write handling agree on `is_symlink`, target file/dir type, canonical target path, and markdown eligibility.
- Track canonical target mappings in per-window `WorkspaceState`; both indexed symlink files and scanned symlink directories register their target paths.
- Watch external symlink targets in addition to the workspace root. Existing event filtering and self-write suppression then operate on normalized logical paths.
- Use inode/canonical-cycle guards when walking symlink directories to avoid recursive loops.

## Tests

- Unit-test symlink file save preservation, broken symlink hiding, symlink directory indexing, loop avoidance, and watcher event normalization.
- Run Rust validation from `apps/desktop/src-tauri/`: `cargo test`, `cargo clippy`, and `cargo fmt --check`.
- Run frontend validation: `vp check` and `vp test`.
