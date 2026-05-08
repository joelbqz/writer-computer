use crate::ignore::{is_gitignore_path, WorkspaceIgnore};
use crate::state::{self, AppState, WorkspaceState};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const SELF_WRITE_TTL: Duration = Duration::from_secs(2);
const DEBOUNCE_MS: u64 = 300;

#[derive(Debug, Clone, Serialize)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String,
}

/// True if `path` should be dropped before any further processing.
///
/// Only the *relative* path (inside the workspace root) is inspected — a
/// workspace at `~/.notes/` must keep firing events even though `.notes` is a
/// dotdir. Paths outside the root are kept; the recursive watch already
/// scopes things, and bailing out here would silently drop legitimate events
/// that happen to share a prefix with the canonical root via macOS aliasing.
fn should_ignore(path: &Path, workspace_root: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(workspace_root) else {
        return false;
    };
    for component in relative.components() {
        let name = component.as_os_str().to_string_lossy();
        if name == ".git" || name == "node_modules" || name == ".DS_Store" {
            return true;
        }
        // Allow .writer directory (workspace config) and .gitignore files —
        // both must be watchable: settings reload on the former, matcher
        // rebuild on the latter.
        if name == ".writer" || name == ".gitignore" {
            continue;
        }
        if name.starts_with('.') && name.len() > 1 {
            return true;
        }
    }
    false
}

/// Check the workspace ignore matcher, if any. Returns `false` when no
/// matcher is loaded yet so events are never silently dropped.
fn is_workspace_ignored(state: &WorkspaceState, path: &Path, is_dir: bool) -> bool {
    let guard = state.workspace_ignore.read();
    guard
        .as_ref()
        .map(|ignore| ignore.is_ignored(path, is_dir))
        .unwrap_or(false)
}

/// Check if a path is a config file that should trigger settings reload.
fn is_config_file(path: &Path) -> bool {
    // Workspace config: .writer/config
    if path.file_name().and_then(|n| n.to_str()) == Some("config") {
        if let Some(parent) = path.parent() {
            if parent.file_name().and_then(|n| n.to_str()) == Some(".writer") {
                return true;
            }
        }
    }
    false
}

/// True if `path` was written by Writer itself within the TTL window.
///
/// A single save fans out into multiple FSEvent records on macOS (Create,
/// Modify(Metadata), Modify(Data)); they all need to be suppressed so the
/// frontend doesn't reload the file from disk and clobber in-progress edits
/// keystrokes. The entry is *not* consumed on match — `record_write` cleans up
/// expired entries on its next call.
fn is_self_write(state: &WorkspaceState, path: &Path) -> bool {
    let writes = state.recent_writes.read();
    writes
        .get(path)
        .is_some_and(|written_at| written_at.elapsed() < SELF_WRITE_TTL)
}

pub fn record_write(state: &WorkspaceState, path: &Path) {
    let mut writes = state.recent_writes.write();
    writes.insert(path.to_path_buf(), Instant::now());

    // Clean up stale entries
    writes.retain(|_, t| t.elapsed() < SELF_WRITE_TTL);
}

/// Push `path` into the file index if not already present, then refresh the
/// `dirs_with_markdown` ancestry so the sidebar's "directory contains
/// markdown" check returns true for newly-populated subtrees.
fn add_to_index(state: &WorkspaceState, path: &Path, root: &Path) {
    let mut index = state.file_index.write();
    if index.iter().any(|f| f.path == path) {
        return;
    }
    let rel = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    index.push(crate::state::IndexedFile {
        path: path.to_path_buf(),
        relative_path: rel,
        name,
    });
    drop(index);

    state::register_ancestors(&mut state.dirs_with_markdown.write(), path, root);
}

/// Drop a single path from the file index and rebuild `dirs_with_markdown`.
fn remove_from_index(state: &WorkspaceState, path: &Path, root: &Path) {
    state.file_index.write().retain(|f| f.path != path);
    let index = state.file_index.read();
    *state.dirs_with_markdown.write() = state::rebuild_dirs_from_index(&index, root);
}

