use crate::commands::fs::{read_directory_impl, read_file_impl, DirEntry, FileContent};
use crate::commands::search::index_workspace_impl;
use crate::commands::settings::get_global_string_setting;
use crate::error::AppError;
use crate::ignore::WorkspaceIgnore;
use crate::state::{AppState, WorkspaceRuntimeDrop, WorkspaceState};
use crate::watcher::drop_watcher_off_thread;
use crate::PendingOpenPayload;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
    pub file_count: usize,
    pub epoch: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexCompleteEvent {
    workspace: crate::watcher::WorkspaceIdentity,
    file_count: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LaunchPlatform {
    MacOs,
    Windows,
    Linux,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct TerminalLaunchSpec {
    program: String,
    args: Vec<String>,
    current_dir: PathBuf,
    new_console: bool,
    execution: TerminalExecution,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TerminalExecution {
    Detached,
    WaitForSuccess,
}

const DEFAULT_TERMINAL_SETTING_KEY: &str = "workspace.default-terminal";

fn drop_workspace_runtime_off_thread(runtime: WorkspaceRuntimeDrop) {
    std::thread::spawn(move || drop(runtime));
}

fn terminal_launch_specs(
    platform: LaunchPlatform,
    target_dir: &Path,
    preferred_terminal: Option<&str>,
    terminal_env: Option<&str>,
) -> Vec<TerminalLaunchSpec> {
    let spec = |program: &str,
                args: Vec<String>,
                new_console: bool,
                execution: TerminalExecution| TerminalLaunchSpec {
        program: program.to_string(),
        args,
        current_dir: target_dir.to_path_buf(),
        new_console,
        execution,
    };

    match (platform, preferred_terminal) {
        (LaunchPlatform::MacOs, Some(program)) => vec![spec(
            "open",
            vec![
                "-a".into(),
                program.into(),
                target_dir.to_string_lossy().into_owned(),
            ],
            false,
            TerminalExecution::WaitForSuccess,
        )],
        (LaunchPlatform::MacOs, None) => vec![spec(
            "open",
            vec![
                "-a".into(),
                "Terminal".into(),
                target_dir.to_string_lossy().into_owned(),
            ],
            false,
            TerminalExecution::WaitForSuccess,
        )],
        (LaunchPlatform::Windows, Some(program)) => {
            vec![spec(program, Vec::new(), true, TerminalExecution::Detached)]
        }
        (LaunchPlatform::Windows, None) => vec![spec(
            "cmd.exe",
            vec!["/K".into()],
            true,
            TerminalExecution::Detached,
        )],
        (LaunchPlatform::Linux, Some(program)) => vec![spec(
            program,
            Vec::new(),
            false,
            TerminalExecution::Detached,
        )],
        (LaunchPlatform::Linux, None) => {
            let mut programs = Vec::new();
            if let Some(program) = terminal_env
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                programs.push(program.to_string());
            }
            for fallback in [
                "x-terminal-emulator",
                "ghostty",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
            ] {
                if !programs.iter().any(|program| program == fallback) {
                    programs.push(fallback.to_string());
                }
            }
            programs
                .into_iter()
                .map(|program| spec(&program, Vec::new(), false, TerminalExecution::Detached))
                .collect()
        }
    }
}

fn current_launch_platform() -> LaunchPlatform {
    match std::env::consts::OS {
        "macos" => LaunchPlatform::MacOs,
        "windows" => LaunchPlatform::Windows,
        _ => LaunchPlatform::Linux,
    }
}

fn validate_workspace_launch_root(path: &Path) -> Result<PathBuf, AppError> {
    if !path.is_dir() {
        return Err(AppError::NotFound(path.to_string_lossy().to_string()));
    }
    path.canonicalize()
        .map_err(|error| AppError::Io(error.to_string()))
}

fn validate_terminal_target(
    captured_root: &Path,
    requested_path: Option<&Path>,
) -> Result<PathBuf, AppError> {
    let canonical_root = validate_workspace_launch_root(captured_root)?;
    if canonical_root != captured_root {
        return Err(AppError::InvalidPath(
            captured_root.to_string_lossy().into_owned(),
        ));
    }

    let requested_path = requested_path.unwrap_or(captured_root);
    let target = validate_workspace_launch_root(requested_path)?;
    if target != canonical_root && !target.starts_with(&canonical_root) {
        return Err(AppError::InvalidPath(
            requested_path.to_string_lossy().into_owned(),
        ));
    }
    Ok(target)
}

#[cfg(test)]
fn validate_terminal_launch_snapshot(
    state: &WorkspaceState,
    captured_root: &Path,
    captured_epoch: u64,
) -> Result<(), AppError> {
    let root_is_current = state.workspace_root.read().as_deref() == Some(captured_root);
    if !root_is_current || !epoch_is_current(state, captured_epoch) {
        return Err(AppError::InvalidPath(
            "Workspace changed before the terminal could be opened".into(),
        ));
    }

    let live_root = validate_workspace_launch_root(captured_root)?;
    if live_root != captured_root {
        return Err(AppError::InvalidPath(
            "Workspace folder changed before the terminal could be opened".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
fn validate_terminal_launch_boundary(
    state: &WorkspaceState,
    captured_root: &Path,
    captured_epoch: u64,
    requested_path: Option<&Path>,
    captured_target: &Path,
) -> Result<(), AppError> {
    with_terminal_launch_snapshot(
        state,
        captured_root,
        captured_epoch,
        requested_path,
        captured_target,
        || Ok(()),
    )
}

fn with_terminal_launch_snapshot<T>(
    state: &WorkspaceState,
    captured_root: &Path,
    captured_epoch: u64,
    requested_path: Option<&Path>,
    captured_target: &Path,
    launch: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    state
        .with_workspace_snapshot(captured_root, captured_epoch, || {
            let live_target = validate_terminal_target(captured_root, requested_path)?;
            if live_target != captured_target {
                return Err(AppError::InvalidPath(
                    "Selected folder changed before the terminal could be opened".into(),
                ));
            }
            launch()
        })
        .ok_or_else(|| {
            AppError::InvalidPath("Workspace changed before the terminal could be opened".into())
        })?
}

fn open_workspace_in_file_manager_for_snapshot<T>(
    state: &WorkspaceState,
    captured_root: &Path,
    captured_epoch: u64,
    open: impl FnOnce(&Path) -> Result<T, AppError>,
) -> Result<T, AppError> {
    state
        .with_workspace_snapshot(captured_root, captured_epoch, || {
            let live_root = validate_workspace_launch_root(captured_root)?;
            if live_root != captured_root {
                return Err(AppError::InvalidPath(
                    "Workspace folder changed before it could be opened".into(),
                ));
            }
            open(&live_root)
        })
        .ok_or_else(|| {
            AppError::InvalidPath("Workspace changed before it could be opened".into())
        })?
}

fn terminal_launch_error(preferred_terminal: Option<&str>, reason: &str) -> AppError {
    if let Some(preferred_terminal) = preferred_terminal {
        AppError::Io(format!(
            "Could not launch configured terminal {preferred_terminal:?}: {reason}. Clear or reset Default Terminal in Preferences."
        ))
    } else {
        AppError::Io(reason.to_string())
    }
}

fn launch_terminal(
    target_dir: &Path,
    preferred_terminal: &str,
    mut spawn_command: impl FnMut(&mut Command) -> Result<Result<Child, String>, AppError>,
) -> Result<(), AppError> {
    let preferred_terminal = (!preferred_terminal.is_empty()).then_some(preferred_terminal);
    let terminal_env = std::env::var("TERMINAL").ok();
    let specs = terminal_launch_specs(
        current_launch_platform(),
        target_dir,
        preferred_terminal,
        terminal_env.as_deref(),
    );
    let mut last_error = None;

    for launch in specs {
        let mut command = Command::new(&launch.program);
        command.args(&launch.args).current_dir(&launch.current_dir);

        #[cfg(target_os = "windows")]
        if launch.new_console {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            command.creation_flags(CREATE_NEW_CONSOLE);
        }
        #[cfg(not(target_os = "windows"))]
        let _ = launch.new_console;

        match launch.execution {
            TerminalExecution::Detached => match spawn_command(&mut command) {
                Ok(Ok(_)) => return Ok(()),
                Ok(Err(error)) => last_error = Some(error),
                Err(error) => return Err(error),
            },
            TerminalExecution::WaitForSuccess => {
                command.stdout(Stdio::piped()).stderr(Stdio::piped());
                let output = match spawn_command(&mut command) {
                    Ok(Ok(child)) => child.wait_with_output(),
                    Ok(Err(error)) => {
                        last_error = Some(error);
                        continue;
                    }
                    Err(error) => return Err(error),
                };
                match output {
                    Ok(output) if output.status.success() => return Ok(()),
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        let stderr = stderr.trim();
                        last_error = Some(if stderr.is_empty() {
                            format!("{} exited with {}", launch.program, output.status)
                        } else {
                            stderr.to_string()
                        });
                    }
                    Err(error) => last_error = Some(error.to_string()),
                }
            }
        }
    }

    Err(terminal_launch_error(
        preferred_terminal,
        last_error
            .as_deref()
            .unwrap_or("No terminal launcher is available"),
    ))
}

#[tauri::command]
pub async fn open_workspace_in_file_manager(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let (root, epoch) = state.workspace_snapshot().ok_or(AppError::NoWorkspace)?;
    tauri::async_runtime::spawn_blocking(move || {
        open_workspace_in_file_manager_for_snapshot(&state, &root, epoch, |live_root| {
            app.opener()
                .open_path(live_root.to_string_lossy().into_owned(), None::<String>)
                .map_err(|error| AppError::Io(error.to_string()))
        })
    })
    .await
    .map_err(|error| AppError::Io(error.to_string()))?
}

#[tauri::command]
pub fn close_workspace(
    root: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let expected_root = PathBuf::from(&root);
    let runtime = state
        .clear_workspace_if_current(&expected_root)
        .map_err(|()| {
            AppError::InvalidPath("Workspace changed before it could be closed".into())
        })?;
    drop_workspace_runtime_off_thread(runtime);
    Ok(())
}

#[tauri::command]
pub async fn open_workspace_in_terminal(
    path: Option<String>,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let (root, epoch) = state.workspace_snapshot().ok_or(AppError::NoWorkspace)?;
    let preferred_terminal =
        get_global_string_setting(&app, webview.label(), DEFAULT_TERMINAL_SETTING_KEY)?;
    tauri::async_runtime::spawn_blocking(move || {
        let requested_path = path.as_deref().map(Path::new);
        let target = validate_terminal_target(&root, requested_path)?;
        launch_terminal(&target, &preferred_terminal, |command| {
            with_terminal_launch_snapshot(&state, &root, epoch, requested_path, &target, || {
                Ok(command.spawn().map_err(|error| error.to_string()))
            })
        })
    })
    .await
    .map_err(|error| AppError::Io(error.to_string()))?
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

    let (new_epoch, new_cancel, old_runtime) = state.transition_to_workspace(root.clone());
    drop_workspace_runtime_off_thread(old_runtime);

    // Save to recent workspaces (one small JSON write). The canonical form is
    // stored so opening the same workspace via different aliases dedupes.
    let _ = save_recent_workspace(app, &canonical_path);

    // Shared by the `open_workspace` IPC and the startup restore bundle, so a
    // session restore counts as an open. No path or name is sent.
    crate::telemetry::track("workspace_opened");

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
        epoch: new_epoch,
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
            let mut watcher = Some(watcher);
            if state
                .with_workspace_snapshot(&root, epoch, || {
                    *state.watcher_handle.write() = watcher.take();
                })
                .is_none()
            {
                return;
            }
        }
        Err(e) => {
            eprintln!("Failed to start file watcher: {}", e);
        }
    }

    // Load the full gitignore matcher. Walks every directory looking for
    // `.gitignore` files; bounded but not trivial on large repos.
    let new_ignore = Arc::new(WorkspaceIgnore::load(&root));
    if state
        .with_workspace_snapshot(&root, epoch, || {
            *state.workspace_ignore.write() = Some(new_ignore);
        })
        .is_none()
    {
        return;
    }
    let root_string = root.to_string_lossy().into_owned();
    let _ = handle.emit_to(
        label.clone(),
        "fs:directory-changed",
        crate::watcher::FileChangeEvent {
            path: root_string.clone(),
            kind: "modified".to_string(),
            workspace: Some(crate::watcher::WorkspaceIdentity {
                root: root_string.clone(),
                epoch,
            }),
        },
    );

    // Walk the tree. The `cancel` flag lets a concurrent workspace switch
    // stop this walk at the next directory boundary.
    let (indexed, dirs) = index_workspace_impl(&root, Arc::clone(&cancel));
    if cancel.load(Ordering::Relaxed) {
        return;
    }
    let file_count = indexed.len();

    let displaced = state.with_workspace_snapshot(&root, epoch, || {
        let old_index = std::mem::replace(&mut *state.file_index.write(), indexed);
        let old_cache = state.recent_files_cache.write().take();
        let old_dirs = std::mem::replace(&mut *state.dirs_with_markdown.write(), dirs);
        state.file_index_revision.fetch_add(1, Ordering::SeqCst);
        state.index_ready.store(true, Ordering::Relaxed);
        (old_index, old_cache, old_dirs)
    });
    let Some(displaced) = displaced else {
        return;
    };
    drop(displaced);
    let _ = handle.emit_to(
        label,
        "index:complete",
        IndexCompleteEvent {
            workspace: crate::watcher::WorkspaceIdentity {
                root: root_string,
                epoch,
            },
            file_count,
        },
    );
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
    pub open_file: Option<String>,
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
        open_file: None,
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

/// Open a single markdown file in a standalone compact window (no
/// workspace). Focuses the existing window when one already hosts the file.
#[tauri::command]
pub fn open_file_in_standalone_window(path: String, app: tauri::AppHandle) -> Result<(), AppError> {
    crate::open_standalone_file_window(&app, path)
}

/// Point this window's watcher at a single standalone file. Bumps the
/// workspace epoch so any previous watcher (workspace or file) goes stale,
/// drops it off-thread, and installs the lightweight parent-dir watcher.
/// Shared by the standalone startup path and the compact picker's file
/// switches.
pub(crate) fn watch_standalone_file_impl(
    app: &tauri::AppHandle,
    label: &str,
    path: &str,
) -> Result<(), AppError> {
    let raw = PathBuf::from(path);
    if !raw.is_file() {
        return Err(AppError::NotFound(path.to_string()));
    }
    let file = raw
        .canonicalize()
        .map_err(|e| AppError::Io(e.to_string()))?;

    let state = app.state::<AppState>().get_or_create(label);
    let epoch = state.workspace_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    *state.standalone_file.write() = Some(file.clone());

    let old_watcher = state.watcher_handle.write().take();
    drop_watcher_off_thread(old_watcher);

    let watcher = crate::watcher::start_file_watcher(app.clone(), label.to_string(), &file, epoch)
        .map_err(|e| AppError::Io(e.to_string()))?;

    let mut guard = state.watcher_handle.write();
    if epoch_is_current(&state, epoch) {
        *guard = Some(watcher);
    }
    Ok(())
}

#[tauri::command]
pub fn watch_standalone_file(
    path: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    watch_standalone_file_impl(&app, webview.label(), &path)
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

    #[test]
    fn terminal_launch_specs_cover_defaults_and_explicit_preferences_exactly() {
        let root = Path::new("/workspace with spaces");

        let mac = terminal_launch_specs(LaunchPlatform::MacOs, root, None, None);
        assert_eq!(mac.len(), 1);
        assert_eq!(mac[0].program, "open");
        assert_eq!(mac[0].args, ["-a", "Terminal", "/workspace with spaces"]);
        assert_eq!(mac[0].current_dir, root);
        assert!(!mac[0].new_console);
        assert_eq!(mac[0].execution, TerminalExecution::WaitForSuccess);

        let custom_mac = terminal_launch_specs(LaunchPlatform::MacOs, root, Some("iTerm"), None);
        assert_eq!(custom_mac.len(), 1);
        assert_eq!(custom_mac[0].program, "open");
        assert_eq!(
            custom_mac[0].args,
            ["-a", "iTerm", "/workspace with spaces"]
        );
        assert_eq!(custom_mac[0].execution, TerminalExecution::WaitForSuccess);

        let windows = terminal_launch_specs(LaunchPlatform::Windows, root, None, None);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].program, "cmd.exe");
        assert_eq!(windows[0].args, ["/K"]);
        assert_eq!(windows[0].current_dir, root);
        assert!(windows[0].new_console);
        assert_eq!(windows[0].execution, TerminalExecution::Detached);

        let custom_windows = terminal_launch_specs(
            LaunchPlatform::Windows,
            root,
            Some("C:\\Apps\\wt.exe"),
            None,
        );
        assert_eq!(custom_windows.len(), 1);
        assert_eq!(custom_windows[0].program, "C:\\Apps\\wt.exe");
        assert!(custom_windows[0].args.is_empty());
        assert_eq!(custom_windows[0].current_dir, root);
        assert!(custom_windows[0].new_console);
        assert_eq!(custom_windows[0].execution, TerminalExecution::Detached);

        let linux = terminal_launch_specs(LaunchPlatform::Linux, root, None, Some(" ghostty "));
        assert_eq!(
            linux
                .iter()
                .map(|spec| spec.program.as_str())
                .collect::<Vec<_>>(),
            [
                "ghostty",
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal"
            ]
        );
        assert!(linux.iter().all(|spec| spec.args.is_empty()));
        assert!(linux.iter().all(|spec| spec.current_dir == root));
        assert!(linux.iter().all(|spec| !spec.new_console));
        assert!(linux
            .iter()
            .all(|spec| spec.execution == TerminalExecution::Detached));

        let linux_without_env = terminal_launch_specs(LaunchPlatform::Linux, root, None, None);
        assert_eq!(
            linux_without_env
                .iter()
                .map(|spec| spec.program.as_str())
                .collect::<Vec<_>>(),
            [
                "x-terminal-emulator",
                "ghostty",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal"
            ]
        );

        let opaque = "ghostty --execute 'not a flag'";
        let custom_linux =
            terminal_launch_specs(LaunchPlatform::Linux, root, Some(opaque), Some("other"));
        assert_eq!(custom_linux.len(), 1);
        assert_eq!(custom_linux[0].program, opaque);
        assert!(custom_linux[0].args.is_empty());
    }

    #[test]
    fn custom_terminal_errors_identify_the_preference_and_recovery() {
        let error =
            terminal_launch_error(Some("Missing Terminal"), "application could not be found");
        let message = error.to_string();
        assert!(message.contains("Missing Terminal"));
        assert!(message.contains("Default Terminal"));
        assert!(message.contains("Preferences"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_invalid_terminal_app_surfaces_the_open_helper_failure() {
        let dir = TempDir::new().unwrap();
        let preference = "Writer Definitely Missing Terminal 8B112EE0";
        let error = launch_terminal(dir.path(), preference, |command| {
            Ok(command.spawn().map_err(|error| error.to_string()))
        })
        .unwrap_err();
        let message = error.to_string();

        assert!(message.contains(preference));
        assert!(message.contains("Default Terminal"));
        assert!(message.contains("Preferences"));
    }

    #[test]
    fn launch_root_validation_rejects_files_and_missing_paths() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("note.md");
        std::fs::write(&file, "# Note").unwrap();

        assert!(matches!(
            validate_workspace_launch_root(&file).unwrap_err(),
            AppError::NotFound(_)
        ));
        assert!(matches!(
            validate_workspace_launch_root(&dir.path().join("missing")).unwrap_err(),
            AppError::NotFound(_)
        ));
    }

    #[test]
    fn terminal_target_validation_accepts_root_and_nested_directories() {
        let workspace = TempDir::new().unwrap();
        let nested = workspace.path().join("drafts").join("chapter one");
        std::fs::create_dir_all(&nested).unwrap();
        let root = workspace.path().canonicalize().unwrap();

        assert_eq!(validate_terminal_target(&root, None).unwrap(), root);
        assert_eq!(
            validate_terminal_target(&root, Some(&nested)).unwrap(),
            nested.canonicalize().unwrap()
        );
    }

    #[test]
    fn terminal_target_validation_rejects_files_missing_paths_and_siblings() {
        let workspace = TempDir::new().unwrap();
        let sibling = TempDir::new().unwrap();
        let file = workspace.path().join("note.md");
        std::fs::write(&file, "# Note").unwrap();
        let root = workspace.path().canonicalize().unwrap();

        assert!(matches!(
            validate_terminal_target(&root, Some(&file)).unwrap_err(),
            AppError::NotFound(_)
        ));
        assert!(matches!(
            validate_terminal_target(&root, Some(&workspace.path().join("missing"))).unwrap_err(),
            AppError::NotFound(_)
        ));
        assert!(matches!(
            validate_terminal_target(&root, Some(sibling.path())).unwrap_err(),
            AppError::InvalidPath(_)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn terminal_target_validation_accepts_internal_symlinks_and_rejects_external_ones() {
        use std::os::unix::fs::symlink;

        let workspace = TempDir::new().unwrap();
        let nested = workspace.path().join("nested");
        std::fs::create_dir(&nested).unwrap();
        let internal_link = workspace.path().join("internal-link");
        symlink(&nested, &internal_link).unwrap();

        let outside = TempDir::new().unwrap();
        let external_link = workspace.path().join("external-link");
        symlink(outside.path(), &external_link).unwrap();
        let root = workspace.path().canonicalize().unwrap();

        assert_eq!(
            validate_terminal_target(&root, Some(&internal_link)).unwrap(),
            nested.canonicalize().unwrap()
        );
        assert!(matches!(
            validate_terminal_target(&root, Some(&external_link)).unwrap_err(),
            AppError::InvalidPath(_)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn terminal_target_validation_rejects_a_replaced_workspace_root() {
        use std::os::unix::fs::symlink;

        let parent = TempDir::new().unwrap();
        let root_path = parent.path().join("workspace");
        std::fs::create_dir(&root_path).unwrap();
        let captured_root = root_path.canonicalize().unwrap();
        std::fs::rename(&root_path, parent.path().join("moved-workspace")).unwrap();
        let outside = TempDir::new().unwrap();
        symlink(outside.path(), &root_path).unwrap();

        assert!(matches!(
            validate_terminal_target(&captured_root, None).unwrap_err(),
            AppError::InvalidPath(_)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn terminal_launch_boundary_rejects_delayed_target_and_root_replacement() {
        use std::os::unix::fs::symlink;

        let parent = TempDir::new().unwrap();
        let root_path = parent.path().join("workspace");
        let selected_path = root_path.join("drafts");
        std::fs::create_dir_all(&selected_path).unwrap();
        let root = root_path.canonicalize().unwrap();
        let target = validate_terminal_target(&root, Some(&selected_path)).unwrap();
        let state = WorkspaceState::default();
        let epoch = state.replace_workspace_root(root.clone());

        let outside = TempDir::new().unwrap();
        std::fs::rename(&selected_path, root_path.join("moved-drafts")).unwrap();
        symlink(outside.path(), &selected_path).unwrap();
        assert!(matches!(
            validate_terminal_launch_boundary(&state, &root, epoch, Some(&selected_path), &target,)
                .unwrap_err(),
            AppError::InvalidPath(_)
        ));

        std::fs::remove_file(&selected_path).unwrap();
        let root_target = validate_terminal_target(&root, None).unwrap();
        std::fs::rename(&root_path, parent.path().join("moved-workspace")).unwrap();
        symlink(outside.path(), &root_path).unwrap();
        assert!(matches!(
            validate_terminal_launch_boundary(&state, &root, epoch, None, &root_target)
                .unwrap_err(),
            AppError::InvalidPath(_)
        ));
    }

    #[test]
    fn terminal_launch_snapshot_rejects_workspace_switches_and_epoch_aba() {
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        let first_root = first.path().canonicalize().unwrap();
        let second_root = second.path().canonicalize().unwrap();
        let state = WorkspaceState::default();
        let first_epoch = state.replace_workspace_root(first_root.clone());
        let (snapshotted_root, snapshotted_epoch) = state.workspace_snapshot().unwrap();
        assert_eq!(
            (snapshotted_root, snapshotted_epoch),
            (first_root.clone(), first_epoch)
        );

        validate_terminal_launch_snapshot(&state, &first_root, first_epoch).unwrap();

        state.replace_workspace_root(second_root);
        assert!(matches!(
            validate_terminal_launch_snapshot(&state, &first_root, first_epoch).unwrap_err(),
            AppError::InvalidPath(_)
        ));

        state.replace_workspace_root(first_root.clone());
        assert!(matches!(
            validate_terminal_launch_snapshot(&state, &first_root, first_epoch).unwrap_err(),
            AppError::InvalidPath(_)
        ));
    }

    #[test]
    fn guarded_launch_helpers_reject_stale_callbacks_and_hold_the_workspace_read_guard() {
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        let first_root = first.path().canonicalize().unwrap();
        let state = WorkspaceState::default();
        let epoch = state.replace_workspace_root(first_root.clone());

        let terminal_ran = std::cell::Cell::new(false);
        with_terminal_launch_snapshot(&state, &first_root, epoch, None, &first_root, || {
            terminal_ran.set(true);
            assert!(state.workspace_root.try_write().is_none());
            Ok(())
        })
        .unwrap();
        assert!(terminal_ran.get());

        state.replace_workspace_root(second.path().canonicalize().unwrap());
        terminal_ran.set(false);
        assert!(matches!(
            with_terminal_launch_snapshot(&state, &first_root, epoch, None, &first_root, || {
                terminal_ran.set(true);
                Ok(())
            },)
            .unwrap_err(),
            AppError::InvalidPath(_)
        ));
        assert!(!terminal_ran.get());

        let file_manager_ran = std::cell::Cell::new(false);
        assert!(matches!(
            open_workspace_in_file_manager_for_snapshot(&state, &first_root, epoch, |_| {
                file_manager_ran.set(true);
                Ok(())
            })
            .unwrap_err(),
            AppError::InvalidPath(_)
        ));
        assert!(!file_manager_ran.get());
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
