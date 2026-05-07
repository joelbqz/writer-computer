mod commands;
mod config;
#[cfg(target_os = "macos")]
mod dock_menu;
mod error;
mod ignore;
pub mod open_target;
mod state;
#[cfg(desktop)]
mod updater;
mod watcher;
pub mod writer_cli;

use commands::settings::init_window_settings;
use error::AppError;
use open_target::resolve_path;
pub use open_target::PendingOpenPayload;
use state::AppState;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use tauri::menu::MenuItem;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{DragDropEvent, Emitter, Manager, WebviewWindow, WindowEvent};

#[cfg(target_os = "macos")]
const CLI_MENU_INSTALL_LABEL: &str = "Install 'writer' Command Line Tool…";
#[cfg(target_os = "macos")]
const CLI_MENU_UNINSTALL_LABEL: &str = "Uninstall 'writer' Command Line Tool…";

#[cfg(target_os = "macos")]
struct CliMenuItem(MenuItem<tauri::Wry>);

const MAIN_WINDOW_LABEL: &str = "main";

/// Push an open payload into the target window's pending-open queue and emit
/// the notification so the frontend in that window drains it. Events are
/// routed via `emit_to` so a drop onto window A never triggers window B.
fn queue_open_event(app: &tauri::AppHandle, label: &str, payload: PendingOpenPayload) {
    if let Some(state) = app.state::<AppState>().get(label) {
        state.push_pending_open(payload.clone());
    }
    let _ = app.emit_to(label, "open:from-drop", payload);
}

/// Wire up per-window event handlers: drag-drop routes to the window's own
/// pending-open queue, and the close/destroy event tears down the window's
/// `WorkspaceState` (which drops the watcher, stopping FSEvents / inotify
/// subscriptions).
fn attach_window_handlers(app: &tauri::AppHandle, window: &WebviewWindow) {
    let label = window.label().to_string();
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            for path in paths {
                if let Some(payload) = resolve_path(path) {
                    queue_open_event(&handle, &label, payload);
                    break;
                }
            }
        }
        WindowEvent::Destroyed => {
            // Remove the state; the `WorkspaceState`'s `RecommendedWatcher`
            // drops on the last `Arc` release, unregistering FSEvents/inotify.
            handle.state::<AppState>().remove(&label);
        }
        _ => {}
    });
}

/// Open a new `WebviewWindow` inside this process for the given workspace.
/// Used by the `open_workspace_in_new_window` IPC and by the
/// single-instance plugin when a second Writer launch arrives with a path.
///
/// If any existing window already hosts `workspace_path`, focus it rather
/// than building a duplicate — the spec states each workspace gets at most
/// one window at a time.
pub(crate) fn open_new_workspace_window(
    app: &tauri::AppHandle,
    workspace_path: String,
    file: Option<String>,
) -> Result<(), AppError> {
    let raw_workspace = PathBuf::from(&workspace_path);
    if !raw_workspace.exists() || !raw_workspace.is_dir() {
        return Err(AppError::NotFound(workspace_path));
    }

    // Canonicalize before lookup and pending-open queueing so aliased paths
    // (`/var/foo` vs. `/private/var/foo`, symlinked workspaces) don't spawn
    // duplicate windows and the watcher's canonical workspace_root matches
    // the pending-open record.
    let workspace = raw_workspace
        .canonicalize()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let workspace_str = workspace.to_string_lossy().to_string();

    if let Some(existing_label) = app.state::<AppState>().find_by_workspace(&workspace) {
        if let Some(window) = app.get_webview_window(&existing_label) {
            let _ = window.set_focus();
            return Ok(());
        }
    }

    let label = format!("w-{}", uuid::Uuid::new_v4().simple());
    let state = app.state::<AppState>().get_or_create(&label);
    init_window_settings(app, &state);
    state.push_pending_open(PendingOpenPayload {
        workspace: workspace_str,
        file,
    });

    // Clone the main window's config (titlebar overlay, traffic-light
    // position, transparency, hudWindow vibrancy, `visible: false`) so
    // secondary windows look and animate identically. Rewrite the label,
    // strip `center` so subsequent windows aren't stacked directly on top
    // of the previous one.
    let window_config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| AppError::Io("no window config in tauri.conf.json".into()));
    let mut window_config = match window_config {
        Ok(c) => c,
        Err(e) => {
            app.state::<AppState>().remove(&label);
            return Err(e);
        }
    };
    window_config.label = label.clone();
    window_config.center = false;

    let window = (|| -> Result<WebviewWindow, AppError> {
        tauri::WebviewWindowBuilder::from_config(app, &window_config)
            .map_err(|e| AppError::Io(e.to_string()))?
            .build()
            .map_err(|e| AppError::Io(e.to_string()))
    })();

    let window = match window {
        Ok(w) => w,
        Err(e) => {
            // Prevent an orphaned `WorkspaceState` from lingering in the
            // registry for a window that never opened (so `Destroyed` never
            // fires). Drops the watcher (none yet) and reclaims memory.
            app.state::<AppState>().remove(&label);
            return Err(e);
        }
    };

    attach_window_handlers(app, &window);

    Ok(())
}

