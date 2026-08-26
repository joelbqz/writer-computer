# Editor Content Width Spec

## Goal

Let the user set the width of the editor's text column with a continuous
control instead of choosing between the two fixed `full` / `narrow` modes.

## Behavior

- A new **Content Width** slider lives under Preferences → Editor, next to
  Font Size and Line Height. It ranges 480–1600px in 10px steps and defaults
  to 734px — the measure `App.css` already declared as the root default.
- The value is the maximum width of the text column. When the pane is
  narrower than the value the column still fills the pane, so the top of the
  range behaves as "full width" on ordinary laptop windows.
- The frontmatter panel and the CodeMirror content share the same width, so
  they stay aligned at every value (previously the panel used the 734px root
  default while the editor used the mode value).
- Changes apply live via the existing CSS-var binding; no per-element JS.

## Implementation

- `shared/settings.schema.json`: replace the `appearance.editor-width` enum
  with `editor.content-width` (`range`, `cssVar: --writer-editor-max-width`,
  `cssFormat: px`). The generic `applyCssVarBindings` pushes it to `:root`,
  where `--writer-editor-outer-width` and `--writer-text-col-inset` already
  derive from it.
- Remove `use-editor-settings.ts` and the wrapper `<div>` in `editor-pane.tsx`
  that overrode the var on the editor subtree only.
- `config.rs`: one-time `migrate_editor_width` maps a stored
  `appearance.editor-width` of `narrow` → `720` and `full` → `1600` into
  `editor.content-width` (unless already set), then drops the old key.
  Unrecognized values are dropped.
- Widen the range readout in `setting-control.tsx` so four-digit values fit.

## Validation

- `vp check`, `vp test`
- `cargo test`, `cargo clippy`, `cargo fmt --check`
