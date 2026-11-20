use crate::ignore::{is_gitignore_path, WorkspaceIgnore};
use crate::state::{self, AppState, WorkspaceState};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const SELF_WRITE_TTL: Duration = Duration::from_secs(2);
const DEBOUNCE_MS: u64 = 300;

/// Runtime-gated diagnostic logging. Set `WRITER_WATCHER_LOG=1` before
/// launching to dump every event, filter decision, and emit to stderr —
/// the SPEC's investigation plan for residual "external change missed"
/// reports. No-op (single atomic-bool read) when the env var is unset, so
/// it's safe to leave the call sites in release builds.
fn watcher_log_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var_os("WRITER_WATCHER_LOG").is_some())
}

macro_rules! wlog {
    ($($arg:tt)*) => {
        if watcher_log_enabled() {
            eprintln!("[watcher] {}", format!($($arg)*));
        }
    };
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String,
    pub workspace: Option<WorkspaceIdentity>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIdentity {
    pub root: String,
    pub epoch: u64,
}

/// True if `path` is the workspace's own `.writer/config`. Only the root's
/// file is the workspace settings layer; a `.writer/config` deeper down (a
/// nested repository, a worktree copy) is just another file.
fn is_workspace_config(path: &Path, workspace_root: &Path) -> bool {
    path.strip_prefix(workspace_root)
        .is_ok_and(|relative| relative == Path::new(".writer/config"))
}

/// Re-read `.writer/config` into the window's settings, tell the frontend,
/// and rebuild the hidden-path matcher if `files.exclude` changed.
fn reload_workspace_settings(
    handle: &AppHandle,
    label: &str,
    state: &WorkspaceState,
    root: &Path,
    epoch: u64,
) {
    let loader = state
        .settings
        .read()
        .as_ref()
        .map(|settings| settings.workspace_loader());
    let layer = loader.map(|loader| loader.read(root));
    let excludes_before = state.file_excludes();
    let installed = state.with_workspace_snapshot(root, epoch, || {
        if let (Some(settings), Some(layer)) = (state.settings.write().as_mut(), layer) {
            settings.install_workspace_layer(layer);
        }
    });
    if installed.is_none() {
        return;
    }
    if state.file_excludes() != excludes_before {
        crate::commands::workspace::spawn_workspace_filter_refresh(handle, label);
    }
    let _ = handle.emit_to(
        label,
        "settings:changed",
        WorkspaceIdentity {
            root: root.to_string_lossy().into_owned(),
            epoch,
        },
    );
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
    let hit = writes
        .get(path)
        .is_some_and(|written_at| written_at.elapsed() < SELF_WRITE_TTL);
    if hit {
        wlog!(
            "self-write suppressed: {} ({} tracked)",
            path.display(),
            writes.len()
        );
    }
    hit
}

pub fn record_write(state: &WorkspaceState, path: &Path) {
    let mut writes = state.recent_writes.write();
    writes.insert(path.to_path_buf(), Instant::now());

    // Clean up stale entries
    writes.retain(|_, t| t.elapsed() < SELF_WRITE_TTL);
    wlog!(
        "record_write: {} ({} tracked)",
        path.display(),
        writes.len()
    );
}

/// Push `path` into the file index if not already present, then refresh the
/// `dirs_with_markdown` ancestry so the sidebar's "directory contains
/// markdown" check returns true for newly-populated subtrees.
#[cfg(test)]
fn add_to_index(state: &WorkspaceState, path: &Path, root: &Path) {
    let modified_at = crate::commands::fs::modified_time(path);
    add_to_index_with_modified(state, path, root, modified_at);
}

#[cfg(test)]
fn add_to_index_with_modified(state: &WorkspaceState, path: &Path, root: &Path, modified_at: u64) {
    let mut index = state.file_index.write();
    if let Some(file) = index.iter_mut().find(|f| f.path == path) {
        if file.modified_at != modified_at {
            file.modified_at = modified_at;
            drop(index);
            state.invalidate_recent_files_cache();
        }
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
        modified_at,
    });
    state.file_index_revision.fetch_add(1, Ordering::SeqCst);
    drop(index);
    state.invalidate_recent_files_cache();

    state::register_ancestors(&mut state.dirs_with_markdown.write(), path, root);
}

