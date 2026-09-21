# View Zoom Shortcuts

## Goal

A presenter who mirrors Writer in a meeting needs Cmd++ to make everything bigger, the way it does in a browser, Obsidian, or VS Code. Today nothing happens. Add whole-window zoom driven by the standard macOS chords, remembered across launches, with a palette entry and a Preferences row so it is discoverable and reversible.

## Mechanism

**Chosen: whole-window webview zoom** (`WKWebView.pageZoom` through Tauri's `Webview::set_zoom`, reached from JS via `getCurrentWebview().setZoom()` and the `core:webview:allow-set-webview-zoom` permission).

The alternative was an editor-only zoom factor multiplied into `--writer-editor-font-size`. It keeps the chrome stable and composes with the font-size setting, but it scales only prose: the properties panel, tab strip, sidebar, status bar, and images stay small, which is exactly what a presenter does not want, and it needs every editor surface to derive from one CSS variable (headings, code fences, widgets) to look right. Whole-window zoom is what Cmd++ means everywhere else on the Mac; the sidebar growing with the text is the expected result, and Cmd+\ hides it if the presenter wants only the note. Tradeoff accepted: the traffic-light inset and other chrome padding scale too, matching browser zoom in every Tauri app.

The setting does not touch `editor.font-size`: zoom multiplies on top of whatever font size the user chose, and reset returns to that size, never to a default.

## Shortcuts

| Shortcut                                   | Action             |
| ------------------------------------------ | ------------------ |
| Cmd+= / Cmd+Shift+= (Cmd++) / Cmd+numpad + | Zoom in one step   |
| Cmd+- / Cmd+Shift+- / Cmd+numpad −         | Zoom out one step  |
| Cmd+0                                      | Actual size (100%) |

Handled by the global JS keydown handler in `use-keyboard-shortcuts.ts`, same as Cmd+P and Cmd+W. WKWebView delivers Cmd+=/−/0 to the page when no native menu accelerator claims them, and none does, so no View menu is added. Cmd+1…9 jump to tabs; Cmd+0 was free. Cmd+Alt+0 remains the editor's "strip heading" binding; the zoom handler ignores chords with Alt. Compact single-file windows zoom too: the shortcuts have no workspace dependency.

Preset stops (percent): 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300. Zoom in moves to the next stop above the current value, zoom out to the next below, so a value typed into Preferences that is not a stop still steps sensibly. The ends clamp.

The Mermaid canvas widget used bare `+`, `-`, `0` for its own zoom and did not check modifiers, so a focused diagram would have zoomed with the window. It now ignores Cmd/Ctrl chords.

## Persistence

One new setting in `settings.schema.json`:

| Key           | Type  | Range         | Default | Scope  |
| ------------- | ----- | ------------- | ------- | ------ |
| `window.zoom` | range | 50–300 step 5 | 100     | global |

Percent, not a factor, so the existing range control renders it without decimals and the schema's `min`/`max` are the single source of truth for the clamp. It shows under Preferences → Window as "Zoom" with the usual modified indicator and reset. Global scope: zoom is a property of the person's screen, not of a vault, and a workspace `.writer/config` cannot override it.

Applying the zoom is a settings side effect (`applySettingsSideEffects` → `applyWindowZoom`), so hydration on launch, shortcut presses, Preferences edits, and reset all reach the webview through one path. The apply step dedupes on the last percent it pushed, so unrelated setting writes cost no IPC. Each window applies its own zoom on startup; a zoom change in one window does not reach other already-open windows until they relaunch (global config changes are not broadcast between windows today, only workspace `.writer/config` changes are).

## Commands

Command palette: "Zoom In", "Zoom Out", "Reset Zoom" (ids `zoom-in`, `zoom-out`, `zoom-reset`), available in every window kind.

## Acceptance Criteria

- Cmd+=, Cmd+Shift+=, and Cmd+numpad + each enlarge the whole window one stop; Cmd+- and the Shift/numpad variants shrink it; Cmd+0 returns to 100%.
- The shortcuts work with the editor focused, with the sidebar focused, in the Settings tab, and in a compact single-file window.
- `editor.font-size` is unchanged by any zoom action.
- Relaunching Writer restores the last zoom.
- Preferences → Window shows "Zoom" at the current percent; dragging it zooms live; its reset returns to 100.
- Repeated Cmd+= at 300% (or Cmd+- at 50%) does nothing and writes nothing.
- A focused Mermaid diagram no longer zooms itself on Cmd+=/−/0.
- Unit tests cover the step ladder, clamping, off-stop values, and that the ladder ends equal the schema bounds.
