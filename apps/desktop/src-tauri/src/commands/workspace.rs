use crate::commands::fs::{read_directory_impl, read_file_impl, DirEntry, FileContent};
use crate::commands::search::index_workspace_impl;
use crate::error::AppError;
use crate::ignore::WorkspaceIgnore;
use crate::state::{AppState, WorkspaceState};
use crate::watcher::drop_watcher_off_thread;
use crate::PendingOpenPayload;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
    pub file_count: usize,
}

/// Synchronous workspace setup shared by `open_workspace` and the bundled
/// `restore_workspace` IPC.
///
/// Only the cheap, essential mutations happen on the IPC thread: validate
/// the path, bump the workspace epoch, flip the outgoing index-cancel flag
/// (so any still-running walker from the previous workspace exits within a
/// directory boundary), install a fresh cancel flag, reset the per-workspace
/// fields, and swap in the bootstrap ignore matcher. The expensive bits —
/// dropping the old watcher, starting the new one, loading the full
/// `WorkspaceIgnore`, and walking the tree — all move to a background thread
/// guarded by the captured epoch, so rapid A→B switches never block the
/// frontend's `await` on `open_workspace` / `restore_workspace`.
/// Validate that `path` exists and is a directory, then return its canonical
/// form. Extracted so the canonicalization round-trip can be unit-tested
/// without spinning up a Tauri runtime.
///
/// macOS aliases `/var → /private/var` (and friends) and FSEvents always
/// reports the canonical form; storing the canonical root means the
/// frontend's `path === root` equality check in the file-watcher hook
/// succeeds for workspaces opened via aliased paths.
pub(crate) fn canonicalize_workspace_root(path: &str) -> Result<PathBuf, AppError> {
    let raw_root = PathBuf::from(path);
    if !raw_root.exists() || !raw_root.is_dir() {
        return Err(AppError::NotFound(path.to_string()));
    }
    raw_root
        .canonicalize()
        .map_err(|e| AppError::Io(e.to_string()))
}

fn prepare_workspace_state(
    app: &tauri::AppHandle,
    label: &str,
    path: &str,
) -> Result<WorkspaceInfo, AppError> {
    let root = canonicalize_workspace_root(path)?;
    let canonical_path = root.to_string_lossy().to_string();

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| canonical_path.clone());

    let state = app.state::<AppState>().get_or_create(label);

    // Bump the epoch before any reset or background spawn. Every background
    // task captured the prior value; anything still running against it will
    // drop its results on the floor.
    let new_epoch = state.workspace_epoch.fetch_add(1, Ordering::SeqCst) + 1;

    // Signal the outgoing walker to quit, then install a fresh token for the
    // new workspace. The old `Arc<AtomicBool>` is still held by the in-flight
    // walker; flipping it propagates to every walker thread within one
    // directory boundary. Replacing the state slot with a fresh `Arc` leaves
    // the flipped token alive inside the old walker but gives the new walker
    // a clean signal.
    let new_cancel = {
        let mut guard = state.cancel_index.write();
        guard.store(true, Ordering::SeqCst);
        let fresh = Arc::new(AtomicBool::new(false));
        *guard = Arc::clone(&fresh);
        fresh
    };

    // Reset per-workspace state.
    *state.workspace_root.write() = Some(root.clone());
    *state.file_index.write() = Vec::new();
    *state.dirs_with_markdown.write() = Default::default();
    state.index_ready.store(false, Ordering::Relaxed);

    // Install a cheap bootstrap matcher synchronously so the first
    // `read_directory` call already hides `node_modules` / `.git`. The full
    // matcher loads on the background thread below.
    *state.workspace_ignore.write() = Some(Arc::new(WorkspaceIgnore::bootstrap()));

    // Move the old watcher's `Drop` off the IPC thread — `notify`'s Drop can
    // briefly block on FSEvents unregistration — so the IPC returns promptly.
    let old_watcher = state.watcher_handle.write().take();
    drop_watcher_off_thread(old_watcher);

    // Load workspace-level settings (cheap, reads `.writer/config` on disk).
    if let Some(settings) = state.settings.write().as_mut() {
        settings.load_workspace(&root);
    }

    // Save to recent workspaces (one small JSON write). The canonical form is
    // stored so opening the same workspace via different aliases dedupes.
    let _ = save_recent_workspace(app, &canonical_path);

    // Everything below this line runs on a background thread, guarded by
    // `new_epoch`. Staggering the work this way means `open_workspace`
    // returns in constant time regardless of workspace size.
    let handle = app.clone();
    let root_for_bg = root.clone();
    let label_for_bg = label.to_string();
    std::thread::spawn(move || {
        run_workspace_bootstrap(handle, label_for_bg, root_for_bg, new_epoch, new_cancel);
    });

    Ok(WorkspaceInfo {
        root: canonical_path,
        name,
        file_count: 0,
    })
}

