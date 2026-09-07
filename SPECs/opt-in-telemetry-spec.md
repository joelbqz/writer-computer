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

`WRITER_TELEMETRY_DISABLED` set to any non-empty value in the environment
disables telemetry at runtime regardless of settings, for packagers and for
users of distro builds.

## Behavior

### First run

After startup resolves in the `main` window, if `prompted` is `false` the app
shows a modal explaining exactly what is and is not collected, with a link to
`docs/telemetry.md`, an optional email field, and two buttons: **Not now** and
**Count me in**. Either button sets `prompted = true` first, then writes
`telemetry.enabled` explicitly — `true` for the second, `false` for the first.
Dismissing with Escape or the backdrop is equivalent to **Not now** — nothing
is enabled, and the prompt does not return. If a write fails the dialog stays
open with the error and the buttons re-enabled; nothing is inferred from a
partial answer.

The effective switch is `telemetry.enabled && prompted`. The two live in
different files (`config` and `telemetry.json`) and can disagree — a copied
config, a deleted identity file — and when they do, the missing consent record
wins: nothing is sent until this install's prompt is answered. That is why the
dialog marks `prompted` before writing the setting, and why **Not now** writes
`false` rather than leaving the setting alone.

The dialog is modal in both senses: the backdrop blocks the pointer, and a
document-level key handler keeps Tab inside the card, resolves Escape as
**Not now**, and stops modifier shortcuts from reaching the app underneath.
Enter in the email field does nothing; only the button opts in.

Secondary and compact windows never prompt.

### Events

| Event              | Emitted from                                    | Trigger                                                    |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------- |
| `app_opened`       | `lib.rs` setup, and `apply_settings` on consent | Once per process launch                                    |
| `file_created`     | `fs::create_file_impl`                          | Any path that creates a file                               |
| `folder_created`   | `fs::create_directory_impl`                     | Any path that creates a folder                             |
| `workspace_opened` | `workspace::prepare_workspace_state`            | A workspace root becomes active, including session restore |

Every call site is the shared inner function, not the `#[tauri::command]`
wrapper. `create_sidebar_entry` reuses `create_file_impl`, and the startup
restore bundle reuses `prepare_workspace_state`, so those inner functions are
the one place where each fact is true exactly once. Instrumenting the commands
instead would miss the sidebar and restore paths.

`app_opened` has two emit points because consent can arrive after startup. A
user opting in during their first session enabled telemetry _after_ the startup
call had already no-opped; without the second call that session would never be
counted, and someone who opts in and never returns would be invisible in the
stream entirely. A per-process flag, set only when the event is actually
queued, keeps it to one per launch.

`workspace_opened` keeps that first-session gap on purpose: restore runs before
the dialog mounts, and back-filling it at consent time would report an event
that did not happen then. It self-corrects on the next launch.

### Properties

Every event carries only:

- `distinct_id`
- `app_version` (from `CARGO_PKG_VERSION`)
- `os` (`macos` / `windows` / `linux`) and `arch`
- `$geoip_disable: true`, so PostHog Cloud does not derive a location from the
  request IP (its default is to do so)
- `$set: { email }` when `telemetry.email` is non-empty, otherwise
  `$unset: ["email"]` so clearing the field also clears the person record

There is no per-event property allowlist to maintain because there are no
per-event properties. Adding one is a deliberate edit to this table and to
`docs/telemetry.md`.

### Transport

A single unbounded `tokio::mpsc` channel feeds one background task that POSTs
`{ api_key, batch: [...] }` to `<host>/batch/`. The task drains everything
currently queued into one request, so a burst of creations costs one round trip.
The enabled flag is re-checked before each request, so a batch that was waiting
behind a slow request when the user turned telemetry off is discarded. Failures,
including non-2xx responses, are logged to stderr and dropped.

`track()` returns immediately, before the enabled check even allocates, so
disabled installs pay nothing beyond an atomic load.

## Files

**Backend**

- `src-tauri/src/telemetry.rs` — new; identity, client, queue, IPC commands.
- `src-tauri/src/lib.rs` — register module, init in `setup`, `app_opened`.
- `src-tauri/src/commands/fs.rs` — two `track` calls.
- `src-tauri/src/commands/workspace.rs` — one `track` call.
- `src-tauri/src/commands/settings.rs` — every global write pushes the
  resulting telemetry state into the running client while the settings lock is
  still held, so a toggle takes effect without a restart, two windows cannot
  re-apply a stale value, and a hand-edited `config` picked up by the reload
  inside a write catches up.
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
