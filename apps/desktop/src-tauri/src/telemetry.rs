//! Opt-in usage telemetry.
//!
//! The entire network surface of Writer's analytics lives in this file. Nothing
//! here runs until the user explicitly enables telemetry from the first-run
//! consent dialog or Preferences — `capture` bails on an atomic load before it
//! allocates anything.
//!
//! See `SPECs/opt-in-telemetry-spec.md` for the design and `docs/telemetry.md`
//! for the user-facing disclosure. If the event list or the property set
//! changes, both of those change in the same commit.
//!
//! Three things gate a request, and all three must pass:
//!
//!   1. `WRITER_POSTHOG_KEY` was set at *build* time. An unconfigured build —
//!      which is what anyone cloning this repo gets — cannot phone home at all.
//!   2. `WRITER_TELEMETRY_DISABLED` is not set in the environment.
//!   3. `telemetry.enabled` is true in settings.

use crate::error::AppError;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::Manager;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

/// Compiled-in project token. Absent in development and in any build that does
/// not pass `WRITER_POSTHOG_KEY`, which makes telemetry structurally inert
/// rather than merely switched off.
const POSTHOG_KEY: Option<&str> = option_env!("WRITER_POSTHOG_KEY");

/// Ingestion host. Overridable at build time so self-hosted forks do not have
/// to patch code.
const POSTHOG_HOST: &str = match option_env!("WRITER_POSTHOG_HOST") {
    Some(host) => host,
    None => "https://us.i.posthog.com",
};

/// Runtime kill switch for packagers and for users of third-party builds.
const DISABLE_ENV_VAR: &str = "WRITER_TELEMETRY_DISABLED";

const ENABLED_SETTING_KEY: &str = "telemetry.enabled";
const EMAIL_SETTING_KEY: &str = "telemetry.email";

const IDENTITY_FILE: &str = "telemetry.json";

/// Per-install identity, stored outside the settings file on purpose.
///
/// `config` is human-editable and is the kind of file people copy between
/// machines; a `distinct_id` living there would silently collapse two installs
/// into one "active user". `prompted` sits beside it because it is state rather
/// than a preference and has no business showing up in Preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Identity {
    distinct_id: String,
    #[serde(default)]
    prompted: bool,
}

impl Identity {
    fn new() -> Self {
        Self {
            distinct_id: uuid::Uuid::new_v4().to_string(),
            prompted: false,
        }
    }
}

fn identity_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(IDENTITY_FILE)
}

/// Read the identity file, generating and persisting a fresh one when it is
/// missing or unreadable. A corrupt file is replaced rather than treated as an
/// error: losing continuity of one install's ID is not worth failing startup.
fn load_or_create_identity(app_data_dir: &Path) -> Identity {
    let path = identity_path(app_data_dir);
    if let Ok(contents) = std::fs::read_to_string(&path) {
        if let Ok(identity) = serde_json::from_str::<Identity>(&contents) {
            return identity;
        }
    }
    let identity = Identity::new();
    write_identity(app_data_dir, &identity);
    identity
}

fn write_identity(app_data_dir: &Path, identity: &Identity) {
    if let Err(error) = std::fs::create_dir_all(app_data_dir) {
        eprintln!("telemetry: failed to create app data dir: {error}");
        return;
    }
    match serde_json::to_string_pretty(identity) {
        Ok(json) => {
            if let Err(error) = std::fs::write(identity_path(app_data_dir), json) {
                eprintln!("telemetry: failed to write identity: {error}");
            }
        }
        Err(error) => eprintln!("telemetry: failed to serialize identity: {error}"),
    }
}

/// One queued event. Only the name varies — see `Telemetry::properties` for the
/// fixed property set every event carries.
struct QueuedEvent {
    name: &'static str,
}

