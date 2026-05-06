# Install CLI Menu Placement Spec

## Summary

The "Install 'writer' Command in PATH" action lives directly inside the macOS **Writer** application menu — the most prominent menu position in the app. Almost no end user needs a shell command, so the item is noise for everyone who is not a CLI power user. Move it out of the app menu and into Preferences so it stays discoverable for the few who want it without confronting everyone else.

## Background

The CLI install action is wired in `apps/desktop/src-tauri/src/lib.rs:160` and added to the `Writer` submenu at line 168. The label cycles between two strings defined at the top of the same file:

- `Shell Command: Install 'writer' Command in PATH`
- `Shell Command: Uninstall 'writer' Command in PATH`

The underlying Rust install/uninstall logic lives in `apps/desktop/src-tauri/src/commands/shell_install.rs` and is exposed via three Tauri IPC commands already registered in `lib.rs`: `cli_status`, `install_cli`, `uninstall_cli`. So the backend is already callable from the React frontend — the issue is purely placement.

For context on the CLI itself, see [`SPECs/writer-cli-spec.md`](./writer-cli-spec.md). The PATH-install menu item shipped alongside the `writer` open CLI (see `Done` in `TODOS.md`).

## Problem Statement

The Writer menu is the first thing the user sees when they open the app menu. It currently looks roughly like this on macOS:

```
Writer
  About Writer
  Check for Updates…
  Shell Command: Install 'writer' Command in PATH
  ─────
  Services
  ─────
  Hide Writer
  Hide Others
  Show All
  ─────
  Quit Writer
```

For a markdown editor whose target audience explicitly includes non-developer writers, surfacing a long, jargon-laden "Shell Command…" string in this position:

- Confuses users who do not know what PATH means.
- Implies that installing the CLI is a normal setup step.
- Triggers a `sudo`-style admin authorization prompt if clicked, which is alarming when stumbled into.
- Crowds the only menu where standard macOS items (Services, Hide, Quit) are expected to dominate.

Users who actually want the CLI are exactly the users who will look for it — they read the docs, the website, or search Settings.

## Current Behavior

- Defined at `apps/desktop/src-tauri/src/lib.rs:28-30` (label constants) and `lib.rs:160-168` (menu wiring).
- Toggled via `run_cli_toggle` at `lib.rs:237`, which calls `install_cli` / `uninstall_cli`.
- Menu label is refreshed by `refresh_cli_menu` at `lib.rs:224`, which reads `cli_status` on demand.
- Visible on every launch, regardless of whether the user has ever interacted with the CLI.

## Proposed Change

Remove the item from the **Writer** application menu and add a single CLI install/uninstall control to **Preferences** under a new `Shell` section.

### UX in Preferences

- New category in `apps/desktop/shared/settings.schema.json`: `"Shell"`.
- One "action" row inside it. Schema-wise this is a new `type: "action"` (or similar) entry, since the existing `boolean | number | string | enum | range | list | color` types are all value editors. The action row renders a single button.
- Label: `Writer command-line tool`.
- Description: `Adds a 'writer' command to /usr/local/bin so you can open the app from a terminal. Most people don't need this.`
- Button text mirrors the current menu logic:
  - When `cli_status.installed` is `false` → button reads `Install`.
  - When `cli_status.installed` is `true` → button reads `Uninstall`, and a small status line below reads `Installed at /usr/local/bin/writer`.
- Same dialogs as today on success and failure (kept verbatim from `run_cli_install` / `run_cli_uninstall` in `lib.rs:246-297`), because the messages are already correct.

The menu wiring is deleted entirely. We do not keep both surfaces — see Alternatives.

### Why Preferences

- Preferences is where macOS users expect "set up an optional integration" controls.
- The Settings panel is already schema-driven (`apps/desktop/src/components/settings-panel/index.tsx`), so adding a section is a small, additive change rather than a fork in UI conventions.
- A power user looking for the CLI will check `⌘,` first; placement there is more discoverable than buried in the app menu.

### Recommendation

**Move to Preferences and remove from the app menu.** The other options are weaker (see below).

## Alternatives Considered

### A. Hide entirely; require terminal install via docs

Rejected. The current menu item works without the user having to copy-paste a `ln -s` command, and removing it without a replacement makes the CLI feel hidden / unsupported. Keeping a UI affordance is cheap.

### B. Keep in menu but rename / shorten

Rejected. Even with a tighter label like `Install Command Line Tool…`, the Writer menu is still the wrong home for an optional power-user setup action — every user sees it on first launch. Renaming reduces the noise but does not fix the placement.

