# Opt-in Telemetry

## Goal

Answer three questions about Writer's users without compromising the local-first
promise:

1. **Who are my users?** — an optional, self-declared email address.
2. **How many active users are there?** — a stable per-install identifier.
3. **What do they do?** — a small, fixed set of intent events (file created,
   folder created, workspace opened, app opened).

Everything is **off until the user explicitly turns it on**. No network request
of any kind is made before that.

## Non-goals

- Session recording, autocapture, heatmaps, or any DOM-level instrumentation.
- Any transmission of document content, file names, folder names, workspace
  paths, or search queries.
- Retrying, disk-buffering, or backfilling events across restarts. Events are
  fire-and-forget; a dropped event is preferable to a queue of user activity
  sitting on disk.

## Decisions

### The client lives in Rust, not `posthog-js`

`posthog-js` is rejected. The events we care about (file/folder creation) already
funnel through `commands/fs.rs`, so Rust is where the single write path is.
Beyond that, `posthog-js` defaults to autocapture and would need explicit
suppression to avoid capturing users' actual prose out of the editor DOM — an
opt-out privacy posture inside an opt-in feature. A Rust client also keeps the
project key out of the webview and keeps the whole egress surface in one
auditable file.

### Identity is a file, not a setting

`telemetry.json` in the app data dir holds `{ distinct_id, prompted }`.

`distinct_id` is a v4 UUID generated on first init. It is deliberately **not** in
`config`: the settings file is human-editable and something users copy between
machines, which would silently merge two installs into one "user". `prompted`
lives beside it for the same reason — it is state, not a preference, and it has
no business appearing in the Preferences panel.

### The email is a normal setting

`telemetry.email` is an ordinary schema entry, so it shows in Preferences and
goes through the existing settings write path. Users can see it, change it, and
clear it in the same place as everything else. It is sent as a PostHog `$set`
person property, so clearing it in Preferences updates the person on the next
event.

### Build-time key, absent by default

`WRITER_POSTHOG_KEY` is read with `option_env!` at compile time. **When it is
unset the telemetry module is inert** — no key, no capture, regardless of
settings. This is the property that matters for an open-source project: anyone
who clones and builds Writer gets a binary that cannot phone home, and
contributors' dev builds never pollute production analytics. `WRITER_POSTHOG_HOST`
overrides the host (default `https://us.i.posthog.com`) for self-hosted forks.

`WRITER_TELEMETRY_DISABLED=1` in the environment disables telemetry at runtime
regardless of settings, for packagers and for users of distro builds.

## Behavior

### First run

After startup resolves in the `main` window, if `prompted` is `false` the app
shows a modal explaining exactly what is and is not collected, with a link to
`docs/telemetry.md`, an optional email field, and two buttons: **Not now** and
**Share usage data**. Either button sets `prompted = true`; only the second sets
`telemetry.enabled = true`. Dismissing with Escape or the backdrop is equivalent
to **Not now** — nothing is enabled, and the prompt does not return.

Secondary and compact windows never prompt.

### Events

| Event              | Emitted from                         | Trigger                                                    |
| ------------------ | ------------------------------------ | ---------------------------------------------------------- |
| `app_opened`       | `lib.rs` setup                       | Once per process launch                                    |
| `file_created`     | `fs::create_file_impl`               | Any path that creates a file                               |
| `folder_created`   | `fs::create_directory_impl`          | Any path that creates a folder                             |
| `workspace_opened` | `workspace::prepare_workspace_state` | A workspace root becomes active, including session restore |

Every call site is the shared inner function, not the `#[tauri::command]`
wrapper. `create_sidebar_entry` reuses `create_file_impl`, and the startup
restore bundle reuses `prepare_workspace_state`, so those inner functions are
the one place where each fact is true exactly once. Instrumenting the commands
instead would miss the sidebar and restore paths.

### Properties

Every event carries only:

- `distinct_id`
- `app_version` (from `CARGO_PKG_VERSION`)
- `os` (`macos` / `windows` / `linux`) and `arch`
- `$set: { email }` when `telemetry.email` is non-empty

There is no per-event property allowlist to maintain because there are no
per-event properties. Adding one is a deliberate edit to this table and to
`docs/telemetry.md`.

### Transport

A single unbounded `tokio::mpsc` channel feeds one background task that POSTs
`{ api_key, batch: [...] }` to `<host>/batch/`. The task drains everything
currently queued into one request, so a burst of creations costs one round trip.
Failures are logged to stderr and dropped.

`capture()` returns immediately, before the enabled check even allocates, so
disabled installs pay nothing beyond an atomic load.

## Files

**Backend**

- `src-tauri/src/telemetry.rs` — new; identity, client, queue, IPC commands.
- `src-tauri/src/lib.rs` — register module, init in `setup`, `app_opened`.
- `src-tauri/src/commands/fs.rs` — two `track` calls.
- `src-tauri/src/commands/workspace.rs` — one `track` call.
- `src-tauri/src/commands/settings.rs` — push `telemetry.*` writes into the
  running client so a toggle takes effect without a restart.
- `src-tauri/Cargo.toml` — `reqwest` and `rustls` as direct deps. Both are
  already in the lock via `tauri-plugin-updater`; the feature set is copied from
  it so the dependency graph does not grow.

**Shared**

- `shared/settings.schema.json` — `telemetry.enabled`, `telemetry.email`
  under a new `Privacy` category.

**Frontend**

- `src/components/telemetry-consent-dialog.tsx` — new.
- `src/lib/tauri.ts` — two IPC wrappers.
- `src/App.tsx` — mount the dialog.

**Docs**

- `docs/telemetry.md` — the full disclosure, linked from the dialog and README.

## Verification

- `cargo test` covers identity round-tripping and the disabled-by-default guard.
- With no `WRITER_POSTHOG_KEY` at build time, no request is ever issued.
