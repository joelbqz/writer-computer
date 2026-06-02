use crate::config::Settings;
use crate::ignore::WorkspaceIgnore;
use crate::open_target::PendingOpenPayload;
use crate::symlink::{SymlinkMap, WatchPath};
use notify::RecommendedWatcher;
use parking_lot::{Mutex, RwLock};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Per-window workspace state. Every open window has exactly one
/// `WorkspaceState`, keyed by the window's Tauri label inside [`AppState`].
/// All workspace-bound runtime data — the loaded file index, the file
/// watcher, the gitignore matcher, the per-window settings layer — lives
/// here so multiple windows can host different workspaces simultaneously
/// without clobbering each other.
pub struct WorkspaceState {
    pub workspace_root: RwLock<Option<PathBuf>>,
    pub file_index: RwLock<Vec<IndexedFile>>,
    pub dirs_with_markdown: RwLock<HashSet<PathBuf>>,
    /// Set to `true` after the first full index completes.
    /// When `false`, `dir_contains_markdown` falls back to recursive check.
    pub index_ready: AtomicBool,
    pub watcher_handle: RwLock<Option<RecommendedWatcher>>,
    /// Tracks recently written paths to avoid echo from file watcher.
    /// Maps path -> time of write. Entries older than 2s are stale.
    pub recent_writes: RwLock<HashMap<PathBuf, Instant>>,
    /// Gitignore matcher for the current workspace. Rebuilt when any
    /// `.gitignore` file changes. `None` until the first workspace is opened.
    pub workspace_ignore: RwLock<Option<Arc<WorkspaceIgnore>>>,
    /// Logical workspace symlink paths keyed by canonical target paths. The
    /// watcher uses this to translate target events back to visible paths.
    pub symlink_targets: RwLock<SymlinkMap>,
    /// Extra symlink target watch registrations currently added to
    /// `watcher_handle`. Cleared on workspace switch with the watcher itself.
    pub symlink_watch_paths: RwLock<HashSet<WatchPath>>,
    /// Monotonic counter incremented on every workspace switch inside this
    /// window. Background tasks capture it at launch and re-check before
    /// writing; stale results are dropped. Watcher closures capture it too
    /// so events queued against a prior workspace never mutate the new
    /// workspace's state.
    pub workspace_epoch: AtomicU64,
    /// Cancellation flag threaded through the active index walker. On
    /// workspace switch the outgoing flag is flipped to `true` so the old
    /// walker exits within a directory boundary instead of running to
    /// completion; a fresh flag is installed for the new workspace.
    pub cancel_index: RwLock<Arc<AtomicBool>>,
    /// Per-window settings: global layer is loaded from the app data dir
    /// (shared by all windows) but the workspace layer reflects *this*
    /// window's workspace. Two windows with different workspaces therefore
    /// carry different merged settings without clobbering each other.
    pub settings: RwLock<Option<Settings>>,
    /// Open target set before this window's `get_startup_state` has read the
    /// startup slot. Usually seeded during window creation (CLI args or
    /// `open_new_workspace_window`); macOS `RunEvent::Opened` can also seed
    /// the hidden main window before React asks for startup state.
    pub startup_open: Mutex<Option<PendingOpenPayload>>,
    /// Flips to `true` once `get_startup_state` has attempted to read
    /// `startup_open`. After this point, open events must use `pending_open`
    /// because the startup slot will not be read again.
    pub startup_open_taken: AtomicBool,
    /// Runtime-only queue for drag-drop / dock-drop events after the startup
    /// slot has been read. Drained by the frontend once startup hydration
    /// completes. Never read by `get_startup_state`.
    pub pending_open: Mutex<VecDeque<PendingOpenPayload>>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IndexedFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub name: String,
    pub is_symlink: bool,
    pub canonical_path: Option<PathBuf>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            workspace_root: RwLock::new(None),
            file_index: RwLock::new(Vec::new()),
            dirs_with_markdown: RwLock::new(HashSet::new()),
            index_ready: AtomicBool::new(false),
            watcher_handle: RwLock::new(None),
            recent_writes: RwLock::new(HashMap::new()),
            workspace_ignore: RwLock::new(None),
            symlink_targets: RwLock::new(SymlinkMap::default()),
            symlink_watch_paths: RwLock::new(HashSet::new()),
            workspace_epoch: AtomicU64::new(0),
            cancel_index: RwLock::new(Arc::new(AtomicBool::new(false))),
            settings: RwLock::new(None),
            startup_open: Mutex::new(None),
            startup_open_taken: AtomicBool::new(false),
            pending_open: Mutex::new(VecDeque::new()),
        }
    }
}

