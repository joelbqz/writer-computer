# Install CLI Menu Placement Spec

## Summary

The "Install 'writer' Command in PATH" action is the third item in the macOS **Writer** application menu, with a long jargon-heavy label that confuses users who do not need a CLI. We will keep the action in the app menu (where macOS users expect optional, app-wide setup items) and place a conventional **Preferences…** entry alongside it, so the menu reads like a standard macOS app menu rather than a one-off pile of items. Tightening the CLI item's label and grouping reduces the noise without hiding the feature from the power users who want it.

## Background

The CLI install action is wired in `apps/desktop/src-tauri/src/lib.rs:160` and added to the `Writer` submenu at line 168. The label cycles between two strings defined at `lib.rs:28-30`:

- `Shell Command: Install 'writer' Command in PATH`
- `Shell Command: Uninstall 'writer' Command in PATH`

The underlying Rust install/uninstall logic lives in `apps/desktop/src-tauri/src/commands/shell_install.rs` and is exposed via three Tauri IPC commands already registered in `lib.rs`: `cli_status`, `install_cli`, `uninstall_cli`.

Settings exists today as a tab opened by the `open-settings` command in the command palette (`apps/desktop/src/components/command-palette/index.tsx:152`) using the `useOpenSettingsTab` hook in `apps/desktop/src/hooks/use-tabs.ts:162`. There is no app-menu entry for it. The keyboard shortcut convention on macOS for Preferences is `⌘,`.

For context on the CLI itself, see [`SPECs/writer-cli-spec.md`](./writer-cli-spec.md). The PATH-install menu item shipped alongside the `writer` open CLI (see `Done` in `TODOS.md`).

## Problem Statement

The Writer app menu currently looks like this on macOS:

```
Writer
  About Writer
  ─────
  Check for Updates…
  ─────
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

Two things go wrong here:

1. **The CLI label is long, jargon-heavy, and prefixed with `Shell Command:`.** A non-developer writer reading down the menu sees `PATH` and stops. The current copy is doing the work of a tooltip rather than a menu item.
2. **There is no Preferences entry.** macOS users instinctively reach for the app menu (or `⌘,`) for app-wide settings. We have a Preferences surface — a Settings tab — but it is currently only reachable from the command palette. That makes the CLI item feel even more out of place: it is the only "optional setup" item in a menu that has no normal-setup item to anchor it.

## Current Behavior

- App-menu wiring: `apps/desktop/src-tauri/src/lib.rs:160-168` (build), `lib.rs:213-218` (event handler), `lib.rs:224-234` (label refresh on state change).
- `run_cli_toggle` at `lib.rs:237` calls `install_cli` / `uninstall_cli`.
- Settings tab is opened only via the command palette's `open-settings` command, which calls `useOpenSettingsTab` (`apps/desktop/src/hooks/use-tabs.ts:162`).
- No `⌘,` accelerator is registered anywhere in the app menu today.

## Proposed Change

Keep the CLI install action in the Writer app menu. Add a conventional macOS Preferences entry to the same menu. Tighten the CLI label and grouping so the menu reads cleanly.

### New menu structure

```
Writer
  About Writer
  ─────
  Check for Updates…
  ─────
  Preferences…                                   ⌘,
  Install 'writer' Command Line Tool…
  ─────
  Services
  ─────
  Hide Writer
  Hide Others
  Show All
  ─────
  Quit Writer
