# Symlink Support Spec

## Summary

Writer currently ignores symlinked markdown files and symlinked folders in workspace listings and search indexing because the sidebar uses `DirEntry::file_type()` and the index walker does not follow links. Saving through a symlinked markdown file can also replace the symlink with a regular file because the atomic write renames the temp file over the link path.

Support symlinked markdown entries as first-class workspace entries while keeping Writer's visible paths workspace-relative to the symlink location.

## Goals

- Show symlinked markdown files in the sidebar when the symlink path has a `.md` extension.
- Show symlinked folders when their target tree contains visible markdown files.
- Include markdown files under symlinked folders in the workspace search index, using the symlink path as the indexed path and relative path.
- Avoid infinite recursion for symlink cycles.
- Preserve a symlink when saving a symlinked markdown file; write the target file instead of replacing the link.
- Reflect external changes under symlink targets where the platform watcher can observe them, translating target paths back to workspace symlink paths.
- Start watching targets for symlinks created after the workspace is already open.
- Keep a symlinked markdown file opened directly from drag/drop or the CLI keyed by its visible file path when its parent workspace is not itself a symlink.

## Non-goals

- Editing or rendering broken symlinks. Broken links stay hidden from the markdown-only sidebar.
- Showing symlinks to non-markdown files.
- Adding a frontend symlink badge or separate symlink type in `DirEntry`.

## Design

### Sidebar listing

Use symlink-following metadata for entry classification in `read_directory_impl` and recursive markdown checks. Keep the visible path as the symlink path (`entry.path()`), not the canonical target path. Recursive markdown detection tracks canonicalized directory targets in a visited set so loops such as `loop -> .` terminate.

### Search indexing

Enable `ignore::WalkBuilder::follow_links(true)` in the workspace indexer. The `ignore` walker keeps reported paths at the symlink location and performs loop detection, so search results and `dirs_with_markdown` can continue using visible workspace paths.

### Open targets and saving

For direct markdown-file open targets, keep a final-path symlink in the visible namespace by combining the canonical parent workspace path with the symlink filename. Symlinked workspace roots still canonicalize to their target, preserving the existing duplicate-window/session behavior.

For `write_file_impl`, detect when the requested path is a symlink and resolve it to its canonical target before creating the temp file and renaming. Return the original path in the IPC payload so frontend state remains keyed by the workspace-visible symlink path.

Record both the visible symlink path and the canonical target path as self-writes so watcher echoes are suppressed regardless of which path the OS reports.

### Watcher path translation

On watcher startup, collect symlink aliases visible under the workspace and add best-effort watches for targets outside the canonical workspace root. Membership-change events also sync the alias map for the changed path, so a newly-created symlink starts watching its target immediately and a removed/replaced symlink stops translating target events back to the old link path. When an event arrives, process only logical workspace paths:

- the raw event path if it is already under the workspace root
- each symlink path produced by mapping an event under an alias target back to the alias link path

This keeps frontend cache keys, open-file keys, and search index paths in the symlink namespace the user sees.

## Test plan

- Rust unit tests for sidebar inclusion of symlinked markdown files and folders.
- Rust unit tests for write-through preserving the symlink inode.
- Rust unit tests for index traversal through symlinked files/folders and loop avoidance.
- Rust unit tests for watcher alias collection/path translation and dynamic alias sync.
- `cargo test` from `apps/desktop/src-tauri/`.
- `cargo clippy` and `cargo fmt --check` from `apps/desktop/src-tauri/`.
