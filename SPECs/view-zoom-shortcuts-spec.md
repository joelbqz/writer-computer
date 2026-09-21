# View Zoom Shortcuts

## Goal

A presenter who mirrors Writer in a meeting needs Cmd++ to make the note bigger. Today nothing happens. Add editor zoom driven by the standard macOS chords, remembered across launches, with a palette entry and a Preferences row so it is discoverable and reversible.

## Mechanism

**Chosen: editor text zoom**, a persisted percent multiplied into the editor font size. The schema binds `editor.zoom` to `--writer-editor-zoom`; `App.css` defines `--writer-editor-font-size` as the Font Size setting (now bound to `--writer-editor-base-font-size`) times that percent. Every editor consumer already reads `--writer-editor-font-size` (Prosemark theme, syntax highlighting, code fences), so the note, its headings, and its code scale together while the sidebar, tab strip, status bar, and dialogs keep their size.

The alternative, whole-window zoom through WKWebView page zoom, is what browsers do and would have scaled chrome and sidebar as well. It was implemented first and then dropped by decision: the chrome should stay put, and only the note should grow. Editor zoom also needs no Tauri permission, no IPC, and no per-window apply step; it rides the generic cssVar side effect that every other CSS-bound setting uses.

The setting does not touch `editor.font-size`: zoom multiplies on top of whatever font size the user chose, and reset returns to that size, never to a default. Content width stays in CSS pixels, so a zoomed note simply fits fewer words per line.

## Shortcuts

| Shortcut                                   | Action             |
| ------------------------------------------ | ------------------ |
| Cmd+= / Cmd+Shift+= (Cmd++) / Cmd+numpad + | Zoom in one step   |
| Cmd+- / Cmd+Shift+- / Cmd+numpad −         | Zoom out one step  |
| Cmd+0                                      | Actual size (100%) |

Handled by the global JS keydown handler in `use-keyboard-shortcuts.ts`, same as Cmd+P and Cmd+W. WKWebView delivers Cmd+=/−/0 to the page when no native menu accelerator claims them, and none does, so no View menu is added. Cmd+1…9 jump to tabs; Cmd+0 was free (matched by key code as well, so it works on layouts whose unshifted digit-row key is not "0"). Cmd+Alt+0 remains the editor's "strip heading" binding; the zoom handler ignores chords with Alt. Compact single-file windows zoom too: the shortcuts have no workspace dependency.

Preset stops (percent): 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300. Zoom in moves to the next stop above the current value, zoom out to the next below, so a value typed into Preferences that is not a stop still steps sensibly. The ends clamp.

The Mermaid canvas widget used bare `+`, `-`, `0` for its own zoom and did not check modifiers, so a focused diagram would have zoomed with the window. It now ignores Cmd/Ctrl chords.

## Persistence

One new setting in `settings.schema.json`:

| Key           | Type  | Range         | Default | Scope  | CSS var                |
| ------------- | ----- | ------------- | ------- | ------ | ---------------------- |
| `editor.zoom` | range | 50–300 step 5 | 100     | global | `--writer-editor-zoom` |

Percent, not a factor, so the existing range control renders it without decimals and the schema's `min`/`max` are the single source of truth for the clamp. It shows under Preferences → Editor as "Zoom", next to Font Size, with the usual modified indicator and reset. Global scope: zoom is a property of the person's screen, not of a vault, and a workspace `.writer/config` cannot override it.

`editor.font-size` keeps its key and default; only its CSS binding moves to `--writer-editor-base-font-size`. The multiplication lives in one place, the `:root` rule in `App.css`, and the derived `--writer-editor-font-size` keeps its name so no consumer changes.

Applying the zoom is the ordinary cssVar side effect (`applySettingsSideEffects` → `applyCssVarBindings`), so hydration on launch, shortcut presses, Preferences edits, and reset all reach the DOM through one path. Each window applies its own value on startup; a zoom change in one window does not reach other already-open windows until they relaunch (global config changes are not broadcast between windows today, only workspace `.writer/config` changes are).

## Commands

Command palette: "Zoom In", "Zoom Out", "Reset Zoom" (ids `zoom-in`, `zoom-out`, `zoom-reset`), available in every window kind.

## Acceptance Criteria

- Cmd+=, Cmd+Shift+=, and Cmd+numpad + each enlarge the note text one stop; Cmd+- and the Shift/numpad variants shrink it; Cmd+0 returns to 100%. The sidebar, tab strip, and status bar do not change size.
- The shortcuts work with the editor focused, with the sidebar focused, in the Settings tab, and in a compact single-file window.
- `editor.font-size` is unchanged by any zoom action, and a changed Font Size is multiplied, not replaced (20px at 125% renders 25px; reset returns to 20px).
- Relaunching Writer restores the last zoom.
- Preferences → Editor shows "Zoom" at the current percent; dragging it zooms live; its reset returns to 100.
- Repeated Cmd+= at 300% (or Cmd+- at 50%) does nothing and writes nothing.
- A focused Mermaid diagram no longer zooms itself on Cmd+=/−/0.
- Unit tests cover the step ladder, clamping, off-stop values, and that the ladder ends equal the schema bounds.