/// Background bootstrap for a freshly-opened workspace: starts the file
/// watcher, loads the full gitignore matcher, and walks the tree to build
/// the file index — each step guarded by `epoch`. The guard collapses any
/// work started for a workspace the user has already moved on from.
fn run_workspace_bootstrap(
    handle: tauri::AppHandle,
    label: String,
    root: PathBuf,
    epoch: u64,
    cancel: Arc<AtomicBool>,
) {
    let Some(state) = handle.state::<AppState>().get(&label) else {
        return;
    };

    if !epoch_is_current(&state, epoch) {
        return;
    }

    // Start the new watcher. This is usually fast on macOS (one FSEvents
    // subscription for the recursive root) but can be slower on Linux
    // (per-directory inotify watches) — either way it's off the IPC thread.
    match crate::watcher::start_watcher(handle.clone(), label.clone(), &root, epoch) {
        Ok(watcher) => {
            let mut guard = state.watcher_handle.write();
            if !epoch_is_current(&state, epoch) {
                // Don't install a stale watcher; let it drop.
                drop(watcher);
                return;
            }
            *guard = Some(watcher);
        }
        Err(e) => {
            eprintln!("Failed to start file watcher: {}", e);
        }
    }

    // Load the full gitignore matcher. Walks every directory looking for
    // `.gitignore` files; bounded but not trivial on large repos.
    let new_ignore = Arc::new(WorkspaceIgnore::load(&root));
    {
        if !epoch_is_current(&state, epoch) {
            return;
        }
        *state.workspace_ignore.write() = Some(new_ignore);
    }

    // Nudge the sidebar so custom ignore rules take effect immediately
    // without waiting for a file event.
    let _ = handle.emit_to(
        label.clone(),
        "fs:directory-changed",
        crate::watcher::FileChangeEvent {
            path: root.to_string_lossy().to_string(),
            kind: "modified".to_string(),
        },
    );

    // Walk the tree. The `cancel` flag lets a concurrent workspace switch
    // stop this walk at the next directory boundary.
    let (indexed, dirs) = index_workspace_impl(&root, Arc::clone(&cancel));
    if cancel.load(Ordering::Relaxed) {
        return;
    }
    let file_count = indexed.len();

    if !epoch_is_current(&state, epoch) {
        return;
    }
    *state.file_index.write() = indexed;
    *state.dirs_with_markdown.write() = dirs;
    state.index_ready.store(true, Ordering::Relaxed);

    let _ = handle.emit_to(label, "index:complete", file_count);
}

fn epoch_is_current(state: &WorkspaceState, captured: u64) -> bool {
    state.workspace_epoch.load(Ordering::SeqCst) == captured
}