pub struct Telemetry {
    app_data_dir: PathBuf,
    distinct_id: String,
    prompted: AtomicBool,
    enabled: AtomicBool,
    /// Whether this process has already reported `app_opened`. Consent can
    /// arrive after startup, so the event has two possible emit points and
    /// this keeps it to one per launch.
    session_opened_reported: AtomicBool,
    email: Mutex<Option<String>>,
    app_version: &'static str,
    sender: UnboundedSender<QueuedEvent>,
}

static TELEMETRY: OnceLock<Telemetry> = OnceLock::new();

fn instance() -> Option<&'static Telemetry> {
    TELEMETRY.get()
}

/// True when this build can talk to PostHog at all. Checked once, at init: if
/// it is false the client is never constructed, so there is nothing left to
/// re-check on the hot path. The env kill switch is therefore read at startup
/// — setting it takes effect on the next launch, not mid-session.
fn transport_available() -> bool {
    POSTHOG_KEY.is_some_and(|key| !key.is_empty()) && std::env::var_os(DISABLE_ENV_VAR).is_none()
}

/// Wire up the process-wide client. Safe to call once; later calls are ignored.
///
/// Reads the initial enabled/email values out of the already-initialized main
/// window settings layer so a returning user's choice applies from launch.
pub fn init(app: &tauri::AppHandle, enabled: bool, email: Option<String>) {
    if TELEMETRY.get().is_some() {
        return;
    }

    // A build with no key, or a run with the kill switch set, never leaves the
    // client uninitialized-but-present: it skips init entirely, so no identity
    // is minted and nothing is written to disk. `instance()` then returns None
    // and every entry point below is a no-op. "Inert" means inert.
    if !transport_available() {
        return;
    }

    let Ok(app_data_dir) = app.path().app_data_dir() else {
        eprintln!("telemetry: no app data dir; telemetry disabled for this session");
        return;
    };

    let identity = load_or_create_identity(&app_data_dir);
    let (sender, receiver) = unbounded_channel();

    let telemetry = Telemetry {
        app_data_dir,
        distinct_id: identity.distinct_id,
        prompted: AtomicBool::new(identity.prompted),
        enabled: AtomicBool::new(enabled),
        session_opened_reported: AtomicBool::new(false),
        email: Mutex::new(normalize_email(email)),
        app_version: env!("CARGO_PKG_VERSION"),
        sender,
    };

    if TELEMETRY.set(telemetry).is_err() {
        return;
    }

    tauri::async_runtime::spawn(run_dispatcher(receiver));
}