/// Drop every indexed path under `dir` (a removed folder) and rebuild
/// `dirs_with_markdown`. Needed because FSEvents may report a single
/// `Remove(Folder)` without per-child Remove events.
#[cfg(test)]
fn remove_subtree_from_index(state: &WorkspaceState, dir: &Path, root: &Path) {
    let dir_with_sep = {
        let mut s = dir.to_path_buf();
        s.push("");
        s
    };
    let removed = {
        let mut index = state.file_index.write();
        let before = index.len();
        index.retain(|f| !f.path.starts_with(&dir_with_sep) && f.path != dir);
        let removed = before != index.len();
        if removed {
            state.file_index_revision.fetch_add(1, Ordering::SeqCst);
        }
        removed
    };
    if removed {
        state.invalidate_recent_files_cache();
    }
    let index = state.file_index.read();
    *state.dirs_with_markdown.write() = state::rebuild_dirs_from_index(&index, root);
}

/// Walk `dir` and merge every `.md` descendant into the file index.
///
/// Required for membership-change events that introduce a populated folder
/// — Create(Folder) of a folder copied from outside the workspace, or
/// Modify(Name) when a folder is renamed into place. macOS FSEvents does
/// not re-emit per-child Create events for a renamed inode, so without
/// this walk every file under the new directory would silently disappear
/// from search results until the workspace is reopened.
fn discover_subtree(dir: &Path, ignore: &Arc<WorkspaceIgnore>) -> Vec<crate::state::IndexedFile> {
    let cancel = Arc::new(AtomicBool::new(false));
    let (found, _) = crate::commands::search::index_workspace_impl(dir, ignore, cancel);
    found
}

struct PreparedIndexUpdate {
    revision: u64,
    index: Vec<crate::state::IndexedFile>,
    dirs: std::collections::HashSet<std::path::PathBuf>,
    changed: bool,
}

struct DeferredIndexDrop {
    _index: Vec<crate::state::IndexedFile>,
    _dirs: std::collections::HashSet<std::path::PathBuf>,
    _recent_cache: Option<Vec<crate::state::IndexedFile>>,
}

fn prepare_index_removal(
    state: &WorkspaceState,
    root: &Path,
    mut remove: impl FnMut(&crate::state::IndexedFile) -> bool,
) -> PreparedIndexUpdate {
    let revision = state.file_index_revision.load(Ordering::SeqCst);
    let mut index = state.file_index.read().clone();
    let before = index.len();
    index.retain(|file| !remove(file));
    let changed = index.len() != before;
    let dirs = state::rebuild_dirs_from_index(&index, root);
    PreparedIndexUpdate {
        revision,
        index,
        dirs,
        changed,
    }
}

fn prepare_mtime_update(
    state: &WorkspaceState,
    root: &Path,
    path: &Path,
    modified_at: u64,
) -> PreparedIndexUpdate {
    let revision = state.file_index_revision.load(Ordering::SeqCst);
    let mut index = state.file_index.read().clone();
    let changed = index
        .iter_mut()
        .find(|file| file.path == path)
        .is_some_and(|file| {
            if file.modified_at == modified_at {
                return false;
            }
            file.modified_at = modified_at;
            true
        });
    let dirs = state::rebuild_dirs_from_index(&index, root);
    PreparedIndexUpdate {
        revision,
        index,
        dirs,
        changed,
    }
}

