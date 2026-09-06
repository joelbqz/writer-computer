# Telemetry

Writer can send a small amount of usage data to help decide what to build next.
**It is off until you turn it on.** No network request is made before you accept
the first-run prompt, and either answer can be changed later in Preferences.

This document is the complete disclosure. If it disagrees with the code, the
code is the bug — the event table below is mirrored in
`apps/desktop/src-tauri/src/telemetry.rs`, which is the only file in the app
that talks to an analytics service.

## Turning it on and off

- **First run** — a dialog explains what is collected and offers **Not now** or
  **Share usage data**. Dismissing it counts as **Not now**.
- **Any time after** — Preferences → Privacy → **Share Usage Data**.

Turning it off takes effect immediately; nothing is queued for later.

The setting on its own is not consent. Writer also keeps a record that *this
install* answered the first-run prompt, and it sends nothing until that record
exists — so a `config` file copied from another machine with the setting turned
on does not send anything until you have seen the prompt here and accepted it.
Answering **Not now** writes the setting off explicitly.

## What is collected

Four events. That is the whole list.

| Event              | When                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| `app_opened`       | Once per app launch (or when you first turn telemetry on, if that is later) |
| `workspace_opened` | A workspace becomes active, including restoring your last session at launch |
| `file_created`     | A file is created                                                           |
| `folder_created`   | A folder is created                                                         |

Every event carries the same fixed set of properties, and nothing else:

| Property         | Example           | Notes                                                                 |
| ---------------- | ----------------- | --------------------------------------------------------------------- |
| `distinct_id`    | `9f2c...`         | Random UUID generated on this install                                 |
| `app_version`    | `0.5.0`           |                                                                       |
| `os`             | `macos`           |                                                                       |
| `arch`           | `aarch64`         |                                                                       |
| `$geoip_disable` | `true`            | Tells PostHog not to derive a location from the request IP            |
| `$set.email`     | `you@example.com` | Only if you typed one; attached to your install's record, see below   |
| `$unset`         | `["email"]`       | Sent instead of `$set.email` when the field is blank, so clearing it clears it there too |

There is no mechanism for passing per-event properties, so a file name or a
snippet of your writing cannot reach the analytics service by accident.

## What is never collected

- The contents of your documents. No text you write leaves your machine.
- File names, folder names, or any filesystem path.
- Workspace names, search queries, or document counts.
- Your IP is used for nothing beyond delivering the request; no geolocation
  properties are attached.

## The email field

The email is **optional and self-declared**. Writer does not read it from your
system, your git config, or anywhere else — the only way it gets set is if you
type it into the first-run dialog or Preferences → Privacy → **Email**.

If set, it is attached to your install's person record so the maintainer can
reach out about the features you use. Clear the field in Preferences to go back
to being anonymous: the next event tells the analytics service to remove the
address from that record, rather than merely stopping to send it.

## Your identifier

A random UUID is generated the first time telemetry initializes and stored in
`telemetry.json` in Writer's application data directory, alongside a flag
recording that you have answered the first-run prompt.

It is deliberately kept out of your `config` file: that file is human-editable
and is the kind of thing people copy between machines, and an identifier living
there would silently merge two installs into one "user". Delete `telemetry.json`
to get a new identifier and to see the first-run prompt again; until you answer
it, nothing is sent, whatever the setting says.

## Where it goes

PostHog Cloud (US region, `https://us.i.posthog.com`), via a single
`POST /batch/`.

## Turning it off for good

Three independent switches, any one of which is sufficient:

1. **Don't enable it.** This is the default.
2. **`WRITER_TELEMETRY_DISABLED=1`** (any non-empty value) in the environment
   disables telemetry at runtime regardless of your settings — the client is never constructed, so no
   identifier is generated and nothing is written to disk. It is read at
   startup, so it applies from the next launch onward. Intended for distro
   packagers and for anyone running a build they did not make themselves.
3. **Build it yourself.** The PostHog project key is supplied at compile time
   via `WRITER_POSTHOG_KEY`. A build without that variable — which is what you
   get by cloning this repo and running `vp dev` or `cargo build` — has no key
   compiled in, never constructs the client, never generates an identifier, and
   never shows the consent prompt, whatever the settings say.

`WRITER_POSTHOG_HOST` overrides the destination if you run your own PostHog.

## For contributors

Dev builds are inert by default (no key), so local work never pollutes
production analytics. To exercise the real path against your own PostHog
project:

```bash
WRITER_POSTHOG_KEY=phc_your_project_key vp dev
```

Adding an event means editing three things in the same commit: the `track` call
site, the table in this file, and the `COLLECTED` list in
`apps/desktop/src/components/telemetry-consent-dialog.tsx`. If a change would
make any of those three disagree, it needs a different design.
