# Status bar metrics and sidebar section visibility

## Problem

The document footer always shows all three metrics (words, characters,
paragraphs), and the sidebar always shows the Search button and the Recents
section. Writers who want a quieter chrome have no way to hide any of them.

## Behavior

### Settings

Five new boolean settings in `settings.schema.json`, all defaulting to `true`
and persisted at global scope:

- `statusbar.show-words`, `statusbar.show-characters`,
  `statusbar.show-paragraphs` — category **Status Bar** (renders after the
  Editor section in Preferences via the schema-driven panel).
- `appearance.sidebar-show-search`, `appearance.sidebar-show-recents` —
  category **Appearance**.

No settings-panel code changes: the generic boolean control renders them.

### Status bar

- `DocumentFooter` renders only the metrics whose setting is on. When all
  three are off, the footer element is not rendered at all.
- Right-clicking the footer opens a native context menu (same
  `build…Spec` + `Menu.popup()` pattern as the sidebar file menus) listing
  **every** metric as a check item — checked = visible — so a hidden metric
  can be re-shown from the same menu, not only from Settings. Toggles write
  through the settings store, so Preferences stays in sync.
- The metric list (setting key ↔ stat key ↔ labels) lives once in
  `FOOTER_METRICS` (`footer-context-menu.ts`); the footer and the menu both
  iterate it.

### Sidebar

- The Search button hides when `appearance.sidebar-show-search` is off; the
  Recents section hides when `appearance.sidebar-show-recents` is off
  (regardless of recent files existing).
- Right-clicking the sidebar surface — empty space, section headers
  (including the Recents title), or the search button — opens a native
  context menu with root-level **New File** and **New Folder** actions,
  followed by the Search and Recents check items. Each create action
  immediately creates the next available `Untitled.md` or `Untitled Folder`
  directly under the current workspace root, refreshes Everything, and starts
  inline rename. File and folder rows keep their existing menus (they stop
  propagation, so the surface menu never fires for them).
- Inline rename accepts one visible basename only. Path separators, traversal
  names, and leading-dot names remain in the rename flow with an explicit
  validation error instead of moving the entry outside the workspace or
  hiding it from the tree.
- Newly created empty folders remain visible in Everything so the action has
  an immediately usable result. Directories containing only non-Markdown
  content remain filtered as before.
- Hiding Recents does not clear recents metadata; re-enabling restores the
  section as it was.

### Typing note

`SettingsMap` cannot type boolean settings as `boolean` (TypeScript widens
JSON imports, so the `"type": "boolean"` literal never narrows). Boolean
reads go through a new `useBooleanSetting(key, fallback = true)` hook that
narrows at runtime, replacing ad-hoc `as boolean | undefined` casts.

## Verification

- Unit tests for both menu spec builders (`footer-context-menu.test.ts`,
  `sidebar-surface-context-menu.test.ts`), including surface-menu action order
  and handler dispatch; the mixed native item renderer; root-name validation;
  and the file/folder create, refresh, open, and failure sequences.
- Runtime: `e2e/specs/visibility-settings.spec.js` drives the built app —
  default metric set, single-metric hide, all-hidden footer removal, Search
  button hide, Recents section hide. Native menu popups themselves are
  OS-level and not driveable from WebDriver; the menus' actions share the
  `setSetting` write path the e2e spec exercises.