fn discovered_file(path: &Path, modified_at: u64) -> crate::state::IndexedFile {
    crate::state::IndexedFile {
        path: path.to_path_buf(),
        relative_path: String::new(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        modified_at,
    }
}

fn prepare_subtree_merge(
    state: &WorkspaceState,
    found: Vec<crate::state::IndexedFile>,
    root: &Path,
) -> PreparedIndexUpdate {
    let revision = state.file_index_revision.load(Ordering::SeqCst);
    let mut index = state.file_index.read().clone();
    let mut paths = index
        .iter()
        .map(|file| file.path.clone())
        .collect::<std::collections::HashSet<_>>();
    let mut changed = false;
    for file in found {
        if !paths.insert(file.path.clone()) {
            continue;
        }
        let relative_path = file
            .path
            .strip_prefix(root)
            .unwrap_or(&file.path)
            .to_string_lossy()
            .to_string();
        index.push(crate::state::IndexedFile {
            path: file.path,
            relative_path,
            name: file.name,
            modified_at: file.modified_at,
        });
        changed = true;
    }
    let dirs = state::rebuild_dirs_from_index(&index, root);
    PreparedIndexUpdate {
        revision,
        index,
        dirs,
        changed,
    }
}

fn publish_index_update(
    state: &WorkspaceState,
    prepared: PreparedIndexUpdate,
) -> Result<DeferredIndexDrop, PreparedIndexUpdate> {
    let mut index = state.file_index.write();
    if state.file_index_revision.load(Ordering::SeqCst) != prepared.revision {
        return Err(prepared);
    }
    if prepared.changed {
        let old_index = std::mem::replace(&mut *index, prepared.index);
        let old_dirs = std::mem::replace(&mut *state.dirs_with_markdown.write(), prepared.dirs);
        let old_recent_cache = state.recent_files_cache.write().take();
        state.file_index_revision.fetch_add(1, Ordering::SeqCst);
        return Ok(DeferredIndexDrop {
            _index: old_index,
            _dirs: old_dirs,
            _recent_cache: old_recent_cache,
        });
    }
    Ok(DeferredIndexDrop {
        _index: prepared.index,
        _dirs: prepared.dirs,
        _recent_cache: None,
    })
}

fn publish_prepared_index_for_snapshot(
    state: &WorkspaceState,
    root: &Path,
    epoch: u64,
    mut prepare: impl FnMut() -> PreparedIndexUpdate,
) {
    loop {
        let prepared = prepare();
        match state.with_workspace_snapshot(root, epoch, || publish_index_update(state, prepared)) {
            Some(Err(stale)) => {
                drop(stale);
                continue;
            }
            Some(Ok(displaced)) => drop(displaced),
            None => {}
        }
        break;
    }
}

#[cfg(test)]
fn add_subtree_to_index(state: &WorkspaceState, dir: &Path, root: &Path) {
    let ignore = Arc::new(WorkspaceIgnore::bootstrap(root, state.file_excludes()));
    let prepared = prepare_subtree_merge(state, discover_subtree(dir, &ignore), root);
    assert!(publish_index_update(state, prepared).is_ok());
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
    let watched_root = root_path.clone();

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
                    wlog!(
                        "recv: kind={:?} paths={:?}",
                        event.kind,
                        event
                            .paths
                            .iter()
                            .map(|p| p.display().to_string())
                            .collect::<Vec<_>>()
                    );
                    pending.push(event);
                }
                Ok(Err(err)) => {
                    wlog!("recv err: {err:?}");
                    continue;
                }
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

            if state.workspace_snapshot().as_ref() != Some(&(watched_root.clone(), captured_epoch))
            {
                pending.clear();
                last_emit = Instant::now();
                continue;
            }

            let mut rebuild_ignore = false;
            // One matcher snapshot per batch. A workspace always has one
            // (the bootstrap matcher is installed before the watcher starts);
            // the fallback only guards against that invariant breaking.
            let ignore = state.workspace_ignore.read().clone().unwrap_or_else(|| {
                eprintln!(
                    "[watcher] no hidden-path matcher for {}; using the exclusion list only",
                    watched_root.display()
                );
                Arc::new(WorkspaceIgnore::bootstrap(
                    &watched_root,
                    state.file_excludes(),
                ))
            });

            for event in pending.drain(..) {
                for path in &event.paths {
                    // `.writer/config` reloads settings before any filtering,
                    // so it keeps working when `.writer/` is gitignored.
                    if is_workspace_config(path, &watched_root)
                        && event_kind_str(&event.kind).is_some()
                    {
                        wlog!("emit settings:changed {}", path.display());
                        reload_workspace_settings(
                            &handle,
                            &label,
                            &state,
                            &watched_root,
                            captured_epoch,
                        );
                        continue;
                    }

                    // Writer's own atomic-save temp file. The save's real
                    // event is on the target path (a recorded self-write).
                    if crate::commands::fs::is_atomic_write_temp(path) {
                        continue;
                    }

                    // Excluded paths (`.git`, `node_modules`, …) need no stat;
                    // drop them before anything else.
                    if ignore.is_excluded(path) {
                        wlog!("filter[files.exclude]: {}", path.display());
                        continue;
                    }

                    // `.gitignore` changes defer to a background rebuild.
                    if is_gitignore_path(path) {
                        wlog!("filter[gitignore-change]: {}", path.display());
                        rebuild_ignore = true;
                        continue;
                    }

                    // FSEvents reports the path as it was at event time; by
                    // the time we read it the file may already be gone, so
                    // `path.is_dir()` is unreliable. Trust the event kind
                    // first, fall back to the live stat. Computed up here
                    // because `is_ignored` needs an accurate
                    // is_dir to match dir-only gitignore rules (e.g. `dist/`)
                    // against deleted directories.
                    let is_folder_event = matches!(
                        event.kind,
                        EventKind::Remove(notify::event::RemoveKind::Folder)
                    ) || matches!(
                        event.kind,
                        EventKind::Create(notify::event::CreateKind::Folder)
                    );
                    let is_dir = is_folder_event || path.is_dir();

                    if ignore.is_ignored(path, is_dir) {
                        wlog!("filter[workspace_ignore]: {}", path.display());
                        continue;
                    }

                    if is_self_write(&state, path) {
                        continue;
                    }

                    if !is_dir
                        && path.extension().and_then(|e| e.to_str()) == Some("md")
                        && path.exists()
                    {
                        let modified_at = crate::commands::fs::modified_time(path);
                        publish_prepared_index_for_snapshot(
                            &state,
                            &watched_root,
                            captured_epoch,
                            || prepare_mtime_update(&state, &watched_root, path, modified_at),
                        );
                    }

                    let kind_str = match event_kind_str(&event.kind) {
                        Some(k) => k,
                        None => {
                            wlog!("filter[unmapped_kind]: {:?} {}", event.kind, path.display());
                            continue;
                        }
                    };

                    let payload = FileChangeEvent {
                        path: path.to_string_lossy().to_string(),
                        kind: kind_str.to_string(),
                        workspace: Some(WorkspaceIdentity {
                            root: watched_root.to_string_lossy().into_owned(),
                            epoch: captured_epoch,
                        }),
                    };

                    if is_dir {
                        wlog!(
                            "emit fs:directory-changed kind={kind_str} {}",
                            path.display()
                        );
                        let _ = handle.emit_to(label.clone(), "fs:directory-changed", &payload);
                    } else {
                        wlog!("emit fs:file-changed kind={kind_str} {}", path.display());
                        let _ = handle.emit_to(label.clone(), "fs:file-changed", &payload);
                    }

                    // Treat Create, Remove, and Rename (Modify(Name)) as
                    // directory-membership changes. Finder's "Move to Trash"
                    // and `mv file /elsewhere` arrive as Modify(Name(_)) on
                    // macOS — not Remove — so the previous code missed them
                    // entirely.
                    let is_membership_change = matches!(
                        event.kind,
                        EventKind::Create(_)
                            | EventKind::Remove(_)
                            | EventKind::Modify(notify::event::ModifyKind::Name(_))
                    );
                    if !is_membership_change {
                        continue;
                    }

                    // Maintain the file index by reading current ground truth
                    // (`path.exists()`) instead of trusting the event kind.
                    // FSEvents coalesces Create+Remove for the same path
                    // within one watch window, and Modify(Name) doesn't tell
                    // us which side of the rename this path is.
                    let is_md = path.extension().and_then(|e| e.to_str()) == Some("md");
                    let path_exists = path.exists();
                    if is_md {
                        if path_exists {
                            let modified_at = crate::commands::fs::modified_time(path);
                            let found = vec![discovered_file(path, modified_at)];
                            publish_prepared_index_for_snapshot(
                                &state,
                                &watched_root,
                                captured_epoch,
                                || prepare_subtree_merge(&state, found.clone(), &watched_root),
                            );
                        } else {
                            publish_prepared_index_for_snapshot(
                                &state,
                                &watched_root,
                                captured_epoch,
                                || {
                                    prepare_index_removal(&state, &watched_root, |file| {
                                        file.path.as_path() == path.as_path()
                                    })
                                },
                            );
                        }
                    } else if path_exists && is_dir {
                        // A folder entered the watched tree (Create or
                        // rename-in). FSEvents won't re-emit Create events
                        // for descendants, so walk now to keep the index
                        // in sync.
                        let found = discover_subtree(path, &ignore);
                        publish_prepared_index_for_snapshot(
                            &state,
                            &watched_root,
                            captured_epoch,
                            || prepare_subtree_merge(&state, found.clone(), &watched_root),
                        );
                    } else if !path_exists {
                        // A vanished non-`.md` path could be a renamed-
                        // away folder; FSEvents may not emit per-child
                        // events for the descendants, so prune anything
                        // the index still holds under it.
                        publish_prepared_index_for_snapshot(
                            &state,
                            &watched_root,
                            captured_epoch,
                            || {
                                prepare_index_removal(&state, &watched_root, |file| {
                                    file.path.as_path() == path.as_path()
                                        || file.path.starts_with(path)
                                })
                            },
                        );
                    }

                    // Refresh the parent directory's listing. Without this,
                    // non-`.md` file changes, folder deletes, and Finder
                    // moves never trigger a sidebar refresh.
                    if !is_dir {
                        if let Some(parent) = path.parent() {
                            wlog!("emit fs:directory-changed (parent) {}", parent.display());
                            let parent_payload = FileChangeEvent {
                                path: parent.to_string_lossy().to_string(),
                                kind: "modified".to_string(),
                                workspace: Some(WorkspaceIdentity {
                                    root: watched_root.to_string_lossy().into_owned(),
                                    epoch: captured_epoch,
                                }),
                            };
                            let _ = handle.emit_to(
                                label.clone(),
                                "fs:directory-changed",
                                &parent_payload,
                            );
                        }
                    }
                }
            }

            if rebuild_ignore {
                crate::commands::workspace::spawn_workspace_filter_refresh(&handle, &label);
            }

            last_emit = Instant::now();
        }
    });

    Ok(watcher)
}