/// Drop every indexed path under `dir` (a removed folder) and rebuild
/// `dirs_with_markdown`. Needed because FSEvents may report a single
/// `Remove(Folder)` without per-child Remove events.
fn remove_subtree_from_index(state: &WorkspaceState, dir: &Path, root: &Path) {
    let dir_with_sep = {
        let mut s = dir.to_path_buf();
        s.push("");
        s
    };
    state
        .file_index
        .write()
        .retain(|f| !f.path.starts_with(&dir_with_sep) && f.path != dir);
    let index = state.file_index.read();
    *state.dirs_with_markdown.write() = state::rebuild_dirs_from_index(&index, root);
}

fn event_kind_str(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("deleted"),
        _ => None,
    }
}

/// Start a file watcher targeted at a specific window. All emitted events
/// are routed via `emit_to(&window_label, ...)` so two windows hosting
/// different workspaces don't cross-talk on file events. The watcher
/// captures the window label plus the workspace epoch; when the epoch
/// moves on (workspace switch inside the same window) the debounced event
/// loop drops the batch.
pub fn start_watcher(
    app_handle: AppHandle,
    window_label: String,
    root: &Path,
    epoch: u64,
) -> Result<RecommendedWatcher, notify::Error> {
    let root_path = root.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(DEBOUNCE_MS)),
    )?;

    watcher.watch(&root_path, RecursiveMode::Recursive)?;

    let captured_epoch = epoch;

    // Spawn thread to process events
    let handle = app_handle.clone();
    let label = window_label.clone();
    std::thread::spawn(move || {
        // Simple debounce: collect events for DEBOUNCE_MS, then process
        let mut last_emit = Instant::now();
        let mut pending: Vec<Event> = Vec::new();

        loop {
            match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                Ok(Ok(event)) => {
                    pending.push(event);
                }
                Ok(Err(_)) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if pending.is_empty() || last_emit.elapsed() < Duration::from_millis(DEBOUNCE_MS) {
                continue;
            }

            // Look up this window's state. If the window has already been
            // closed (its WorkspaceState removed from the registry) the
            // watcher has nothing to drive; stop the event loop so the
            // thread exits cleanly.
            let Some(state) = handle.state::<AppState>().get(&label) else {
                break;
            };

            // Drop the whole batch if the workspace has moved on.
            if state.workspace_epoch.load(Ordering::SeqCst) != captured_epoch {
                pending.clear();
                last_emit = Instant::now();
                continue;
            }

            let mut rebuild_ignore = false;
            let root_for_filter = state.workspace_root.read().clone();

            for event in pending.drain(..) {
                for path in &event.paths {
                    if let Some(ref root) = root_for_filter {
                        if should_ignore(path, root) {
                            continue;
                        }
                    }

                    // `.gitignore` changes defer to a background rebuild.
                    if is_gitignore_path(path) {
                        rebuild_ignore = true;
                        continue;
                    }

                    if is_workspace_ignored(&state, path, path.is_dir()) {
                        continue;
                    }

                    if is_self_write(&state, path) {
                        continue;
                    }

                    let kind_str = match event_kind_str(&event.kind) {
                        Some(k) => k,
                        None => continue,
                    };

                    // FSEvents reports the path as it was at event time; by
                    // the time we read it the file may already be gone, so
                    // `path.is_dir()` is unreliable for "is this a directory?".
                    // Trust the event kind first, fall back to the live stat.
                    let is_folder_event = matches!(
                        event.kind,
                        EventKind::Remove(notify::event::RemoveKind::Folder)
                    ) || matches!(
                        event.kind,
                        EventKind::Create(notify::event::CreateKind::Folder)
                    );
                    let is_dir = is_folder_event || path.is_dir();

                    let payload = FileChangeEvent {
                        path: path.to_string_lossy().to_string(),
                        kind: kind_str.to_string(),
                    };

                    if is_dir {
                        let _ = handle.emit_to(label.clone(), "fs:directory-changed", &payload);
                    } else {
                        // `.writer/config` changes reload settings instead.
                        if is_config_file(path) {
                            if let Some(ref mut s) = *state.settings.write() {
                                s.reload_workspace();
                            }
                            let _ = handle.emit_to(label.clone(), "settings:changed", ());
                            continue;
                        }

                        let _ = handle.emit_to(label.clone(), "fs:file-changed", &payload);
                    }

                    // Maintain the file index for `.md` files. Existence is
                    // checked instead of trusting Create vs. Remove because
                    // FSEvents coalesces both kinds for the same path within
                    // one watch window — relying on the event kind alone
                    // leaks phantom entries (Create after Remove) or drops
                    // legitimate ones (Remove after Create).
                    let is_md = path.extension().and_then(|e| e.to_str()) == Some("md");
                    let root = state.workspace_root.read().clone();
                    if matches!(event.kind, EventKind::Create(_) | EventKind::Remove(_)) {
                        if is_md {
                            if let Some(ref root) = root {
                                if path.exists() {
                                    add_to_index(&state, path, root);
                                } else {
                                    remove_from_index(&state, path, root);
                                }
                            }
                        } else if matches!(event.kind, EventKind::Remove(_)) && is_folder_event {
                            // A removed folder takes any indexed `.md`
                            // descendants with it; FSEvents may not have
                            // emitted per-child Remove events if the delete
                            // landed in a single batch.
                            if let Some(ref root) = root {
                                remove_subtree_from_index(&state, path, root);
                            }
                        }

                        // Refresh the parent directory's listing for any file
                        // or folder create/remove. Without this, non-`.md`
                        // file changes and folder deletes never trigger a
                        // sidebar refresh.
                        if !is_dir {
                            if let Some(parent) = path.parent() {
                                let _ = handle.emit_to(
                                    label.clone(),
                                    "fs:directory-changed",
                                    &FileChangeEvent {
                                        path: parent.to_string_lossy().to_string(),
                                        kind: "modified".to_string(),
                                    },
                                );
                            }
                        }
                    }
                }
            }

            if rebuild_ignore {
                if let Some(root) = state.workspace_root.read().clone() {
                    spawn_ignore_rebuild(handle.clone(), label.clone(), root, captured_epoch);
                }
            }

            last_emit = Instant::now();
        }
    });

    Ok(watcher)
}