### C. Gate behind an "Advanced mode" toggle

Rejected for v1. We do not currently have an Advanced-mode concept and inventing one for a single action is over-engineering. If/when other power-user surfaces accumulate, revisit.

### D. Move it under Edit / Window / a new top-level menu

Rejected. Edit and Window have well-defined macOS conventions and a "Tools" menu would be a one-item menu just for this. Preferences is the natural home.

### E. Keep both menu and Preferences

Rejected. Two surfaces for the same action means we have to keep two refresh paths for the install state in sync. The menu refresh (`refresh_cli_menu` at `lib.rs:224`) already exists, but adding a second source of truth doubles the surface for bugs (e.g. user installs from Preferences, menu label is now stale) for no real win.

## Files Expected To Change

Backend (Rust):

- `apps/desktop/src-tauri/src/lib.rs` — delete `CLI_MENU_INSTALL_LABEL` / `CLI_MENU_UNINSTALL_LABEL` constants, `CliMenuItem` struct, `cli_item` build, `refresh_cli_menu`, `run_cli_toggle`, `run_cli_install`, `run_cli_uninstall`, and the `cli.toggle` event arm. Keep the IPC commands themselves and the success/error dialog text — both move to the frontend invocation path or are reused by it.
- The IPC commands `cli_status`, `install_cli`, `uninstall_cli` in `apps/desktop/src-tauri/src/commands/shell_install.rs` are unchanged.

Frontend (React):

- `apps/desktop/shared/settings.schema.json` — add a `Shell` section with one `action`-type entry for the CLI install/uninstall control. New entries do not need a `default` value because they are not stored, but schema validation in `apps/desktop/src-tauri/src/config.rs` may need a small allowance for the new type.
- `apps/desktop/src/lib/settings-schema.ts` — extend the `SettingDef.type` union to include `"action"` (mirrors the Rust side).
- `apps/desktop/src/components/settings-panel/setting-control.tsx` — add an `ActionControl` branch that calls a callback instead of writing a value.
- `apps/desktop/src/components/settings-panel/index.tsx` — wire the action handler for the CLI key. The handler `invoke`s `cli_status`, then either `install_cli` or `uninstall_cli`, then re-reads `cli_status` to refresh the button label. A small `useCliInstallStatus()` hook in `apps/desktop/src/hooks/use-cli-install-status.ts` keeps the logic out of the component (per project guideline that side effects live in hooks).
- Reuse the existing `tauri-plugin-dialog` to show the same success / failure dialogs. Or replace with inline status text under the row — see Open Questions.

Tests:

- Rust: `commands/shell_install.rs` already has unit tests for the symlink classification logic. Nothing to add or remove there since the install primitives are unchanged.
- Frontend: existing settings-panel tests, if any, should still pass. Add a test that the action button invokes the correct IPC command based on `cli_status.installed`.

Docs:

- `CHANGELOG.md` — note the move under user-visible changes when shipped.
- The Writer CLI spec ([`SPECs/writer-cli-spec.md`](./writer-cli-spec.md)) does not need an update; it already lists "macOS PATH-install menu item" as shipped, and that menu item is being repositioned, not removed in capability.

## Open Questions

- **Inline status vs dialog?** The current flow shows a system dialog ("The `writer` command is now installed at /usr/local/bin/writer …"). In Settings, an inline status line under the row may feel quieter and more native. Recommendation: keep the dialog on success the first time (so the user sees the install path and the example invocation) and rely on the live button label for subsequent state changes.
- **What about Linux / Windows?** Today `shell_install` is `#[cfg(target_os = "macos")]`. The Settings row should be conditionally hidden on non-macOS so we do not show a control that does nothing. This matches the current menu, which is already macOS-only.

## Acceptance Criteria

- The `Shell Command: Install 'writer' Command in PATH` menu item no longer appears in the Writer application menu on macOS.
- Preferences shows a `Shell` section with a single row that says `Writer command-line tool`, an explanatory line, and a button.
- Clicking `Install` runs the same install flow as the old menu item, including the elevation prompt when needed.
- Once installed, the button reads `Uninstall`, and clicking it removes the symlink.
- The status line / button text reflects the actual install state on Preferences open and after each click — no stale label.
- On Linux and Windows, the `Shell` section is not shown (or shows a one-liner explaining macOS-only support — TBD per Open Questions).
- No regression in the existing CLI install/uninstall behavior; existing Rust unit tests in `shell_install.rs` continue to pass.
