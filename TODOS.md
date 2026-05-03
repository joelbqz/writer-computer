# Tasks

## In Progress

- Landing page redesign: [`SPECs/landing-page-redesign-spec.md`](SPECs/landing-page-redesign-spec.md) — Figma "Writer Computer" frame implemented under `apps/website/` (single-page React + Vite, dark, SF Pro, single orange accent). Remaining: real screenshots into `apps/website/public/screenshots/`, custom-domain decision, copy review. Supersedes `SPECs/landing-page-spec.md`.

## Up Next

## Blockers At A Glance

- `workspace-snapshot` → `workspace-switch-hang` (shipped; blocker cleared — snapshot depends on the primitives that landed)
- `fuzzy-search-grep` → `gitignore-aware-workspace` (shipped; blocker cleared)
- `tags` → `gitignore-aware-workspace` (shipped; blocker cleared)

## Backlog

Previously-triaged work organized by phase. Pull into `Up Next` as capacity opens.

### Content features

- Heading anchor links: [`SPECs/heading-anchor-links-spec.md`](SPECs/heading-anchor-links-spec.md)
- Fuzzy content search and grep: [`SPECs/fuzzy-search-grep-spec.md`](SPECs/fuzzy-search-grep-spec.md)
- Tags: [`SPECs/tags-spec.md`](SPECs/tags-spec.md)
- New tab recent files: [`SPECs/new-tab-recent-files-spec.md`](SPECs/new-tab-recent-files-spec.md)
- Document date display: [`SPECs/document-date-display-spec.md`](SPECs/document-date-display-spec.md)
- Breadcrumb: [`SPECs/breadcrumb-spec.md`](SPECs/breadcrumb-spec.md)

### Visual and media polish

- Section indicators: [`SPECs/section-indicators-spec.md`](SPECs/section-indicators-spec.md)
- Body theming: [`SPECs/body-theming-spec.md`](SPECs/body-theming-spec.md)
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

- Obsidian-style wikilink parsing: [`SPECs/obsidian-wikilink-parsing-spec.md`](SPECs/obsidian-wikilink-parsing-spec.md) — aliases, escaped table pipes, note fragments, and same-file fragment links now resolve like Obsidian. (`cf3d753`)
- Sidebar toggle tab chrome shift: [`SPECs/sidebar-toggle-tab-chrome-shift-spec.md`](SPECs/sidebar-toggle-tab-chrome-shift-spec.md)
- Rename bundled Codex theme preset to Writer.
- Recent workspaces Dock menu: [`SPECs/recent-workspaces-dock-menu-spec.md`](SPECs/recent-workspaces-dock-menu-spec.md) — right-clicking the macOS Dock icon now shows existing recent workspaces above the default Dock menu items; choosing one opens a new workspace window or focuses an existing one.
- Editor search lifecycle refactor: [`SPECs/editor-search-lifecycle-spec.md`](SPECs/editor-search-lifecycle-spec.md) — closes CodeMirror and React search state together, clears stale editor views on close/unmount, and updates CodeMirror from input events instead of a query-sync render effect.

- Theming system: [`SPECs/theming-system-spec.md`](SPECs/theming-system-spec.md) — CSS-var-driven primaries (accent, bg, fg, fonts, translucency, contrast) per light/dark mode with derived overlays. Supersedes `body-theming-spec.md`.
- Multi-window v1 (single-process, per-window state): [`SPECs/multi-window-spec.md`](SPECs/multi-window-spec.md) — opening a workspace builds a new `WebviewWindow` in the same process; per-window `WorkspaceState` keyed by window label isolates the watcher, file index, settings, and pending-open queue.
- Tabbed pages (settings in a tab + page-kind registry): [`SPECs/tabbed-pages-spec.md`](SPECs/tabbed-pages-spec.md)
- Frontmatter edit flow: [`SPECs/frontmatter-edit-flow-spec.md`](SPECs/frontmatter-edit-flow-spec.md)
- Editor shortcut clashes + markdown formatting keymap: [`SPECs/editor-shortcuts-clash-spec.md`](SPECs/editor-shortcuts-clash-spec.md)
- Editor context menu Format/Paragraph/Insert submenus: [`SPECs/editor-context-menu-submenus-spec.md`](SPECs/editor-context-menu-submenus-spec.md)
- Extensionless markdown links: [`SPECs/extensionless-markdown-links-spec.md`](SPECs/extensionless-markdown-links-spec.md)
- Mermaid diagrams: [`SPECs/mermaid-diagrams-spec.md`](SPECs/mermaid-diagrams-spec.md)
- Editor tab switch performance: [`SPECs/editor-tab-switch-performance-spec.md`](SPECs/editor-tab-switch-performance-spec.md) — tab-keyed panes, smoother pane activation/focus behavior, and watcher/save coordination to avoid tab-close and reload hitches.
- Local-only macOS E2E smoke test via Choochmeque/tauri-webdriver — `apps/desktop/e2e/`
- Draft workspace visual redesign spec: `SPECs/workspace-visual-redesign-spec.md`
- Implement workspace visual redesign from `SPECs/workspace-visual-redesign-spec.md`
- Phase 1:
  - Auto update app: `SPECs/auto-update-spec.md`
  - Titlebar double-click zoom: `SPECs/titlebar-double-click-zoom-spec.md`
  - Remove saving indicator + tab dirty dot: `SPECs/remove-saving-indicator-spec.md`
  - Scrollbar layout shift fix: `SPECs/scrollbar-layout-shift-fix-spec.md`
  - Scroll active tab into view: `SPECs/tab-scroll-into-view-spec.md`
  - Hide sidebar handle: `SPECs/hide-sidebar-handle-spec.md`
- Phase 2:
  - Sidebar file context menu: `SPECs/sidebar-file-context-menu-spec.md`
  - Gitignore-aware workspace: `SPECs/gitignore-aware-workspace-spec.md`
- Reduce document open latency: `SPECs/document-open-latency-spec.md`
- Improve cold-start startup performance: bundled `restore_workspace` IPC, pre-resolved `restore_target`, skeleton-shell rendering, and dev-only startup telemetry
- Phase 3:
  - Sidebar folder context menu: `SPECs/sidebar-folder-context-menu-spec.md`
  - Editor context menu: `SPECs/editor-context-menu-spec.md`
  - Sidebar bulk actions: `SPECs/sidebar-bulk-actions-spec.md`
  - Craft-style sidebar: `SPECs/craft-style-sidebar-spec.md`
  - Keyboard and accessibility pass: `SPECs/keyboard-and-accessibility-spec.md`
- Workspace switch hang fix: `SPECs/workspace-switch-hang-spec.md`
- Writer open CLI: [`SPECs/writer-open-cli-spec.md`](SPECs/writer-open-cli-spec.md) — `writer-cli` binary + shared `open_target` module, plus macOS PATH-install menu item and bundle-resource staging.
