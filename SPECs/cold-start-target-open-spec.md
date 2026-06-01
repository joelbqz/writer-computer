# Cold-Start Target Open

## Summary

When Writer is not running and is launched with a concrete file or folder target, that launch target should be authoritative. Startup must not restore the most recent workspace or any prior tab session. It should open only the requested folder or markdown file.

## Entry Points

- `writer <folder>`
- `writer <file.md>`
- OS file/folder open routed to the app during cold start, including drag-to-app/dock open events that seed the pending-open queue before the webview hydrates

## Behavior

- Folder launch opens that folder as the workspace and shows the launcher tab instead of restoring the folder's saved tab session.
- File launch opens the file's parent folder as the workspace and opens exactly that file.
- File launch starts with the sidebar closed, regardless of the persisted sidebar visibility setting for normal launches.
- Launch target handling happens through the existing Rust pending-open payload returned by `get_startup_state`, before React renders the app shell.
- Runtime opens while Writer is already running keep the existing multi-window behavior.

## Implementation Notes

- Keep `PendingOpenPayload` as the single launch-target shape shared by CLI, drag/drop, dock-open, Rust startup, and frontend startup.
- When `get_startup_state` sees a pending-open payload, build the restore bundle for that workspace in target-only mode: read root entries and recents, prefetch the target file when present, and intentionally skip session restore.
- The frontend should hydrate the workspace bundle with the pending-open payload so target launches do not flow through normal session restoration.
- Cold-start OS open events with no matching workspace should seed the empty main window's pending-open queue instead of spawning a secondary window.

## Validation

- Unit tests cover target-only bundle hydration for folder and file launches.
- Unit tests cover the single-file sidebar visibility override.
- Existing frontend and Rust validation should continue to pass.