/// Rebuild the workspace gitignore matcher on a one-shot background thread,
/// then swap it in and nudge the sidebar to re-read. Keeps the watcher's
/// event loop free while the tree walk runs.
fn spawn_ignore_rebuild(
    handle: AppHandle,
    window_label: String,
    root: std::path::PathBuf,
    captured_epoch: u64,
) {
    std::thread::spawn(move || {
        let new_matcher = Arc::new(WorkspaceIgnore::load(&root));
        let Some(state) = handle.state::<AppState>().get(&window_label) else {
            return;
        };

        // Bail out if the workspace was swapped while we were walking.
        if state.workspace_epoch.load(Ordering::SeqCst) != captured_epoch {
            return;
        }
        *state.workspace_ignore.write() = Some(new_matcher);

        let _ = handle.emit_to(
            window_label,
            "fs:directory-changed",
            FileChangeEvent {
                path: root.to_string_lossy().to_string(),
                kind: "modified".to_string(),
            },
        );
    });
}

/// Drop a `RecommendedWatcher` on a detached thread. `notify`'s `Drop` impl
/// can briefly block on FSEvents unregistration (macOS) or inotify watch
/// removal (Linux); off-loading keeps the IPC thread responsive when the
/// user rapidly switches workspaces.
pub fn drop_watcher_off_thread(watcher: Option<RecommendedWatcher>) {
    let Some(watcher) = watcher else {
        return;
    };
    std::thread::spawn(move || drop(watcher));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const ROOT: &str = "/workspace";

    #[test]
    fn test_ignores_git_directory() {
        let root = Path::new(ROOT);
        assert!(should_ignore(Path::new("/workspace/.git/config"), root));
        assert!(should_ignore(
            Path::new("/workspace/.git/refs/heads/main"),
            root
        ));
    }

    #[test]
    fn test_ignores_hidden_files() {
        let root = Path::new(ROOT);
        assert!(should_ignore(Path::new("/workspace/.DS_Store"), root));
        assert!(should_ignore(Path::new("/workspace/.hidden/file.md"), root));
    }

    #[test]
    fn test_does_not_ignore_normal_files() {
        let root = Path::new(ROOT);
        assert!(!should_ignore(Path::new("/workspace/notes/hello.md"), root));
        assert!(!should_ignore(Path::new("/workspace/readme.md"), root));
    }

    #[test]
    fn dotdir_workspace_root_does_not_filter_its_own_paths() {
        // Regression: a workspace at `~/.notes/` must keep firing events even
        // though `.notes` is a dotdir.
        let root = Path::new("/Users/joel/.notes");
        assert!(!should_ignore(&root.join("foo.md"), root));
        assert!(!should_ignore(&root.join("docs/bar.md"), root));
        // Hidden subdirs inside the dotdir root are still filtered.
        assert!(should_ignore(&root.join(".cache/x"), root));
        assert!(should_ignore(&root.join(".git/HEAD"), root));
    }

    #[test]
    fn paths_outside_root_are_not_filtered_here() {
        // `should_ignore` only applies to paths inside the root; the recursive
        // watch and `is_workspace_ignored` handle anything else.
        let root = Path::new("/workspace");
        assert!(!should_ignore(Path::new("/elsewhere/.cache/file"), root));
    }

    #[test]
    fn test_self_write_detection() {
        let state = WorkspaceState::default();
        let path = PathBuf::from("/test/file.md");

        assert!(!is_self_write(&state, &path));
        record_write(&state, &path);

        // A single save produces multiple FSEvents (Create + Modify(Metadata)
        // + Modify(Data)); every match within the TTL window must be
        // suppressed, not just the first.
        assert!(is_self_write(&state, &path));
        assert!(is_self_write(&state, &path));
        assert!(is_self_write(&state, &path));
    }

    #[test]
    fn add_to_index_is_idempotent() {
        let state = WorkspaceState::default();
        let root = PathBuf::from("/ws");
        let path = root.join("note.md");

        add_to_index(&state, &path, &root);
        add_to_index(&state, &path, &root);

        assert_eq!(state.file_index.read().len(), 1);
        assert!(state.dirs_with_markdown.read().contains(&root));
    }

    #[test]
    fn remove_subtree_drops_only_matching_descendants() {
        let state = WorkspaceState::default();
        let root = PathBuf::from("/ws");
        let kept = root.join("kept.md");
        let inside = root.join("sub/inside.md");
        let inside2 = root.join("sub/nested/x.md");
        let sibling = root.join("submarine/y.md");

        add_to_index(&state, &kept, &root);
        add_to_index(&state, &inside, &root);
        add_to_index(&state, &inside2, &root);
        add_to_index(&state, &sibling, &root);

        remove_subtree_from_index(&state, &root.join("sub"), &root);

        let paths: Vec<_> = state
            .file_index
            .read()
            .iter()
            .map(|f| f.path.clone())
            .collect();
        assert!(paths.contains(&kept));
        assert!(paths.contains(&sibling), "prefix-named sibling kept");
        assert!(!paths.contains(&inside), "direct child removed");
        assert!(!paths.contains(&inside2), "nested child removed");

        let dirs = state.dirs_with_markdown.read();
        assert!(dirs.contains(&root));
        assert!(dirs.contains(&root.join("submarine")));
        assert!(!dirs.contains(&root.join("sub")));
        assert!(!dirs.contains(&root.join("sub/nested")));
    }
}