fn normalize_email(email: Option<String>) -> Option<String> {
    email
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Record an event. A no-op — costing one atomic load — whenever telemetry is
/// off, uninitialized (tests, `*_impl` helpers called directly), or built
/// without a key.
pub fn track(name: &'static str) {
    let Some(telemetry) = instance() else { return };
    if !telemetry.enabled.load(Ordering::Relaxed) {
        return;
    }
    // A send failure means the dispatcher is gone; dropping the event is the
    // intended behavior — telemetry never retries and never buffers to disk.
    let _ = telemetry.sender.send(QueuedEvent { name });
}

/// Report that the app launched, at most once per process.
///
/// Called twice on purpose: once at startup, and again whenever consent is
/// granted. A user who opts in during their first session enabled telemetry
/// *after* startup had already passed, so the startup call was a no-op —
/// without the second call that first session would never be counted, and
/// someone who opts in and never returns would be invisible in this stream.
/// The flag is only set when the event is actually queued, so a disabled
/// startup leaves the door open for the consent-time call.
pub fn report_app_opened() {
    let Some(telemetry) = instance() else { return };
    if !telemetry.enabled.load(Ordering::Relaxed) {
        return;
    }
    if telemetry
        .session_opened_reported
        .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
        .is_err()
    {
        return;
    }
    track("app_opened");
}

/// Apply a settings change to the running client so toggling the preference
/// takes effect without a restart. Called from the settings write path.
pub fn apply_settings(enabled: bool, email: Option<String>) {
    // Reaching here means `init` ran, which already proved the transport is
    // available — no need to re-check it.
    let Some(telemetry) = instance() else { return };
    telemetry.enabled.store(enabled, Ordering::Relaxed);
    *telemetry.email.lock() = normalize_email(email);
    // Covers consent granted mid-session; a no-op if this launch already
    // reported, so re-enabling from Preferences does not double count.
    report_app_opened();
}

/// Whether the first-run consent dialog still needs to be shown.
pub fn should_prompt() -> bool {
    instance().is_some_and(|telemetry| !telemetry.prompted.load(Ordering::Relaxed))
}

/// Record that the user has answered the consent dialog, whichever way. Both
/// buttons and a dismissal land here, so the prompt is shown at most once.
pub fn mark_prompted() {
    let Some(telemetry) = instance() else { return };
    if telemetry.prompted.swap(true, Ordering::Relaxed) {
        return;
    }
    write_identity(
        &telemetry.app_data_dir,
        &Identity {
            distinct_id: telemetry.distinct_id.clone(),
            prompted: true,
        },
    );
}

/// The complete property set sent with every event. Deliberately fixed: there
/// is no caller-supplied property channel, so no file name, path, or document
/// content can reach PostHog by accident.
///
/// `distinct_id` belongs *inside* `properties` rather than beside `event` —
/// that is where PostHog's batch endpoint reads it from, and getting it wrong
/// fails silently: the request is accepted and the events are discarded.
fn event_properties(
    distinct_id: &str,
    app_version: &str,
    email: Option<&str>,
) -> Map<String, Value> {
    let mut properties = Map::new();
    properties.insert("distinct_id".into(), json!(distinct_id));
    properties.insert("app_version".into(), json!(app_version));
    properties.insert("os".into(), json!(std::env::consts::OS));
    properties.insert("arch".into(), json!(std::env::consts::ARCH));
    if let Some(email) = email {
        // `$set` is PostHog's person-property channel: it attaches the address
        // to the person behind `distinct_id` rather than to this one event.
        properties.insert("$set".into(), json!({ "email": email }));
    }
    properties
}

/// Shape one `POST /batch/` body. Pure so the wire format can be asserted in
/// tests without a project key or a network.
fn build_batch_payload(api_key: &str, events: &[&str], properties: &Map<String, Value>) -> Value {
    let batch: Vec<Value> = events
        .iter()
        .map(|name| json!({ "event": name, "properties": properties }))
        .collect();
    json!({ "api_key": api_key, "batch": batch })
}

impl Telemetry {
    fn properties(&self) -> Map<String, Value> {
        event_properties(
            &self.distinct_id,
            self.app_version,
            self.email.lock().as_deref(),
        )
    }
}

/// Drain the queue and POST batches to PostHog until the app shuts down.
///
/// `recv_many` collapses a burst — creating several files in a row — into a
/// single request instead of one round trip per event.
async fn run_dispatcher(mut receiver: UnboundedReceiver<QueuedEvent>) {
    let Some(api_key) = POSTHOG_KEY else { return };

    // reqwest is built with `rustls-no-provider` (matching tauri-plugin-updater,
    // which is why this adds no crates to the tree), so the process needs a
    // crypto provider installed before the first TLS handshake. The updater
    // installs the same one lazily; whichever runs first wins and the other
    // call is a no-op.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            eprintln!("telemetry: failed to build http client: {error}");
            return;
        }
    };

    let endpoint = format!("{}/batch/", POSTHOG_HOST.trim_end_matches('/'));
    let mut queued = Vec::new();

    while receiver.recv_many(&mut queued, 64).await > 0 {
        let Some(telemetry) = instance() else { return };

        let events: Vec<&str> = queued.iter().map(|event| event.name).collect();
        let payload = build_batch_payload(api_key, &events, &telemetry.properties());
        queued.clear();

        if let Err(error) = client.post(&endpoint).json(&payload).send().await {
            // Fire-and-forget: a failed send is dropped, never retried.
            eprintln!("telemetry: capture failed: {error}");
        }
    }
}

// ---------- IPC ----------

