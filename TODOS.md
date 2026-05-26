# Tasks

## In Progress

- Reveal-in-sidebar + residual external-watcher misses: [`SPECs/reveal-in-sidebar-and-external-watcher-spec.md`](SPECs/reveal-in-sidebar-and-external-watcher-spec.md) — fix the broken tab-context-menu "Reveal in sidebar" action, auto-reveal newly opened files in the sidebar tree, and characterize the remaining external-file-watcher miss cases through a logging + manual-repro pass before patching further.

## Done

- Default paragraph line height — make new and reset editor line-height settings use 1.8 instead of 1.6.
- Table cell link regressions: [`SPECs/table-cell-link-regressions-spec.md`](SPECs/table-cell-link-regressions-spec.md) — keep rendered table-cell links clickable without unfolding the table, and render Obsidian wiki links with table-escaped aliases correctly.
- Table cell markdown preview: [`SPECs/table-cell-markdown-preview-spec.md`](SPECs/table-cell-markdown-preview-spec.md) — render inline markdown inside folded table preview cells instead of showing the raw markdown delimiters.
- Table unfold codeblock display: [`SPECs/table-unfold-codeblock-spec.md`](SPECs/table-unfold-codeblock-spec.md) — render touched table markdown as codeblock-styled source lines in the main editor instead of plain prose.
- Markdown heading top padding: [`SPECs/heading-top-padding-spec.md`](SPECs/heading-top-padding-spec.md) — inject a shared editor heading class and use it to add 1rem top padding to Markdown headings.
- Sidebar hover and active foreground polish — make sidebar icons and labels use full foreground color on hover, selection, and active states.
- Code block editor font size — make fenced Markdown code blocks and inline code follow the editor font-size setting.
- Link and image paths with spaces: [`SPECs/link-paths-with-spaces-spec.md`](SPECs/link-paths-with-spaces-spec.md) — make Markdown links/images and existing wiki-style link resolution work when labels, aliases, folders, filenames, or generated asset paths contain spaces.
- Empty list caret visibility: [`SPECs/empty-list-caret-spec.md`](SPECs/empty-list-caret-spec.md) — keep the caret visible at the body column on empty bullet and task-list items whose source marker is hidden by the list-prefix renderer.
- List selection and TODO checkbox regression: [`SPECs/list-selection-todo-checkbox-regression-spec.md`](SPECs/list-selection-todo-checkbox-regression-spec.md) — replace list-prefix replace widgets with point widgets to stop selection/caret snaps, and render TODO checkboxes as a single non-native span so drag-selection and nested alignment work.
- Mermaid canvas widget: [`SPECs/mermaid-canvas-widget-spec.md`](SPECs/mermaid-canvas-widget-spec.md) — render mermaid blocks in a fixed-height canvas-style frame with pan, zoom, reset-to-fit, and an edit-code toggle.
- Mermaid fullscreen diagram: [`SPECs/mermaid-fullscreen-diagram-spec.md`](SPECs/mermaid-fullscreen-diagram-spec.md) — expand button on the canvas opens the diagram in a viewport-sized `<dialog>` with reused pan/zoom controls.
- Heading anchor links: [`SPECs/heading-anchor-links-spec.md`](SPECs/heading-anchor-links-spec.md) — GFM slugger, same-doc smooth scroll, cross-doc navigate+scroll, inline warning on unresolved anchors.
- Section indicators: [`SPECs/section-indicators-spec.md`](SPECs/section-indicators-spec.md) — left-edge rail of heading ticks with active-heading tracking, hover outline popover, click-to-scroll, and right-click `Copy heading link`.
- Mermaid drag-selection edit-mode flip: [`SPECs/mermaid-drag-selection-edit-mode-flip-spec.md`](SPECs/mermaid-drag-selection-edit-mode-flip-spec.md) — freeze `editMode` for the duration of a pointer drag-selection so the widget doesn't flip into source view mid-drag.

## Up Next

-

## Backlog

Previously-triaged work organized by phase. Pull into `Up Next` as capacity opens.

#### Content features

- [ ] Fuzzy content search and grep: [`SPECs/fuzzy-search-grep-spec.md`](SPECs/fuzzy-search-grep-spec.md)
- [ ] Tags: [`SPECs/tags-spec.md`](SPECs/tags-spec.md)
- [ ] New tab recent files: [`SPECs/new-tab-recent-files-spec.md`](SPECs/new-tab-recent-files-spec.md)
- [ ] Document date display: [`SPECs/document-date-display-spec.md`](SPECs/document-date-display-spec.md)