impl WorkspaceState {
    pub fn set_startup_open(&self, payload: PendingOpenPayload) {
        debug_assert!(
            !self.startup_open_taken.load(Ordering::Acquire),
            "startup_open was set after get_startup_state consumed it"
        );
        *self.startup_open.lock() = Some(payload);
    }

    pub fn try_set_startup_open(
        &self,
        payload: PendingOpenPayload,
    ) -> Result<(), PendingOpenPayload> {
        let mut startup_open = self.startup_open.lock();
        if self.startup_open_taken.load(Ordering::Acquire) || startup_open.is_some() {
            return Err(payload);
        }
        *startup_open = Some(payload);
        Ok(())
    }

    pub fn take_startup_open(&self) -> Option<PendingOpenPayload> {
        let mut startup_open = self.startup_open.lock();
        let payload = startup_open.take();
        self.startup_open_taken.store(true, Ordering::Release);
        payload
    }

    pub fn push_pending_open(&self, payload: PendingOpenPayload) {
        let mut pending = self.pending_open.lock();
        if pending.back() == Some(&payload) {
            return;
        }
        pending.push_back(payload);
    }

    pub fn pop_pending_open(&self) -> Option<PendingOpenPayload> {
        self.pending_open.lock().pop_front()
    }

    pub fn has_pending_workspace(&self, path: &Path) -> bool {
        let has_startup = self
            .startup_open
            .lock()
            .as_ref()
            .is_some_and(|p| Path::new(&p.workspace) == path);
        if has_startup {
            return true;
        }
        self.pending_open
            .lock()
            .iter()
            .any(|payload| Path::new(&payload.workspace) == path)
    }
}