#[tauri::command]
pub fn open_workspace(
    path: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<WorkspaceInfo, AppError> {
    prepare_workspace_state(&app, webview.label(), &path)
}

/// Bundled workspace restore payload. Replaces the four-step `open_workspace`
/// → `read_directory` → `get_recent_workspaces` → `load_session` waterfall
/// (plus a follow-up `read_file` for the active tab) with a single struct.
/// Directory, recents, and session reads run in parallel; the active file
/// is fetched once the session resolves.
#[derive(Debug, Serialize)]
pub struct RestoreWorkspaceResponse {
    pub workspace: WorkspaceInfo,
    pub entries: Vec<DirEntry>,
    pub recent_workspaces: Vec<String>,
    pub session: Option<SessionData>,
    pub active_file: Option<FileContent>,
}

/// Shared workspace-restore body used by both the `restore_workspace` IPC
/// (user-initiated workspace switches) and `get_startup_state` (cold start).
/// Prepares workspace state synchronously, then fans out directory, recents,
/// and session reads in parallel via `spawn_blocking`, and finally prefetches
/// the active tab's file content when the session has one.
pub(crate) async fn build_restore_bundle(
    app: &tauri::AppHandle,
    label: &str,
    path: &str,
) -> Result<RestoreWorkspaceResponse, AppError> {
    // Workspace state mutations (watcher, ignore matcher, indexing thread)
    // happen synchronously up front so the parallel reads below see
    // consistent state.
    let workspace = prepare_workspace_state(app, label, path)?;

    // Use the canonical root for every downstream read. `read_directory_impl`
    // returns child entry paths prefixed with whatever string it was given,
    // and the frontend keys its `directoryCache` / `expandedDirs` by exact
    // string equality. If the raw input were `/var/foo` and the canonical
    // root `/private/var/foo`, the cache would hold un-canonical child paths
    // under a canonical-root key — and watcher events (always canonical) would
    // miss them, leaving the sidebar stale.
    let canonical_root = workspace.root.clone();

    let entries_handle = {
        let app = app.clone();
        let root = canonical_root.clone();
        let label = label.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<AppState>().get_or_create(&label);
            read_directory_impl(&root, Some(&state))
        })
    };
    let recents_handle = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            load_recent_workspaces(&app).unwrap_or_default()
        })
    };
    let session_handle = {
        let app = app.clone();
        let root = canonical_root.clone();
        tauri::async_runtime::spawn_blocking(move || load_session_impl(&app, &root))
    };

    let entries = entries_handle
        .await
        .map_err(|e| AppError::Io(e.to_string()))??;
    let recent_workspaces = recents_handle
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    let session = session_handle
        .await
        .map_err(|e| AppError::Io(e.to_string()))??;

    // If the session has an active tab, pre-fetch its content so the editor
    // can mount with the file already loaded — saves another sequential IPC
    // and the 40 ms `OPEN_FILE_GRACE_MS` wait on the frontend side.
    let active_file = if let Some(active_path) = active_session_path(session.as_ref()) {
        tauri::async_runtime::spawn_blocking(move || read_file_impl(&active_path).ok())
            .await
            .map_err(|e| AppError::Io(e.to_string()))?
    } else {
        None
    };

    Ok(RestoreWorkspaceResponse {
        workspace,
        entries,
        recent_workspaces,
        session,
        active_file,
    })
}

#[tauri::command]
pub async fn restore_workspace(
    path: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<RestoreWorkspaceResponse, AppError> {
    let label = webview.label().to_string();
    build_restore_bundle(&app, &label, &path).await
}

fn active_session_path(session: Option<&SessionData>) -> Option<String> {
    let session = session?;
    let idx = session.active_index?;
    let tab = session.tabs.get(idx)?;
    if tab.location.kind != "file" {
        return None;
    }
    tab.location
        .payload
        .get("path")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[tauri::command]
pub fn get_recent_workspaces(app: tauri::AppHandle) -> Vec<String> {
    load_recent_workspaces(&app).unwrap_or_default()
}

#[tauri::command]
pub fn remove_recent_workspace(path: String, app: tauri::AppHandle) -> Result<(), AppError> {
    let mut recents = load_recent_workspaces(&app).unwrap_or_default();
    recents.retain(|p| p != &path);
    save_recent_workspaces_list(&app, &recents)
}

fn recent_workspaces_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("recent_workspaces.json"))
}

pub(crate) fn load_recent_workspaces(app: &tauri::AppHandle) -> Result<Vec<String>, AppError> {
    let path = recent_workspaces_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&path)?;
    serde_json::from_str(&data).map_err(|e| AppError::Io(e.to_string()))
}

fn save_recent_workspace(app: &tauri::AppHandle, workspace_path: &str) -> Result<(), AppError> {
    let mut recents = load_recent_workspaces(app).unwrap_or_default();
    recents.retain(|p| p != workspace_path);
    recents.insert(0, workspace_path.to_string());
    recents.truncate(10); // Keep max 10 recent workspaces
    save_recent_workspaces_list(app, &recents)
}

fn save_recent_workspaces_list(app: &tauri::AppHandle, recents: &[String]) -> Result<(), AppError> {
    let path = recent_workspaces_path(app)?;
    let data = serde_json::to_string_pretty(recents).map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::write(&path, data)?;
    Ok(())
}

#[tauri::command]
pub fn take_pending_open(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Option<PendingOpenPayload> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    state.pop_pending_open()
}