/// Read the current telemetry settings out of a window's settings layer.
/// Used at init and by the settings write path.
pub fn settings_snapshot(settings: &crate::config::Settings) -> (bool, Option<String>) {
    let enabled = settings
        .get(ENABLED_SETTING_KEY)
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let email = settings
        .get(EMAIL_SETTING_KEY)
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    (enabled, email)
}

/// Only the main window prompts. Compact/standalone windows and secondary
/// workspace windows share the same process and the same one-shot `prompted`
/// flag, so without this a second window could race the main one to the dialog.
#[tauri::command]
pub fn telemetry_should_prompt(webview: tauri::Webview) -> bool {
    webview.label() == crate::MAIN_WINDOW_LABEL && should_prompt()
}

#[tauri::command]
pub fn telemetry_mark_prompted() -> Result<(), AppError> {
    mark_prompted();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_generated_and_reused() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create_identity(dir.path());
        assert!(!first.distinct_id.is_empty());
        assert!(!first.prompted);

        let second = load_or_create_identity(dir.path());
        assert_eq!(first.distinct_id, second.distinct_id);
    }

    #[test]
    fn corrupt_identity_is_replaced_rather_than_fatal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(identity_path(dir.path()), "{ not json").unwrap();

        let identity = load_or_create_identity(dir.path());
        assert!(!identity.distinct_id.is_empty());
        assert_eq!(
            load_or_create_identity(dir.path()).distinct_id,
            identity.distinct_id
        );
    }

    #[test]
    fn tracking_without_init_is_a_no_op() {
        // `create_file_impl` and friends call `track` directly, including from
        // unit tests where no app handle exists.
        track("file_created");
        assert!(!should_prompt());
    }

    #[test]
    fn settings_snapshot_defaults_to_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let settings = crate::config::Settings::new(dir.path().to_path_buf()).unwrap();
        let (enabled, email) = settings_snapshot(&settings);
        assert!(!enabled);
        assert_eq!(email.as_deref(), Some(""));
    }

    #[test]
    fn batch_payload_matches_posthogs_wire_format() {
        let properties = event_properties("install-1", "0.5.0", None);
        let payload =
            build_batch_payload("phc_test", &["file_created", "folder_created"], &properties);

        assert_eq!(payload["api_key"], "phc_test");
        let batch = payload["batch"].as_array().unwrap();
        assert_eq!(batch.len(), 2);
        assert_eq!(batch[0]["event"], "file_created");
        assert_eq!(batch[1]["event"], "folder_created");
        // Nested under `properties`, not alongside `event` — see the doc
        // comment on `event_properties` for why this is the failure that hurts.
        assert_eq!(batch[0]["properties"]["distinct_id"], "install-1");
        assert_eq!(batch[0]["properties"]["app_version"], "0.5.0");
    }

    #[test]
    fn properties_carry_no_path_or_content_channel() {
        let properties = event_properties("install-1", "0.5.0", Some("writer@example.com"));
        let mut keys: Vec<&str> = properties.keys().map(String::as_str).collect();
        keys.sort_unstable();

        // The whole privacy guarantee in one assertion: if a key ever shows up
        // here that could hold a path or document text, this fails.
        assert_eq!(keys, ["$set", "app_version", "arch", "distinct_id", "os"]);
        assert_eq!(properties["$set"]["email"], "writer@example.com");
    }

    #[test]
    fn omitted_email_sends_no_person_properties() {
        let properties = event_properties("install-1", "0.5.0", None);
        assert!(!properties.contains_key("$set"));
    }

    #[test]
    fn app_opened_is_a_no_op_without_a_client() {
        // The uninitialized case: a keyless build must not panic or mark state.
        report_app_opened();
    }

    #[test]
    fn blank_emails_normalize_to_none() {
        assert_eq!(normalize_email(Some("  ".into())), None);
        assert_eq!(normalize_email(Some("".into())), None);
        assert_eq!(normalize_email(None), None);
        assert_eq!(
            normalize_email(Some("  writer@example.com ".into())).as_deref(),
            Some("writer@example.com")
        );
    }
}