/// Build the native menu bar and wire updater menu events. macOS only needs a
/// menu at all because of the auto-updater; the rest of the items are standard
/// predefined actions so nothing has to be rewired on the frontend.
#[cfg(desktop)]
fn install_app_menu(
    app: &tauri::AppHandle,
    app_data_dir: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let check_item = MenuItemBuilder::with_id("updater.check", "Check for Updates…").build(app)?;

    let preferences_item = MenuItemBuilder::with_id("preferences.open", "Preferences…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    #[cfg(target_os = "macos")]
    let cli_item = MenuItemBuilder::with_id("cli.toggle", CLI_MENU_INSTALL_LABEL).build(app)?;

    let app_submenu = {
        let b = SubmenuBuilder::new(app, "Writer")
            .item(&PredefinedMenuItem::about(app, Some("About Writer"), None)?)
            .separator()
            .item(&check_item)
            .separator()
            .item(&preferences_item);
        #[cfg(target_os = "macos")]
        let b = b.item(&cli_item);
        b.separator()
            .item(&PredefinedMenuItem::services(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?)
            .build()?
    };

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .build()?;

    app.set_menu(menu)?;

    let menu_items = updater::UpdaterMenuItems { check: check_item };
    app.manage(updater::UpdaterManager::new(menu_items, app_data_dir));

    #[cfg(target_os = "macos")]
    {
        app.manage(CliMenuItem(cli_item));
        refresh_cli_menu(app);
    }

    app.on_menu_event(|app, event| match event.id().0.as_str() {
        "updater.check" => updater::start_check(app.clone(), true),
        "preferences.open" => emit_to_focused_window(app, "menu:open-preferences"),
        #[cfg(target_os = "macos")]
        "cli.toggle" => run_cli_toggle(app.clone()),
        _ => {}
    });

    Ok(())
}

/// Send an event to whichever webview window currently has focus, scoped to
/// that window so other windows don't react. The native menu handler runs on
/// the `AppHandle` and isn't tied to a window, so we resolve the target here.
///
/// Fallback order if no window reports focus (focus race, platform error
/// from `is_focused`): the main window if visible, else any visible window.
/// `webview_windows()` returns a `HashMap` whose iteration order is
/// non-deterministic, so the explicit main-window preference matters.
fn emit_to_focused_window(app: &tauri::AppHandle, event: &str) {
    let windows = app.webview_windows();
    let target = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| {
            windows
                .get(MAIN_WINDOW_LABEL)
                .filter(|w| w.is_visible().unwrap_or(false))
        })
        .or_else(|| windows.values().find(|w| w.is_visible().unwrap_or(false)));
    if let Some(window) = target {
        let _ = app.emit_to(window.label(), event, ());
    }
}

#[cfg(target_os = "macos")]
fn refresh_cli_menu(app: &tauri::AppHandle) {
    let installed = commands::shell_install::cli_status(app.clone()).installed;
    let label = if installed {
        CLI_MENU_UNINSTALL_LABEL
    } else {
        CLI_MENU_INSTALL_LABEL
    };
    if let Some(item) = app.try_state::<CliMenuItem>() {
        let _ = item.0.set_text(label);
    }
}

#[cfg(target_os = "macos")]
fn run_cli_toggle(app: tauri::AppHandle) {
    if commands::shell_install::cli_status(app.clone()).installed {
        run_cli_uninstall(app);
    } else {
        run_cli_install(app);
    }
}

#[cfg(target_os = "macos")]
fn run_cli_install(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    tauri::async_runtime::spawn_blocking(move || {
        match commands::shell_install::install_cli(app.clone()) {
            Ok(status) => {
                refresh_cli_menu(&app);
                app.dialog()
                    .message(format!(
                        "The `writer` command is now installed at {}.\n\nRun `writer .` from any terminal to open the current folder.",
                        status.target
                    ))
                    .kind(MessageDialogKind::Info)
                    .title("Writer CLI Installed")
                    .show(|_| {});
            }
            Err(err) => {
                app.dialog()
                    .message(format!("Could not install the writer command.\n\n{err}"))
                    .kind(MessageDialogKind::Error)
                    .title("Writer CLI")
                    .show(|_| {});
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn run_cli_uninstall(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    tauri::async_runtime::spawn_blocking(move || {
        match commands::shell_install::uninstall_cli(app.clone()) {
            Ok(status) => {
                refresh_cli_menu(&app);
                app.dialog()
                    .message(format!(
                        "The `writer` command has been removed from {}.",
                        status.target
                    ))
                    .kind(MessageDialogKind::Info)
                    .title("Writer CLI Removed")
                    .show(|_| {});
            }
            Err(err) => {
                app.dialog()
                    .message(format!("Could not remove the writer command.\n\n{err}"))
                    .kind(MessageDialogKind::Error)
                    .title("Writer CLI")
                    .show(|_| {});
            }
        }
    });
}

/// Handle a second Writer launch while one is already running. With
/// `tauri-plugin-single-instance` the OS routes the second process's argv
/// here via the existing process; we translate that into either opening a
/// new window for the argv path or surfacing the existing windows if the
/// user just re-launched the app without an argument.
fn handle_single_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    let path_arg = argv.into_iter().nth(1);
    match path_arg.and_then(|arg| resolve_path(&PathBuf::from(arg))) {
        Some(payload) => {
            if let Err(err) =
                open_new_workspace_window(app, payload.workspace.clone(), payload.file.clone())
            {
                eprintln!("failed to open new window from single-instance argv: {err:?}");
            }
        }
        None => {
            // Re-launch with no path: bring an existing window forward.
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.set_focus();
                return;
            }
            // Fallback: focus any known window.
            if let Some(label) = app.state::<AppState>().labels().first() {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.set_focus();
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_single_instance(app, argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    // Embed a W3C WebDriver server when built with `--features e2e` so the
    // local E2E suite can drive the WKWebView via `tauri-webdriver`. Never
    // enabled in release builds shipped to users.
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        .manage(AppState::new())
        .setup(|app| {
            // Initialize the main window's per-window state (settings layer,
            // pending-open queue). `get_or_create` lazily builds the
            // `WorkspaceState` for the `"main"` label.
            let main_state = app.state::<AppState>().get_or_create(MAIN_WINDOW_LABEL);
            init_window_settings(app.handle(), &main_state);

            // CLI arg → main window's pending-open queue. On cold start the
            // main window is the one that will host the requested workspace.
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let path = PathBuf::from(&args[1]);
                if let Some(payload) = resolve_path(&path) {
                    main_state.push_pending_open(payload);
                }
            }

            #[cfg(desktop)]
            {
                let config_dir = app
                    .path()
                    .app_data_dir()
                    .expect("failed to get app data dir");
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                install_app_menu(app.handle(), config_dir)?;
                #[cfg(target_os = "macos")]
                dock_menu::install(app.handle());

                // Kick off the launch check once the window is ready to show
                // any follow-up dialogs on top of a visible app.
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    updater::start_check(handle.clone(), false);
                    updater::spawn_daily_check(handle);
                });
            }

            // Attach drag-drop + close handlers on the main window.
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                attach_window_handlers(app.handle(), &window);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::rename_entry,
            commands::fs::delete_entry,
            commands::fs::file_exists,
            commands::fs::reveal_in_file_manager,
            commands::workspace::open_workspace,
            commands::workspace::open_workspace_in_new_window,
            commands::workspace::restore_workspace,
            commands::workspace::get_recent_workspaces,
            commands::workspace::remove_recent_workspace,
            commands::workspace::take_pending_open,
            commands::workspace::save_session,
            commands::workspace::load_session,
            commands::search::index_workspace,
            commands::search::fuzzy_search,
            commands::images::save_clipboard_image,
            commands::settings::get_settings,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::reset_setting,
            commands::startup::get_startup_state,
            #[cfg(target_os = "macos")]
            commands::shell_install::cli_status,
            #[cfg(target_os = "macos")]
            commands::shell_install::install_cli,
            #[cfg(target_os = "macos")]
            commands::shell_install::uninstall_cli,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // On macOS, dragging a folder/file to the dock icon sends file:// URLs
            // via the RunEvent::Opened event. The variant only exists in the
            // macOS build of Tauri, so the handler must be gated behind a cfg.
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = &_event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(payload) = resolve_path(&path) {
                            // A dock drop isn't associated with a specific
                            // window — route it to an already-open window
                            // showing the same workspace, else open a new
                            // one so the user never loses their current
                            // editor state.
                            let existing = _app
                                .state::<AppState>()
                                .find_by_workspace(&PathBuf::from(&payload.workspace));
                            match existing {
                                Some(label) => {
                                    queue_open_event(_app, &label, payload);
                                }
                                None => {
                                    let _ = open_new_workspace_window(
                                        _app,
                                        payload.workspace.clone(),
                                        payload.file.clone(),
                                    );
                                }
                            }
                            break;
                        }
                    }
                }
            }
        });
}
