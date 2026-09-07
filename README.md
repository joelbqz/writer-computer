# Writer

Fast and lightweight app for your workspace's markdown files

![Writer](./assets/screenshot.png)

It is built with Tauri v2, React, Zustand, CodeMirror, and Rust. The app keeps documents on disk, respects workspace `.gitignore` rules, supports multiple windows, renders extended markdown such as tables and Mermaid diagrams, and ships with a signed macOS release flow.

## Repository

- `apps/desktop/` — Tauri desktop app.
- `apps/desktop/src/` — React frontend.
- `apps/desktop/src-tauri/src/` — Rust commands, workspace state, watcher, updater, and CLI integration.
- `apps/website/` — landing page.
- `docs/` — project and agent workflow docs.
- `SPECs/` — feature specs and design notes.

## Development

This repo uses Vite+ through the `vp` CLI. Use `vp` instead of calling the package manager or Vite tooling directly.

```bash
vp install
vp dev
```

## Validation

```bash
vp check
vp test
```

Rust validation runs from the Tauri crate:

```bash
cd apps/desktop/src-tauri
cargo test
cargo clippy
cargo fmt --check
```

## Privacy

Writer is local-first and stays that way. It ships opt-in usage telemetry that
is **off until you turn it on**, never sees your documents, file names, or
paths, and is not even compiled into builds made from a clone of this repo.
[`docs/telemetry.md`](./docs/telemetry.md) lists every event and property, and
the three independent ways to keep it off.

## Releases

macOS releases are cut locally with `scripts/distribute.sh`. See `docs/releasing.md` for the signed, notarized release workflow and updater publishing details.