```

Notes:

- **`Preferences…`** with the standard `⌘,` accelerator. Opens the existing Settings tab.
- **`Install 'writer' Command Line Tool…`** — drops the `Shell Command:` prefix and the `in PATH` postfix. Trailing ellipsis indicates the action prompts the user (admin authorization). When the symlink already exists the label flips to `Uninstall 'writer' Command Line Tool…`, matching the existing toggle behavior.
- Both items live in the same group between `Check for Updates…` and `Services`. This is the conventional macOS slot for app-level preferences and optional integrations, and it gives the CLI item company instead of leaving it as the only oddity.

### Wiring Preferences from Rust → React

The menu handler cannot directly call the React-side `useOpenSettingsTab` hook. The cheapest way is to emit a Tauri event from the menu handler and listen for it in the frontend:

- Add a new menu event id `preferences.open`.
- In `app.on_menu_event` (`lib.rs:213`), match the new id and `app.emit("menu:open-preferences", ())` (or per-window equivalent so multi-window works).
- In the React app shell (`apps/desktop/src/components/app-layout.tsx` or a new small hook `apps/desktop/src/hooks/use-menu-events.ts`), subscribe via `listen("menu:open-preferences", …)` and call `useOpenSettingsTab`.

Per project guideline, the listener subscription lives in a custom hook, not inside a component's `useEffect`.

### Recommendation

**Keep the CLI item in the app menu, add Preferences alongside, retitle the CLI item.** This was the user's chosen direction; the alternatives below were considered and rejected.

## Alternatives Considered

### A. Move the CLI install into Preferences and remove from menu

Earlier draft of this spec. Rejected: it makes the feature less discoverable for the audience that actually wants it (power users open the app menu first), and leaves the app menu with a non-standard shape (no Preferences entry). The user explicitly chose to keep both items in the app menu.

### B. Hide the CLI item entirely; require terminal install via docs

Rejected. The current menu item works without making the user copy-paste a `ln -s` invocation. Removing it without a replacement makes the CLI feel hidden / unsupported.

### C. Keep the long original label

Rejected. The label was the most-cited source of confusion ("Shell Command:", "PATH"). Tightening to `Install 'writer' Command Line Tool…` keeps the meaning intact while reading like a normal menu item.

### D. Put the CLI item under a dedicated "Tools" top-level menu

Rejected. A top-level menu with a single item is awkward and adds chrome before any second item lands.

### E. Gate the CLI item behind an "Advanced mode" toggle

Rejected for v1. We do not have an Advanced-mode concept and inventing one for a single action is over-engineering. Keep the door open for later if other power-user surfaces accumulate.

## Files Expected To Change

Backend (Rust) — only `lib.rs`; install/uninstall primitives are unchanged:

- `apps/desktop/src-tauri/src/lib.rs`:
  - Update `CLI_MENU_INSTALL_LABEL` / `CLI_MENU_UNINSTALL_LABEL` to the new strings (`Install 'writer' Command Line Tool…` / `Uninstall 'writer' Command Line Tool…`).
  - Add a new `Preferences…` menu item with `⌘,` accelerator and id `preferences.open`, inserted just before the CLI item in the `Writer` submenu builder (around `lib.rs:160-168`).
  - Add an event arm in `app.on_menu_event` (`lib.rs:213`) that emits `menu:open-preferences` to the focused window.
- `apps/desktop/src-tauri/src/commands/shell_install.rs` — unchanged.

Frontend (React):

- `apps/desktop/src/hooks/use-menu-events.ts` (new) — subscribes to `menu:open-preferences` and calls `useOpenSettingsTab`. Per project rule, the `listen()` subscription lives in this hook, not inline in a component.
- `apps/desktop/src/components/app-layout.tsx` — call the new hook once at the top level so the listener is mounted for the lifetime of the window.

Tests:

- Rust: existing unit tests in `commands/shell_install.rs` continue to pass; no new Rust tests needed since menu-handler logic is a one-liner emit.
- Frontend: add a test that the new hook opens the settings tab in response to a synthesized `menu:open-preferences` event.

Docs:

- `CHANGELOG.md` — note the relabel and the new Preferences menu entry under user-visible changes when shipped.
- The Writer CLI spec ([`SPECs/writer-cli-spec.md`](./writer-cli-spec.md)) does not need an update; the menu item moves slot and gets a new label but its capability is unchanged.

## Open Questions

- **Multi-window behavior:** the existing menu handler runs against `AppHandle` not a specific window. Confirm the `menu:open-preferences` event is routed to the focused window (e.g., `app.get_focused_window()` or `WebviewWindow::emit`) so Preferences opens in the correct workspace tab strip rather than every window at once.
- **Linux / Windows:** today `shell_install` is `#[cfg(target_os = "macos")]`, so the Install CLI item is macOS-only. The new Preferences entry should appear on all desktop platforms; confirm the rest of the app menu builder is reused on non-macOS or whether platform-specific branches are needed.

## Acceptance Criteria

- The Writer app menu on macOS contains, in order: `About Writer`, separator, `Check for Updates…`, separator, `Preferences…` (`⌘,`), `Install 'writer' Command Line Tool…`, separator, `Services`, …, `Quit Writer`.
- `Preferences…` opens the existing Settings tab in the focused window. The keyboard shortcut `⌘,` does the same.
- The CLI item's label is `Install 'writer' Command Line Tool…` when the symlink is missing, and `Uninstall 'writer' Command Line Tool…` when it is installed. Toggling continues to refresh the label correctly.
- Clicking the CLI item runs the same install/uninstall flow as today, including the elevation prompt and success/error dialogs.
- Existing Rust unit tests in `shell_install.rs` continue to pass.
- No regression: the command-palette `open-settings` entry continues to work.
