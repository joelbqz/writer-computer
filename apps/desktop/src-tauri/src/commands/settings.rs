use crate::config::{ConfigValue, Settings};
use crate::error::AppError;
use crate::state::{AppState, WorkspaceState};
use serde_json::Value;
use std::sync::Arc;
use tauri::Manager;

/// Look up the calling window's per-window settings and run `f` against them.
fn with_settings<T>(
    app: &tauri::AppHandle,
    label: &str,
    f: impl FnOnce(&Settings) -> T,
) -> Result<T, AppError> {
    let state = app.state::<AppState>().get_or_create(label);
    let guard = state.settings.read();
    match guard.as_ref() {
        Some(s) => Ok(f(s)),
        None => Err(AppError::Io("Settings not initialized".into())),
    }
}

fn with_settings_mut<T>(
    app: &tauri::AppHandle,
    label: &str,
    f: impl FnOnce(&mut Settings) -> T,
) -> Result<T, AppError> {
    let state = app.state::<AppState>().get_or_create(label);
    let mut guard = state.settings.write();
    match guard.as_mut() {
        Some(s) => Ok(f(s)),
        None => Err(AppError::Io("Settings not initialized".into())),
    }
}

/// Run a global-scope mutation under the process-wide settings lock, then push
/// the resulting telemetry state into the running client before the lock is
/// released. Doing it here, for every global write, means two windows cannot
/// interleave "persist A, persist B, apply A" and re-enable telemetry from a
/// stale snapshot, and a hand-edited `telemetry.enabled` picked up by the
/// reload inside `set_global`/`reset_global` reaches the client on the next
/// write to any key instead of at the next launch.
fn with_global_settings_mut<T>(
    app_state: &AppState,
    state: &WorkspaceState,
    f: impl FnOnce(&mut Settings) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let _global_guard = app_state.global_settings_file_lock.lock();
    let mut settings_guard = state.settings.write();
    let settings = settings_guard
        .as_mut()
        .ok_or_else(|| AppError::Io("Settings not initialized".into()))?;
    let result = f(settings)?;
    let (enabled, email) = crate::telemetry::settings_snapshot(settings);
    crate::telemetry::apply_settings(enabled, email);
    Ok(result)
}

fn init_window_settings_at(
    app_state: &AppState,
    state: &WorkspaceState,
    config_dir: std::path::PathBuf,
) -> Result<(), AppError> {
    let _global_guard = app_state.global_settings_file_lock.lock();
    let settings = Settings::new(config_dir).map_err(|error| AppError::Io(error.to_string()))?;
    *state.settings.write() = Some(settings);
    Ok(())
}

pub(crate) fn get_global_string_setting(
    app: &tauri::AppHandle,
    label: &str,
    key: &str,
) -> Result<String, AppError> {
    let value = with_settings(app, label, |settings| {
        settings.get_global_or_default(key).cloned()
    })?
    .ok_or_else(|| AppError::Io(format!("Missing setting: {key}")))?;
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| AppError::Io(format!("Setting {key} must be a string")))
}

/// Initialize a window's Settings layer. Called from the window setup path
/// (main window in `setup`, secondary windows in `open_workspace_in_new_window`
/// and the single-instance handler) so every window has its own merged view
/// of defaults + global + workspace settings.
pub fn init_window_settings(
    app: &tauri::AppHandle,
    state: &Arc<WorkspaceState>,
) -> Result<(), AppError> {
    let config_dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    init_window_settings_at(app.state::<AppState>().inner(), state, config_dir)
}

pub fn config_value_to_json(v: &ConfigValue) -> Value {
    match v {
        ConfigValue::Bool(b) => Value::Bool(*b),
        ConfigValue::Number(n) => serde_json::Number::from_f64(*n)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ConfigValue::String(s) => Value::String(s.clone()),
        ConfigValue::List(items) => {
            Value::Array(items.iter().map(|s| Value::String(s.clone())).collect())
        }
    }
}

fn json_to_config_value(v: &Value) -> Option<ConfigValue> {
    match v {
        Value::Bool(b) => Some(ConfigValue::Bool(*b)),
        Value::Number(n) => n.as_f64().map(ConfigValue::Number),
        Value::String(s) => Some(ConfigValue::String(s.clone())),
        Value::Array(arr) => {
            let items: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            Some(ConfigValue::List(items))
        }
        _ => None,
    }
}