/// Start a lightweight watcher for a single standalone file (compact mode,
/// no workspace). Watches the file's *parent directory* non-recursively:
/// watching the file inode directly would break on atomic temp+rename saves
/// — Writer's own `write_file_impl` and most editors replace the inode, and
/// the watch would die with the old one. Only events whose path matches the
/// watched file are forwarded; there is no index maintenance, no ignore
/// matching, and no directory-change fan-out.
pub fn start_file_watcher(
    app_handle: AppHandle,
    window_label: String,
    file: &Path,
    epoch: u64,
) -> Result<RecommendedWatcher, notify::Error> {
    let file_path = file.to_path_buf();
    let parent = file_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| notify::Error::generic("standalone file has no parent directory"))?;
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        notify::Config::default().with_poll_interval(Duration::from_millis(DEBOUNCE_MS)),
    )?;

    watcher.watch(&parent, RecursiveMode::NonRecursive)?;
    wlog!(
        "file watcher started for {} (watching {})",
        file_path.display(),
        parent.display()
    );

    let handle = app_handle;
    let label = window_label;
    std::thread::spawn(move || {
        let mut last_emit = Instant::now();
        let mut pending: Vec<Event> = Vec::new();

        loop {
            match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                Ok(Ok(event)) => pending.push(event),
                Ok(Err(err)) => {
                    wlog!("file watcher recv err: {err:?}");
                    continue;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if pending.is_empty() || last_emit.elapsed() < Duration::from_millis(DEBOUNCE_MS) {
                continue;
            }

            let Some(state) = handle.state::<AppState>().get(&label) else {
                break;
            };

            // Drop the batch if the window has moved on to another file or
            // a workspace (epoch bump on every watch target switch).
            if state.workspace_epoch.load(Ordering::SeqCst) != epoch {
                pending.clear();
                last_emit = Instant::now();
                continue;
            }

            for event in pending.drain(..) {
                let Some(kind_str) = event_kind_str(&event.kind) else {
                    continue;
                };
                for path in &event.paths {
                    if *path != file_path {
                        continue;
                    }
                    if is_self_write(&state, path) {
                        continue;
                    }
                    wlog!(
                        "emit fs:file-changed (standalone) kind={kind_str} {}",
                        path.display()
                    );
                    let _ = handle.emit_to(
                        label.clone(),
                        "fs:file-changed",
                        &FileChangeEvent {
                            path: path.to_string_lossy().to_string(),
                            kind: kind_str.to_string(),
                            workspace: None,
                        },
                    );
                }
            }

            last_emit = Instant::now();
        }
    });

    Ok(watcher)
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

    #[test]
    fn only_the_root_writer_config_is_the_workspace_config() {
        let root = Path::new("/workspace");
        assert!(is_workspace_config(
            Path::new("/workspace/.writer/config"),
            root
        ));
        assert!(!is_workspace_config(
            Path::new("/workspace/.claude/worktrees/x/.writer/config"),
            root
        ));
        assert!(!is_workspace_config(
            Path::new("/workspace/.writer/other"),
            root
        ));
        assert!(!is_workspace_config(
            Path::new("/elsewhere/.writer/config"),
            root
        ));
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
    fn self_write_entry_is_not_consumed_on_match() {
        // Regression: an earlier implementation removed the entry on first
        // match, which dropped the second and third events from the same
        // save's fan-out and let the frontend reload the file from disk
        // mid-keystroke.
        let state = WorkspaceState::default();
        let path = PathBuf::from("/test/file.md");

        record_write(&state, &path);
        assert!(is_self_write(&state, &path));
        assert_eq!(
            state.recent_writes.read().len(),
            1,
            "entry must survive the lookup so subsequent FSEvent fan-out is also suppressed"
        );
        assert!(is_self_write(&state, &path));
        assert_eq!(state.recent_writes.read().len(), 1);
    }

    #[test]
    fn self_write_expires_after_ttl() {
        // The TTL window is what bounds suppression — past it, legitimate
        // external edits to the same path must be reflected in the editor.
        let state = WorkspaceState::default();
        let path = PathBuf::from("/test/file.md");

        // Insert a stale entry directly so the test doesn't have to sleep
        // through the real TTL.
        state.recent_writes.write().insert(
            path.clone(),
            Instant::now() - SELF_WRITE_TTL - Duration::from_millis(50),
        );

        assert!(!is_self_write(&state, &path));
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
    fn add_subtree_walks_real_directory_and_indexes_md_files() {
        // Regression: a folder rename within the watch tree (`Modify(Name)`
        // with `path_exists`) must populate the index for every `.md`
        // descendant. Before this test existed, the appearing side of a
        // rename was silently no-op'd and search/sidebar drifted from disk.
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let nested = root.join("nested");
        std::fs::create_dir_all(nested.join("deeper")).unwrap();
        std::fs::write(nested.join("a.md"), "# a").unwrap();
        std::fs::write(nested.join("deeper/b.md"), "# b").unwrap();
        std::fs::write(nested.join("ignored.txt"), "x").unwrap();

        let state = WorkspaceState::default();
        add_subtree_to_index(&state, &nested, &root);

        let paths: Vec<_> = state
            .file_index
            .read()
            .iter()
            .map(|f| f.path.clone())
            .collect();
        assert!(paths.contains(&nested.join("a.md")));
        assert!(paths.contains(&nested.join("deeper/b.md")));
        assert_eq!(paths.len(), 2, "non-md files must not be indexed");

        let dirs = state.dirs_with_markdown.read();
        assert!(dirs.contains(&nested));
        assert!(dirs.contains(&nested.join("deeper")));
        assert!(dirs.contains(&root), "ancestors register up to the root");
    }

    #[test]
    fn add_subtree_is_idempotent_against_existing_entries() {
        // Re-running over the same directory must not duplicate indexed paths.
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("a.md"), "# a").unwrap();

        let state = WorkspaceState::default();
        add_subtree_to_index(&state, &root, &root);
        add_subtree_to_index(&state, &root, &root);
        assert_eq!(state.file_index.read().len(), 1);
    }

    #[test]
    fn prepared_index_publication_rejects_a_changed_revision() {
        let state = WorkspaceState::default();
        let root = PathBuf::from("/ws");
        let found = vec![discovered_file(&root.join("new.md"), 1)];
        let prepared = prepare_subtree_merge(&state, found, &root);

        state.file_index_revision.fetch_add(1, Ordering::SeqCst);

        assert!(publish_index_update(&state, prepared).is_err());
        assert!(state.file_index.read().is_empty());
    }

    #[test]
    fn workspace_identity_serialization_matches_the_shared_contract() {
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../shared/workspace-identity.contract.json"
        ))
        .unwrap();
        let actual = serde_json::to_value(WorkspaceIdentity {
            root: "/workspace".to_string(),
            epoch: 7,
        })
        .unwrap();

        assert_eq!(actual, expected);
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
