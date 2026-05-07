# External File Watcher Spec

## Summary

External file system changes — files created, renamed, deleted, or modified outside of Writer (Finder, `git pull`, vim, VS Code, scripts) — are inconsistently picked up by the file tree, and editor reload-from-disk for open files. Other editors with the same UX promise (Obsidian, VS Code) reflect external edits live; Writer does not.

The pieces are in place: a `notify` crate watcher (`apps/desktop/src-tauri/src/watcher.rs:100`) is started during workspace bootstrap (`apps/desktop/src-tauri/src/commands/workspace.rs:133`), and a frontend listener (`apps/desktop/src/hooks/use-file-watcher.ts:14`) subscribes to `fs:file-changed` / `fs:directory-changed` and calls `refreshDirectory` / `reloadFromDisk`. End-to-end, the path that should fire on every external change exists.

What's broken is in the Rust-side filtering layer. Three bugs in `watcher.rs` collectively swallow large classes of external events before they ever reach the frontend.

## Goals

- A file created, renamed, deleted, or modified by any process outside Writer appears in the sidebar within ~300 ms of the change.
- Open files whose on-disk content changes externally are reloaded into the editor (already implemented; just needs the events to arrive).
- The fix does not regress the self-write echo suppression — saves from inside Writer must not bounce back as a reload.
- The fix does not require a new architecture (no swap to Tauri's `tauri-plugin-fs-watch` or a different crate); the existing `notify` watcher is correct, only the post-receive filter is wrong.

## Non-Goals

- Polling fallback for filesystems where FSEvents/inotify don't work (network mounts, FUSE). Out of scope; users on those will continue to see stale data.
- Cross-window event fan-out. Each window already has its own watcher and per-label `emit_to`; not changing that.
- Symlink traversal beyond what the OS already does. `notify`'s default of `follow_symlinks: true` stays.
- A debounce/coalescing rewrite. The 300 ms debounce in `watcher.rs:128` is fine.
- Replacing `should_ignore` with a full re-walk through `WorkspaceIgnore::is_ignored`. The two-tier filter (cheap hardcoded skip + matcher-based ignore) is intentional.

## Reproduction

1. Open Writer on a workspace that lives at a dot-prefixed path — e.g. `~/.notes/`, `~/.obsidian-vault/`, or any folder whose absolute path contains a component starting with `.` other than `.gitignore` / `.writer`.
2. From a terminal: `touch ~/.notes/external.md`.
3. Observe: nothing changes in Writer's sidebar. The new file does not appear until the workspace is reopened.

A second, more-common reproduction:

1. Open Writer on `/var/folders/.../my-notes` (a path that macOS canonicalizes to `/private/var/folders/.../my-notes` — common when users open a temp dir, a workspace inside a mounted DMG, or any path under `/var`/`/tmp`/`/etc`).
2. Touch a file inside the workspace.
3. Observe: the Rust watcher emits the event with the canonical path (`/private/var/...`), but the frontend stores `root` as the un-canonicalized path the user opened (`/var/...`). The `path === root` equality check in `use-file-watcher.ts:51` fails, so `refreshDirectory(root)` is never called and the sidebar does not refresh.

A third, only-affects-open-files reproduction:

1. Open Writer, open a markdown file, type a change, save (Cmd+S).
2. Watch `[watcher]` events emitted by the Rust side: a single save produces 3 FSEvent records — `Create(File)`, `Modify(Metadata(Extended))`, `Modify(Data(Content))`.
3. The first one is suppressed by `is_self_write` (the `record_write` entry is consumed and removed); the remaining two propagate to the frontend as `fs:file-changed` events. Frontend's `useFileWatcher` then re-reads the file from disk and may overwrite the in-memory buffer if the user has typed further keystrokes in the meantime.

## Root cause

### 1. `should_ignore` filters every path with a dot-prefixed component, including the workspace root

`apps/desktop/src-tauri/src/watcher.rs:20-41`:

```rust
fn should_ignore(path: &Path) -> bool {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        if name == ".git" || name == "node_modules" || name == ".DS_Store" {
            return true;
        }
        if name == ".writer" { continue; }
        if name == ".gitignore" { continue; }
        // Skip hidden files/dirs (but not the root which might be a dotdir)
        if name.starts_with('.') && name.len() > 1 && name != ".." {
            return true;
        }
    }
    false
}
```

The comment on line 35 explicitly acknowledges the case ("but not the root which might be a dotdir") but the code does not implement it: every component of every path is checked, including the components that make up the workspace root itself. For a workspace at `~/.notes/`, the path `/Users/joel/.notes/foo.md` has `.notes` as a component → `should_ignore` returns `true` → every event is dropped at line 162 of `watcher.rs` before any subsequent filter or emit runs.

The function is path-blind: it has no concept of "inside vs. outside the workspace root." It needs the workspace root passed in so it can strip the root prefix and only apply the dot-filter to the _relative_ path components.

### 2. Workspace root and FSEvents paths can disagree (macOS canonicalization)

`notify`'s FSEvents backend canonicalizes every watched path on subscribe (`notify-7.0.0/src/fsevent.rs:367`: `path.to_path_buf().canonicalize()?`) and the events it delivers always use the canonical path. macOS aliases `/var → /private/var`, `/tmp → /private/tmp`, `/etc → /private/etc`, plus any user symlinks.

Writer stores the workspace root unresolved (`commands/workspace.rs:39`: `let root = PathBuf::from(path);` — no `canonicalize`). So:

- Backend emits: `fs:directory-changed { path: "/private/var/folders/.../notes" }`
- Frontend has: `root = "/var/folders/.../notes"`
- `use-file-watcher.ts:51`: `expandedDirs.has(path) || path === root` is `false || false = false`
- Falls through to `invalidatePath(path)`, which clears the cache for `/private/var/...` — a key nothing else ever reads — and the workspace-root cache key (`/var/...`) is left intact and stale.

Same issue affects the `path.strip_prefix(&root)` calls in `watcher.rs:213` (file-index relative-path computation) — `strip_prefix` returns `None` when the prefix differs, falls back to the absolute path, and the file-index entry's `relative_path` ends up as the full `/private/var/...` string.

### 3. Self-write echo only catches the first of N notify events per save

`watcher.rs:66-75`:

```rust
fn is_self_write(state: &WorkspaceState, path: &Path) -> bool {
    let mut writes = state.recent_writes.write();
    if let Some(written_at) = writes.get(path) {
        if written_at.elapsed() < SELF_WRITE_TTL {
            writes.remove(path);          // entry consumed on first hit
            return true;
        }
    }
    false
}
```

A single Writer save produces 3 events on macOS FSEvents (verified empirically): `Create(File)`, `Modify(Metadata(Extended))`, `Modify(Data(Content))`. Suppression consumes the entry on the first match, so the remaining 2 are passed through as legitimate `fs:file-changed` events. The frontend `use-file-watcher.ts:21-30` then re-reads from disk and, if the in-memory `diskContent` doesn't match (which it won't if the user has typed further characters since the save started), calls `editorApi.reloadFromDisk` and clobbers in-progress edits.

