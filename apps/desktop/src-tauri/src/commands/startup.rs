use crate::commands::settings::config_value_to_json;
use crate::commands::workspace::{
    build_restore_bundle, load_recent_workspaces, RestoreBundleMode, RestoreWorkspaceResponse,
};
use crate::error::AppError;
use crate::state::AppState;
use crate::PendingOpenPayload;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use tauri::Manager;

const RESTORE_WORKSPACE_KEY: &str = "window.restore-workspace";

#[derive(Debug, Serialize)]
pub struct StartupState {
    pub settings: Value,
    pub recent_workspaces: Vec<String>,
    pub pending_open: Option<PendingOpenPayload>,
    /// Prefetched workspace restore payload. Populated when there is a
    /// `pending_open` (CLI / drag-drop cold start — bundle is built in
    /// target-only mode for that workspace and optional file) or, failing
    /// that, when `window.restore-workspace` is enabled and the most-recent
    /// recent workspace still exists on disk. When present, the frontend
    /// hydrates its stores synchronously from this bundle so React's first
    /// render already has full content — no second IPC waterfall, no
    /// intermediate "empty shell" frame.
    pub restore_bundle: Option<RestoreWorkspaceResponse>,
}

#[tauri::command]
pub async fn get_startup_state(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<StartupState, AppError> {
    let label = webview.label().to_string();
    let state = app.state::<AppState>().get_or_create(&label);

    let (settings, restore_enabled) = {
        let guard = state.settings.read();
        match guard.as_ref() {
            Some(s) => {
                let merged = s.merged();
                let restore_enabled = merged
                    .get(RESTORE_WORKSPACE_KEY)
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let mut obj = serde_json::Map::new();
                for (k, v) in &merged {
                    obj.insert(k.clone(), config_value_to_json(v));
                }
                (Value::Object(obj), restore_enabled)
            }
            None => return Err(AppError::Io("Settings not initialized".into())),
        }
    };

    let recent_workspaces = load_recent_workspaces(&app).unwrap_or_default();
    let pending_open = state.pop_pending_open();

    // Pick a workspace to prefetch a bundle for so the frontend can hydrate
    // synchronously on first render — no second IPC waterfall, no welcome
    // screen flash. CLI / drag-drop cold starts get their pending workspace;
    // otherwise fall back to the recent list (gated on the restore setting).
    // Secondary windows opened via `open_workspace_in_new_window` follow the
    // pending-open branch via their pre-seeded queue.
    let restore_target = if let Some(payload) = &pending_open {
        Some((
            payload.workspace.clone(),
            RestoreBundleMode::LaunchTarget {
                file: payload.file.clone(),
            },
        ))
    } else if restore_enabled {
        recent_workspaces
            .first()
            .filter(|path| Path::new(path).is_dir())
            .cloned()
            .map(|path| (path, RestoreBundleMode::RestoreSession))
    } else {
        None
    };

    let restore_bundle = if let Some((path, mode)) = restore_target {
        match build_restore_bundle(&app, &label, &path, mode).await {
            Ok(bundle) => Some(bundle),
            Err(err) => {
                // Don't let a failed restore abort startup — settings still
                // need to hydrate and the welcome screen should render.
                eprintln!("failed to prefetch restore bundle for {path}: {err:?}");
                None
            }
        }
    } else {
        None
    };

    Ok(StartupState {
        settings,
        recent_workspaces,
        pending_open,
        restore_bundle,
    })
}