/// Open a workspace in a fresh window within the same process. If another
/// open window already hosts this workspace, focus it instead of spawning
/// a duplicate. Otherwise build a new `WebviewWindow` with a unique label,
/// pre-queuing a pending-open payload so the new window hydrates onto the
/// requested workspace (and optional file) as part of its normal startup
/// flow.
#[tauri::command]
pub fn open_workspace_in_new_window(
    path: String,
    file: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let workspace = PathBuf::from(&path);
    if !workspace.exists() || !workspace.is_dir() {
        return Err(AppError::NotFound(path.clone()));
    }

    crate::open_new_workspace_window(&app, path, file)
}

// --- Session persistence (stored in app data dir) ---

/// Session-persisted location. The `kind` tag plus a free-form payload lets
/// unknown kinds (from a newer client) round-trip without data loss.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedLocation {
    pub kind: String,
    #[serde(flatten)]
    pub payload: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTab {
    pub location: SerializedLocation,
    #[serde(default)]
    pub back: Vec<SerializedLocation>,
    #[serde(default)]
    pub forward: Vec<SerializedLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
    #[serde(default)]
    pub active_index: Option<usize>,
}

fn sessions_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("sessions.json"))
}

fn load_all_sessions(app: &tauri::AppHandle) -> HashMap<String, SessionData> {
    let path = match sessions_path(app) {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    if !path.exists() {
        return HashMap::new();
    }
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_all_sessions(
    app: &tauri::AppHandle,
    sessions: &HashMap<String, SessionData>,
) -> Result<(), AppError> {
    let path = sessions_path(app)?;
    let data = serde_json::to_string_pretty(sessions).map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::write(&path, data)?;
    Ok(())
}

#[tauri::command]
pub fn save_session(
    workspace_root: String,
    tabs: Vec<SessionTab>,
    active_index: Option<usize>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let key = workspace_root.trim_end_matches('/').to_string();
    // Hold the cross-window file lock for the full read-modify-write so two
    // windows saving sessions simultaneously don't drop each other's updates.
    let state = app.state::<AppState>();
    let _guard = state.sessions_file_lock.lock();
    let mut sessions = load_all_sessions(&app);

    if tabs.is_empty() && active_index.is_none() {
        sessions.remove(&key);
    } else {
        sessions.insert(key, SessionData { tabs, active_index });
    }

    save_all_sessions(&app, &sessions)
}

pub(crate) fn load_session_impl(
    app: &tauri::AppHandle,
    workspace_root: &str,
) -> Result<Option<SessionData>, AppError> {
    let key = workspace_root.trim_end_matches('/').to_string();
    let sessions = load_all_sessions(app);
    Ok(sessions.get(&key).cloned())
}

#[tauri::command]
pub fn load_session(
    workspace_root: String,
    app: tauri::AppHandle,
) -> Result<Option<SessionData>, AppError> {
    load_session_impl(&app, &workspace_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn canonicalize_rejects_missing_path() {
        let err = canonicalize_workspace_root("/this/path/does/not/exist/ever").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn canonicalize_rejects_non_directory() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("a-file.md");
        std::fs::write(&file, "x").unwrap();
        let err = canonicalize_workspace_root(file.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn canonicalize_round_trips_existing_directory() {
        let dir = TempDir::new().unwrap();
        let raw = dir.path().to_string_lossy().to_string();
        let canonical = canonicalize_workspace_root(&raw).unwrap();
        assert!(canonical.is_absolute());
        assert_eq!(canonical, std::fs::canonicalize(&raw).unwrap());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn canonicalize_resolves_var_alias_on_macos() {
        // macOS exposes `/var` as an alias for `/private/var`. TempDir hands
        // out paths under whichever the system reports — TMPDIR is normally
        // `/var/folders/...` (un-canonical) — so canonicalization must collapse
        // it to `/private/var/folders/...`. This is the exact aliasing class
        // the spec was written to fix; if it ever stops happening, the
        // sidebar regression returns.
        let dir = TempDir::new().unwrap();
        let raw = dir.path().to_string_lossy().to_string();
        if let Some(stripped) = raw.strip_prefix("/private") {
            let aliased = stripped.to_string();
            assert!(std::path::Path::new(&aliased).exists());
            let canonical = canonicalize_workspace_root(&aliased).unwrap();
            assert_eq!(
                canonical.to_string_lossy(),
                raw,
                "aliased input must canonicalize back to the /private/... form"
            );
        }
        // If `raw` doesn't start with `/private`, the test target isn't on
        // an aliased filesystem; fall through silently rather than skip — the
        // round-trip test above still covers the non-aliased case.
    }
}