#### Visual and media polish

- [ ] Inline media preview: [`SPECs/inline-media-preview-spec.md`](SPECs/inline-media-preview-spec.md)
- [ ] Obsidian image embed: [`SPECs/obsidian-image-embed-spec.md`](SPECs/obsidian-image-embed-spec.md)

#### Architectural bets

- [ ] Archive files: [`SPECs/archive-files-spec.md`](SPECs/archive-files-spec.md) — medium risk. Adds a parallel storage area and a purge job.
- [ ] Multi window (v1 shipped — single-process multi-window): [`SPECs/multi-window-spec.md`](SPECs/multi-window-spec.md). Future work: macOS Window menu listing open workspaces, session restore of all open windows at quit, tab tear-off across windows.
- [ ] Custom MCP: [`SPECs/custom-mcp-spec.md`](SPECs/custom-mcp-spec.md) — **high risk**. New protocol client, trust model, and tool invocation surface.
- [ ] Writer CLI: [`SPECs/writer-cli-spec.md`](SPECs/writer-cli-spec.md) — standalone second binary; can slot in whenever convenient.

#### Performance and resilience

- [ ] Slow storage resilience: [`SPECs/slow-storage-resilience-spec.md`](SPECs/slow-storage-resilience-spec.md) — async title extraction + bounded timeout so iCloud / Dropbox / network-mount workspaces stay responsive. Storage-agnostic, no provider-specific path lists.
- [ ] Workspace snapshot: [`SPECs/workspace-snapshot-spec.md`](SPECs/workspace-snapshot-spec.md) — architectural cleanup of `AppState` into a single versioned `Arc<Snapshot>` with inode-keyed entries and watcher-maintained titles. Follow-up to the workspace-switch-hang fix; pull in only if the current epoch/cancel primitives prove insufficient or if tags / new-tab-recents want the richer metadata.

## Done

See `CHANGELOG.md` and `git log` for shipped work. Notable items:

- [x] External file watcher: external file changes (Finder, git, vim, scripts) reach the sidebar and reload-from-disk reliably; dotdir workspace roots, `/var` aliases, and self-write echoes all fixed ([`SPECs/external-file-watcher-spec.md`](SPECs/external-file-watcher-spec.md))
- [x] Cmd+F polish: safe scroll-into-view, Cmd+G / Cmd+Shift+G next/previous, scrollbar match overview ([`SPECs/cmd-f-spec.md`](SPECs/cmd-f-spec.md))
- [x] Caret position after history navigation
- [x] Obsidian-style wikilink parsing — aliases, escaped table pipes, note fragments, same-file fragment links
- [x] Sidebar toggle tab chrome shift
- [x] Rename bundled Codex theme preset to Writer
- [x] Recent workspaces Dock menu
- [x] Editor search lifecycle refactor
- [x] Theming system — CSS-var-driven primaries (accent, bg, fg, fonts, translucency, contrast) per light/dark mode
- [x] Multi-window v1 (single-process, per-window state): [`SPECs/multi-window-spec.md`](SPECs/multi-window-spec.md) — `WorkspaceState` keyed by window label isolates watcher, file index, settings, pending-open queue
- [x] Tabbed pages (settings in a tab + page-kind registry)
- [x] Frontmatter edit flow
- [x] Editor shortcut clashes + markdown formatting keymap
- [x] Editor context menu (incl. Format/Paragraph/Insert submenus)
- [x] Extensionless markdown links
- [x] Mermaid diagrams
- [x] Editor tab switch performance — tab-keyed panes, watcher/save coordination
- [x] Local-only macOS E2E smoke test via Choochmeque/tauri-webdriver — `apps/desktop/e2e/`
- [x] Workspace visual redesign
- [x] Auto update, titlebar double-click zoom, scrollbar layout shift fix, scroll active tab into view, hide sidebar handle, remove saving indicator + tab dirty dot
- [x] Sidebar file/folder context menus, sidebar bulk actions, craft-style sidebar
- [x] Gitignore-aware workspace
- [x] Reduce document open latency
- [x] Cold-start startup performance — bundled `restore_workspace` IPC, pre-resolved `restore_target`, skeleton-shell rendering, dev-only startup telemetry
- [x] Keyboard and accessibility pass
- [x] Workspace switch hang fix
- [x] Writer open CLI — `writer-cli` binary + shared `open_target` module, macOS PATH-install menu item, bundle-resource staging
