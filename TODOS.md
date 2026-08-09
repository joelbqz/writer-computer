# Tasks

## In Progress

- Reveal-in-sidebar + residual external-watcher misses: [`SPECs/reveal-in-sidebar-and-external-watcher-spec.md`](SPECs/reveal-in-sidebar-and-external-watcher-spec.md) — keep the explicit tab-context-menu "Reveal in sidebar" action working, leave ordinary file opens from expanding the Everything tree, and characterize the remaining external-file-watcher miss cases through a logging + manual-repro pass before patching further.

## Done

- Sidebar empty-space context menu: [`SPECs/statusbar-sidebar-visibility-spec.md`](SPECs/statusbar-sidebar-visibility-spec.md) — root New File and New Folder actions immediately create an available untitled entry and start inline rename; Search and Recents remain checked visibility items.
- Status bar + sidebar visibility toggles: [`SPECs/statusbar-sidebar-visibility-spec.md`](SPECs/statusbar-sidebar-visibility-spec.md) — hide/show each footer metric (words, characters, paragraphs) and the sidebar Search button and Recents section, via five new boolean settings and native right-click check-item menus on the footer and sidebar surface.
- Select-only Typography font controls: [`SPECs/font-select-spec.md`](SPECs/font-select-spec.md) — replace the AppKit Font panel and editable stack field with a standard installed-family `<select>` matching the other settings controls; default UI/editor to SF Pro and the renamed Code font setting to SF Mono.
- Native macOS font picker + Typography settings: [`SPECs/native-font-picker-spec.md`](SPECs/native-font-picker-spec.md) — replace the custom installed-font combobox with AppKit's system Font panel, route selections back to the originating settings row/window, preserve editable CSS fallback stacks, and rename the settings section from Fonts to Typography.
- Global font settings: [`SPECs/global-font-settings-spec.md`](SPECs/global-font-settings-spec.md) — the six per-mode `theme.{mode}.{ui,editor,mono}-font` settings become three global `fonts.{ui,editor,mono}` settings in a Typography section above the theme cards (fonts are typographic, not chromatic); startup migration adopts existing per-mode values (light wins, dark fallback) and drops the old keys. The font control is a single select-style pill (stack input + chevron in one surface).
- Obsidian image embeds: [`SPECs/obsidian-image-embed-spec.md`](SPECs/obsidian-image-embed-spec.md) — `![[image.png]]` renders inline via the wiki-link decorator; path targets resolve workspace- then note-relative, bare basenames fall back to an on-demand case-insensitive basename walk (`find_file_by_name`, shortest path wins), unresolved embeds show the raw source as a muted placeholder.
- Editor bug sweep — image widget scroll-height stability (per-URL measured-height cache + re-measure on decode), viewport force-parse on scroll so tree-derived decorations (list hanging indent, hide, fold) stop rendering stale in unparsed regions, and compact recents picker fixes (loading state before empty state, non-destructive prune, atomic saves, recording/display extension mismatch).
- LaTeX math rendering: [`SPECs/latex-math-spec.md`](SPECs/latex-math-spec.md) — KaTeX-render `$...$` inline and `$$...$$` display math through the fold-widget pattern (rendered when the selection is outside, raw source when touched), with Pandoc-style inline-`$` guards so currency amounts stay prose. Verified at runtime via a browser-driven editor harness (widgets render, currency stays literal, click-to-edit unfolds, refolds on caret move); `e2e/specs/latex-math.spec.js` covers the same flow for macOS harness runs.
- Font picker for theme font settings — new `font` setting type on the six `theme.{mode}.{ui,editor,mono}-font` entries: stack input plus a searchable popover of installed system fonts (Rust `list_system_fonts` via `fontdb`, cached, hidden dot-prefixed families filtered), previewed in each face; picking swaps the stack's primary family over the schema-default tail. Verified end-to-end via a new `e2e/specs/font-picker.spec.js` (see `apps/desktop/.claude/skills/verify/SKILL.md`).
- Configurable monospace code font — add a per-mode `theme.{mode}.mono-font` setting bound to a new `--mono-font` CSS variable; `--pm-code-font` and the remaining hardcoded code-font stacks (HTML block widgets, Mermaid source editor and error display) now resolve through it. Ported from upstream commit `6bb56f5`.
- Sidebar drag-and-drop move: [`SPECs/sidebar-drag-and-drop-move-spec.md`](SPECs/sidebar-drag-and-drop-move-spec.md) — drag files/folders in the `Everything` tree to re-parent them (drop on folder → inside, on file → its folder, on empty space → workspace root), with multi-select batches, open-tab/pin/expanded-state rewrites, and collision reporting. Pointer-event based so it coexists with the existing Finder-drop-to-open; inline rename and drag-move now share one write path (`use-move-entry`).
- Compact picker recents polish — add a plain non-hovering Recents label using sidebar section styling, remove the search field, per-row opened time, Open other file row, and active file entry, then keep the row remove affordance small so the picker is a direct global recents list.
- Global-scoped compact mode: [`SPECs/global-compact-mode-spec.md`](SPECs/global-compact-mode-spec.md) — compact windows are fully workspace-free (no root, no indexing, parent-dir single-file watcher), the picker shows a persisted global recent-files list, and the workspace-scoped compact setting is replaced by an "Open File in Compact Window" command.
- Compact picker trigger hit area — scope the closed trigger surface hover/focus state to the pill instead of the full picker-width wrapper.
- Compact picker trigger close hold — keep the closed trigger surface visible for 300ms after the picker close morph, then fade it with the picker opacity curve.
- Compact picker shadow fade — move the light-mode popover shadow to an opacity-animated layer so it fades out on close.
- Compact picker light trigger fill — make the light-mode compact trigger use a subtle gray tint instead of a near-white fill.
- Compact picker light shadow — add a subtle floating-card-style shadow to the compact picker popover in light mode.
- Compact picker timing — slow the picker morph and related content fades to 260ms while keeping the previous easing curve.
- Compact picker height cap — raise the compact navigator popover max height to 420px while keeping content-sized wrapping below the cap.
- Compact picker center anchoring — counter-scale the picker content from the horizontal center so the navigator stays centered while the popover expands.
- Compact footer polish — hide the document stats footer in compact chrome while leaving the normal workspace footer unchanged.
- Compact mode setting: [`SPECs/compact-mode-setting-spec.md`](SPECs/compact-mode-setting-spec.md) — make compact chrome a persisted appearance setting with a command-palette toggle, while removing the debug-only compact launch environment variable.
- Compact single-file window: [`SPECs/compact-window-spec.md`](SPECs/compact-window-spec.md) — use compact chrome for explicit single-file opens with no sidebar, no sidebar toggle, no tab strip, and a top dropdown that reuses Pinned, Recents, and Everything navigation.
- Website TanStack Start refactor: [`SPECs/website-tanstack-start-refactor-spec.md`](SPECs/website-tanstack-start-refactor-spec.md) — move the marketing website from a plain Vite SPA to TanStack Start routing/document/build structure while preserving the static Cloudflare deployment path.
- Floating card shadow polish — add a large subtle shadow to the shared command-palette/popover card surface.
- Sidebar sections redesign: [`SPECs/sidebar-sections-spec.md`](SPECs/sidebar-sections-spec.md) — split the sidebar into collapsible Pinned, Recents, and Everything sections; keep the existing file tree under Everything; add per-workspace pinned files and compact metadata-backed recent files with Show More pagination.
- Table virtualization scroll stability: [`SPECs/table-virtualization-scroll-stability-spec.md`](SPECs/table-virtualization-scroll-stability-spec.md) — give folded markdown table widgets stable CodeMirror height estimates so scrolling through virtualized documents with tables does not suddenly resize the document or scrollbar.
- Sidebar file label setting — add an `appearance.sidebar-file-label` enum (`title` | `filename`, default `title`) and have the sidebar file tree render the filename stem or the title-fallback chain accordingly. Also expose a "Rename..." action in the file context menu (files reuse the inline-rename flow folders already had).
- Desktop dev script — make the root `dev` script delegate to the desktop package's Tauri dev workflow and keep desktop build/preview scripts on Vite+ commands.
- Dependency lock refresh: [`SPECs/Agent/worksheet-dependency-lock-refresh.md`](SPECs/Agent/worksheet-dependency-lock-refresh.md) — refresh compatible Rust and JavaScript dependency lockfiles, including the `vite-plus` toolchain update, root TypeScript config alignment, and package-audit fixes.
- Default paragraph line height — make new and reset editor line-height settings use 1.8 instead of 1.6.
- List prefix interaction zones: [`SPECs/list-prefix-interaction-zones-spec.md`](SPECs/list-prefix-interaction-zones-spec.md) — constrain pre-body caret positions to line start, marker start, and body start, then make Backspace and multi-line Tab/Shift-Tab operate from those source zones.
- List selection geometry revamp: [`SPECs/list-selection-geometry-revamp-spec.md`](SPECs/list-selection-geometry-revamp-spec.md) — replace bullet/task point widgets plus zero-width hidden prefixes with measurable source-backed prefix marks so horizontal drag selection has stable hit-test geometry.
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
- [ ] Command palette dialog accessibility metadata — add the required dialog title/description wiring so opening the palette no longer emits Radix accessibility warnings at runtime.

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
