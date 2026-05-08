# Tasks

## In Progress

- Mermaid canvas widget: [`SPECs/mermaid-canvas-widget-spec.md`](SPECs/mermaid-canvas-widget-spec.md) — render mermaid blocks in a fixed-height canvas-style frame with pan, zoom, and an edit-code toggle.

## Done

- Mermaid drag-selection edit-mode flip: [`SPECs/mermaid-drag-selection-edit-mode-flip-spec.md`](SPECs/mermaid-drag-selection-edit-mode-flip-spec.md) — freeze `editMode` for the duration of a pointer drag-selection so the widget doesn't flip into source view mid-drag.

## Up Next

-

## Backlog

Previously-triaged work organized by phase. Pull into `Up Next` as capacity opens.

### Content features

- Heading anchor links: [`SPECs/heading-anchor-links-spec.md`](SPECs/heading-anchor-links-spec.md)
- Fuzzy content search and grep: [`SPECs/fuzzy-search-grep-spec.md`](SPECs/fuzzy-search-grep-spec.md)
- Tags: [`SPECs/tags-spec.md`](SPECs/tags-spec.md)
- New tab recent files: [`SPECs/new-tab-recent-files-spec.md`](SPECs/new-tab-recent-files-spec.md)
- Document date display: [`SPECs/document-date-display-spec.md`](SPECs/document-date-display-spec.md)

### Visual and media polish

- Section indicators: [`SPECs/section-indicators-spec.md`](SPECs/section-indicators-spec.md)
- Inline media preview: [`SPECs/inline-media-preview-spec.md`](SPECs/inline-media-preview-spec.md)
- Obsidian image embed: [`SPECs/obsidian-image-embed-spec.md`](SPECs/obsidian-image-embed-spec.md)

### Architectural bets

- Archive files: [`SPECs/archive-files-spec.md`](SPECs/archive-files-spec.md) — medium risk. Adds a parallel storage area and a purge job.
- Multi window (v1 shipped — single-process multi-window): [`SPECs/multi-window-spec.md`](SPECs/multi-window-spec.md). Future work: macOS Window menu listing open workspaces, session restore of all open windows at quit, tab tear-off across windows.
- Custom MCP: [`SPECs/custom-mcp-spec.md`](SPECs/custom-mcp-spec.md) — **high risk**. New protocol client, trust model, and tool invocation surface.
- Writer CLI: [`SPECs/writer-cli-spec.md`](SPECs/writer-cli-spec.md) — standalone second binary; can slot in whenever convenient.

### Performance and resilience

- Slow storage resilience: [`SPECs/slow-storage-resilience-spec.md`](SPECs/slow-storage-resilience-spec.md) — async title extraction + bounded timeout so iCloud / Dropbox / network-mount workspaces stay responsive. Storage-agnostic, no provider-specific path lists.
- Workspace snapshot: [`SPECs/workspace-snapshot-spec.md`](SPECs/workspace-snapshot-spec.md) — architectural cleanup of `AppState` into a single versioned `Arc<Snapshot>` with inode-keyed entries and watcher-maintained titles. Follow-up to the workspace-switch-hang fix; pull in only if the current epoch/cancel primitives prove insufficient or if tags / new-tab-recents want the richer metadata.

## Done

See `CHANGELOG.md` and `git log` for shipped work. Notable items:

- Cmd+F polish: safe scroll-into-view, Cmd+G / Cmd+Shift+G next/previous, scrollbar match overview ([`SPECs/cmd-f-spec.md`](SPECs/cmd-f-spec.md))
- Caret position after history navigation
- Obsidian-style wikilink parsing — aliases, escaped table pipes, note fragments, same-file fragment links
- Sidebar toggle tab chrome shift
- Rename bundled Codex theme preset to Writer
- Recent workspaces Dock menu
- Editor search lifecycle refactor
- Theming system — CSS-var-driven primaries (accent, bg, fg, fonts, translucency, contrast) per light/dark mode
- Multi-window v1 (single-process, per-window state): [`SPECs/multi-window-spec.md`](SPECs/multi-window-spec.md) — `WorkspaceState` keyed by window label isolates watcher, file index, settings, pending-open queue
- Tabbed pages (settings in a tab + page-kind registry)
- Frontmatter edit flow
- Editor shortcut clashes + markdown formatting keymap
- Editor context menu (incl. Format/Paragraph/Insert submenus)
- Extensionless markdown links
- Mermaid diagrams
- Editor tab switch performance — tab-keyed panes, watcher/save coordination
- Local-only macOS E2E smoke test via Choochmeque/tauri-webdriver — `apps/desktop/e2e/`
- Workspace visual redesign
- Auto update, titlebar double-click zoom, scrollbar layout shift fix, scroll active tab into view, hide sidebar handle, remove saving indicator + tab dirty dot
- Sidebar file/folder context menus, sidebar bulk actions, craft-style sidebar
- Gitignore-aware workspace
- Reduce document open latency
- Cold-start startup performance — bundled `restore_workspace` IPC, pre-resolved `restore_target`, skeleton-shell rendering, dev-only startup telemetry
- Keyboard and accessibility pass
- Workspace switch hang fix
- Writer open CLI — `writer-cli` binary + shared `open_target` module, macOS PATH-install menu item, bundle-resource staging