This isn't always user-visible — fast typists notice it; slow-typing or single-keypress saves don't trigger the race. But it's the same bug as the file-tree filtering: an over-eager filter masks the real-event channel and an under-eager filter lets duplicates through.

## Proposed fix

Three small, independent changes in `watcher.rs` and one in `commands/workspace.rs`. Smallest possible patch that fixes each root cause; no rearchitecture.

### Fix 1: Make `should_ignore` workspace-root aware

Pass the workspace root into the filter so the dot-component check applies only to the relative path. Stripping the root prefix is cheap; it happens on the watcher's debounced thread, not the IPC thread.

```rust
fn should_ignore(path: &Path, workspace_root: &Path) -> bool {
    let relative = match path.strip_prefix(workspace_root) {
        Ok(rel) => rel,
        Err(_) => return false,    // outside the workspace; let the recursive watch decide
    };
    for component in relative.components() {
        let name = component.as_os_str().to_string_lossy();
        if name == ".git" || name == "node_modules" || name == ".DS_Store" {
            return true;
        }
        if name == ".writer" || name == ".gitignore" { continue; }
        if name.starts_with('.') && name.len() > 1 {
            return true;
        }
    }
    false
}
```

Drop the `name != ".."` check — relative paths starting with `..` cannot occur after `strip_prefix` succeeds.

The call site (`watcher.rs:161`) becomes `if should_ignore(path, &root) { continue; }` — `root` is already available via `state.workspace_root.read()`.

### Fix 2: Canonicalize the workspace root on open

`commands/workspace.rs:39`:

```rust
let root = PathBuf::from(path).canonicalize()
    .map_err(|e| AppError::Io(e.to_string()))?;
```

After canonicalization, store the canonical root in `state.workspace_root` and return it to the frontend in the `WorkspaceInfo`. Two consequences:

- All `path === root` and `path.strip_prefix(&root)` comparisons line up because both sides are canonical.
- The frontend's `root` will be the canonical path, so saved sessions / recent-workspaces entries flip to canonical too. This is desirable — opening "the same" workspace via different aliases (`/var/foo`, `/private/var/foo`) deduplicates correctly via `find_by_workspace`.

The cost is one extra `stat` on workspace open, which is negligible compared to the existing tree walk.

### Fix 3: Per-save self-write window, not per-event

Replace the consume-on-first-match policy with a TTL window: an entry stays alive for `SELF_WRITE_TTL` (2s) and matches every event in that window for the same path.

```rust
fn is_self_write(state: &WorkspaceState, path: &Path) -> bool {
    let writes = state.recent_writes.read();
    writes.get(path)
        .is_some_and(|written_at| written_at.elapsed() < SELF_WRITE_TTL)
}
```

Periodic cleanup of expired entries can stay in `record_write` (already does `writes.retain(|_, t| t.elapsed() < SELF_WRITE_TTL)` at line 82).