#[tauri::command]
pub fn get_settings(webview: tauri::Webview, app: tauri::AppHandle) -> Result<Value, AppError> {
    with_settings(&app, webview.label(), |settings| {
        let merged = settings.merged();
        let mut obj = serde_json::Map::new();
        for (k, v) in &merged {
            obj.insert(k.clone(), config_value_to_json(v));
        }
        Value::Object(obj)
    })
}

#[tauri::command]
pub fn get_setting(
    key: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Value, AppError> {
    with_settings(&app, webview.label(), |settings| {
        settings
            .get(&key)
            .map(config_value_to_json)
            .unwrap_or(Value::Null)
    })
}

#[tauri::command]
pub fn set_setting(
    key: String,
    value: Value,
    scope: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<Value, AppError> {
    let config_value =
        json_to_config_value(&value).ok_or_else(|| AppError::Io("Invalid value type".into()))?;

    let state = app.state::<AppState>().get_or_create(webview.label());
    let persist = |settings: &mut Settings| {
        let result = match scope.as_str() {
            "workspace" => settings.set_workspace(&key, config_value),
            _ => settings.set_global(&key, config_value),
        };
        result.map_err(|e| AppError::Io(e.to_string()))?;
        let value = match scope.as_str() {
            "workspace" => settings.get(&key),
            _ => settings.get_global_or_default(&key),
        };
        value
            .cloned()
            .ok_or_else(|| AppError::Io(format!("Missing setting after write: {key}")))
    };
    let persisted = if scope == "workspace" {
        with_settings_mut(&app, webview.label(), persist)??
    } else {
        with_global_settings_mut(app.state::<AppState>().inner(), &state, persist)?
    };
    Ok(config_value_to_json(&persisted))
}

#[tauri::command]
pub fn reset_setting(
    key: String,
    scope: String,
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<AppState>().get_or_create(webview.label());
    let reset = |settings: &mut Settings| {
        let result = match scope.as_str() {
            "workspace" => settings.reset_workspace(&key),
            _ => settings.reset_global(&key),
        };
        result.map_err(|e| AppError::Io(e.to_string()))
    };
    if scope == "workspace" {
        with_settings_mut(&app, webview.label(), reset)?
    } else {
        with_global_settings_mut(app.state::<AppState>().inner(), &state, reset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn global_mutation_and_window_initialization_share_one_process_lock() {
        let config_dir = tempfile::tempdir().unwrap();
        let app_state = Arc::new(AppState::new());
        let writer_state = Arc::new(WorkspaceState::default());
        *writer_state.settings.write() =
            Some(Settings::new(config_dir.path().to_path_buf()).unwrap());
        let initializing_state = Arc::new(WorkspaceState::default());

        let (writer_entered_tx, writer_entered_rx) = mpsc::channel();
        let (release_writer_tx, release_writer_rx) = mpsc::channel();
        let writer_app_state = app_state.clone();
        let writer_window_state = writer_state.clone();
        let writer = std::thread::spawn(move || {
            with_global_settings_mut(&writer_app_state, &writer_window_state, |settings| {
                writer_entered_tx.send(()).unwrap();
                release_writer_rx.recv().unwrap();
                settings
                    .set_global(
                        "workspace.default-terminal",
                        ConfigValue::String("Ghostty".into()),
                    )
                    .map_err(|error| AppError::Io(error.to_string()))
            })
            .unwrap();
        });
        writer_entered_rx.recv().unwrap();

        let (initialized_tx, initialized_rx) = mpsc::channel();
        let init_app_state = app_state.clone();
        let init_window_state = initializing_state.clone();
        let init_config_dir = config_dir.path().to_path_buf();
        let initializer = std::thread::spawn(move || {
            init_window_settings_at(&init_app_state, &init_window_state, init_config_dir).unwrap();
            initialized_tx.send(()).unwrap();
        });

        assert!(initialized_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        assert!(initializing_state.settings.read().is_none());

        release_writer_tx.send(()).unwrap();
        writer.join().unwrap();
        initialized_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        initializer.join().unwrap();

        let initialized = initializing_state.settings.read();
        assert_eq!(
            initialized
                .as_ref()
                .unwrap()
                .get("workspace.default-terminal"),
            Some(&ConfigValue::String("Ghostty".into()))
        );
    }
}