/// Process-wide registry of per-window `WorkspaceState`, keyed by Tauri
/// window label. The main window uses the label `"main"`; secondary
/// windows get uuid-based labels assigned by
/// `commands::workspace::open_workspace_in_new_window`.
pub struct AppState {
    windows: RwLock<HashMap<String, Arc<WorkspaceState>>>,
    /// Serializes read-modify-write on the shared `sessions.json` file so
    /// two windows can't clobber each other's tab state under the 500 ms
    /// debounce. Held only for the load→save span.
    pub sessions_file_lock: Mutex<()>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            windows: RwLock::new(HashMap::new()),
            sessions_file_lock: Mutex::new(()),
        }
    }

    /// Return the window's state, creating a fresh `WorkspaceState` if this
    /// label is unknown. Called by every Tauri command at the top of its
    /// body after deriving the window label from the invoking webview.
    pub fn get_or_create(&self, label: &str) -> Arc<WorkspaceState> {
        {
            let map = self.windows.read();
            if let Some(state) = map.get(label) {
                return state.clone();
            }
        }
        let mut map = self.windows.write();
        map.entry(label.to_string())
            .or_insert_with(|| Arc::new(WorkspaceState::default()))
            .clone()
    }

    pub fn get(&self, label: &str) -> Option<Arc<WorkspaceState>> {
        self.windows.read().get(label).cloned()
    }

    /// Remove and return a window's state. Called from the window-close
    /// event handler so the watcher's `Drop` runs (stopping FSEvents /
    /// inotify subscriptions) and the index memory is reclaimed.
    pub fn remove(&self, label: &str) -> Option<Arc<WorkspaceState>> {
        self.windows.write().remove(label)
    }

    /// Find an existing window already hosting or opening `path`. Used to
    /// focus rather than duplicate when the user opens a workspace that's
    /// already open in another window. Pending opens are included so two
    /// quick requests for the same workspace do not race before the new
    /// window hydrates and publishes `workspace_root`.
    pub fn find_by_workspace(&self, path: &Path) -> Option<String> {
        let map = self.windows.read();
        for (label, state) in map.iter() {
            let guard = state.workspace_root.read();
            if let Some(root) = guard.as_deref() {
                if root == path {
                    return Some(label.clone());
                }
            }
            drop(guard);

            if state.has_pending_workspace(path) {
                return Some(label.clone());
            }
        }
        None
    }

    /// Snapshot of all known window labels. Used by startup code to emit
    /// broadcast-style events without hard-coding labels.
    pub fn labels(&self) -> Vec<String> {
        self.windows.read().keys().cloned().collect()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Registers all ancestor directories of a file path into the set.
/// Short-circuits when hitting a directory already in the set (its ancestors are too).
pub fn register_ancestors(dirs: &mut HashSet<PathBuf>, file_path: &Path, root: &Path) {
    let mut dir = file_path.parent();
    while let Some(d) = dir {
        if !dirs.insert(d.to_path_buf()) {
            break;
        }
        if d == root {
            break;
        }
        dir = d.parent();
    }
}

/// Rebuild dirs_with_markdown from the full file index.
pub fn rebuild_dirs_from_index(files: &[IndexedFile], root: &Path) -> HashSet<PathBuf> {
    let mut dirs = HashSet::with_capacity(files.len());
    for file in files {
        register_ancestors(&mut dirs, &file.path, root);
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_by_workspace_matches_startup_open() {
        let app_state = AppState::new();
        let window_state = app_state.get_or_create("startup-window");
        window_state.set_startup_open(PendingOpenPayload {
            workspace: "/tmp/workspace".to_string(),
            file: None,
        });

        assert_eq!(
            app_state.find_by_workspace(Path::new("/tmp/workspace")),
            Some("startup-window".to_string())
        );
    }

    #[test]
    fn find_by_workspace_matches_pending_open() {
        let app_state = AppState::new();
        let window_state = app_state.get_or_create("pending-window");
        window_state.push_pending_open(PendingOpenPayload {
            workspace: "/tmp/workspace".to_string(),
            file: None,
        });

        assert_eq!(
            app_state.find_by_workspace(Path::new("/tmp/workspace")),
            Some("pending-window".to_string())
        );
    }

    #[test]
    fn pending_open_preserves_distinct_payloads_in_order() {
        let window_state = WorkspaceState::default();
        let first = PendingOpenPayload {
            workspace: "/tmp/workspace-a".to_string(),
            file: Some("/tmp/workspace-a/a.md".to_string()),
        };
        let second = PendingOpenPayload {
            workspace: "/tmp/workspace-b".to_string(),
            file: Some("/tmp/workspace-b/b.md".to_string()),
        };

        window_state.push_pending_open(first.clone());
        window_state.push_pending_open(second.clone());

        assert_eq!(window_state.pop_pending_open(), Some(first));
        assert_eq!(window_state.pop_pending_open(), Some(second));
        assert_eq!(window_state.pop_pending_open(), None);
    }

    #[test]
    fn pending_open_dedupes_repeated_tail_payload() {
        let window_state = WorkspaceState::default();
        let payload = PendingOpenPayload {
            workspace: "/tmp/workspace".to_string(),
            file: Some("/tmp/workspace/a.md".to_string()),
        };

        window_state.push_pending_open(payload.clone());
        window_state.push_pending_open(payload.clone());

        assert_eq!(window_state.pop_pending_open(), Some(payload));
        assert_eq!(window_state.pop_pending_open(), None);
    }

    #[test]
    fn startup_open_cannot_be_seeded_after_take() {
        let window_state = WorkspaceState::default();
        assert_eq!(window_state.take_startup_open(), None);

        let payload = PendingOpenPayload {
            workspace: "/tmp/workspace".to_string(),
            file: None,
        };

        assert_eq!(
            window_state.try_set_startup_open(payload.clone()),
            Err(payload)
        );
    }

    #[test]
    fn startup_open_try_seed_preserves_existing_payload() {
        let window_state = WorkspaceState::default();
        let first = PendingOpenPayload {
            workspace: "/tmp/workspace-a".to_string(),
            file: None,
        };
        let second = PendingOpenPayload {
            workspace: "/tmp/workspace-b".to_string(),
            file: None,
        };

        window_state.set_startup_open(first.clone());

        assert_eq!(
            window_state.try_set_startup_open(second.clone()),
            Err(second)
        );
        assert_eq!(window_state.take_startup_open(), Some(first));
    }
}