Trade-off: a _legitimate_ external write within 2s of a save-by-Writer to the same path will be ignored. This is acceptable — the same-path collision window is small, the next external write outside the window will land, and the alternative (current behaviour) actively corrupts in-progress edits.

### Fix 4: Tag the bootstrap-vs-load `WorkspaceIgnore` so over-broad rules don't silently fire

This is a smaller cleanup, not strictly required, but worth mentioning: `is_workspace_ignored` (`watcher.rs:45-51`) returns `false` if the matcher hasn't loaded yet. Combined with Fix 1, this is fine. But during the brief window between watcher start and full ignore-load (`run_workspace_bootstrap`, `commands/workspace.rs:150`), the bootstrap matcher is in place — and it only knows about `node_modules` / `.git`. A `.gitignore` rule like `private/` won't suppress events until the load completes. That's a pre-existing race; not part of this spec, but flagged so a future review doesn't think it's introduced here.

## Edge cases / risks

- **Dot-directory workspace roots**: After Fix 1, a workspace at `~/.notes/` works. Files inside that the user _also_ wants hidden (e.g. `~/.notes/.cache/`) still get filtered because `.cache` is a dot-component of the relative path.
- **Root canonicalization changes recent-workspaces keys**: After Fix 2, the recent-workspaces list will store canonical paths. Existing entries may be in the un-canonical form. On the first open, a one-time normalization (canonicalize each entry, dedupe) avoids duplicate entries. Drop-in compat: `prepare_workspace_state` should accept either form (canonicalize before lookup).
- **Symlinked workspaces** (`~/notes -> ~/Documents/notes`): After Fix 2, `find_by_workspace` will only match canonical paths. A user dragging the symlink into a second window will correctly focus the existing window because both resolve to the same canonical path.
- **Self-write window collision with rapid external edits**: Fix 3 widens the suppression window. A `git pull` that writes to a file Writer just saved within 2s will be suppressed — but `git pull` typically writes many files, and only the same-path collision is suppressed. Acceptable.
- **Large workspaces (10k+ files)**: No change — `should_ignore` and `is_workspace_ignored` are still O(path-components) and the event volume is the same.
- **Renames**: `notify` reports renames as `Modify(Name(_))` events. `event_kind_str` already maps `Modify(_) → "modified"`, so renames fire `fs:file-changed` for both old and new paths. The frontend handler doesn't currently special-case rename — it just reloads if the file is open. The new path appears via the `fs:directory-changed` for the parent. Adequate.
- **`notify` 7.x macOS behavior**: Confirmed working via standalone reproduction (`/tmp/notify_smoke*` test binaries during investigation): with `notify = { version = "7", features = ["macos_fsevent"] }` and `Config::default().with_poll_interval(...)`, FSEvents delivers `Create(File)` / `Modify(_)` / `Remove(File)` reliably for the workspace root. The bug is not in `notify` or the debounce loop.
- **Linux / Windows**: All fixes are cross-platform. Canonicalization on Linux follows symlinks; on Windows it produces UNC paths. The `path === root` equality fix benefits both.

## Test plan

### Manual

For each of the three reproductions in §Reproduction:

1. Apply the relevant fix.
2. Re-run the reproduction.
3. Verify the sidebar refreshes / the file appears within ~500 ms.

Specifically:

- **Dot-dir workspace**: Open a workspace at `~/.test-vault/` (mkdir it first). From a terminal, `touch ~/.test-vault/foo.md`. The file should appear in the sidebar.
- **/var canonicalization**: Open a workspace at `/var/folders/$(...)/test-vault/` (use a real `/var`-prefixed temp dir). Externally `touch` a file inside. The sidebar should refresh.
- **Self-write echo**: With the editor showing an open file, save (Cmd+S), then _immediately_ type a character. The character must not be lost (no reload-from-disk overwriting in-flight edits).

### Automated

Two new unit tests in `watcher.rs`:

```rust
#[test]
fn should_ignore_respects_workspace_root() {
    let root = Path::new("/Users/joel/.notes");
    assert!(!should_ignore(&root.join("foo.md"), root));
    assert!(!should_ignore(&root.join("docs/bar.md"), root));
    assert!(should_ignore(&root.join(".cache/x"), root));
    assert!(should_ignore(&root.join(".git/HEAD"), root));
}

#[test]
fn self_write_window_allows_multiple_events_per_save() {
    let state = WorkspaceState::default();
    let path = PathBuf::from("/test/file.md");
    record_write(&state, &path);
    assert!(is_self_write(&state, &path));
    assert!(is_self_write(&state, &path));   // second call also suppressed
    assert!(is_self_write(&state, &path));   // and third — within TTL
}
```

One new integration-style test in `commands/workspace.rs` (or wherever `prepare_workspace_state` lives) to verify the canonicalized root round-trips through `WorkspaceInfo`.

### Regression

- `cargo test` (the existing `test_ignores_*` tests in `watcher.rs:344-360` need their signatures updated to pass a workspace root).
- `vp test` (no frontend logic changed; should pass unchanged).
- Open Writer with each existing workspace in `recent_workspaces.json` and confirm none of them are now treated as new workspaces (canonicalization migration is correct).
