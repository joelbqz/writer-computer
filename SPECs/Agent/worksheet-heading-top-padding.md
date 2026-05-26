# Agent Worksheet: Heading Top Padding

## Task

- Markdown heading top padding: inject a class into editor Markdown heading
  lines and use it to add `1rem` top padding.
- Spec: `SPECs/heading-top-padding-spec.md`

## Reviewed

- `TODOS.md` — noted existing unrelated in-progress reveal/sidebar task.
- `docs/editor.md` — confirmed CodeMirror layout/decorations guidance.
- `docs/react-guidelines.md` — no React component/store changes needed.
- `docs/consolidation.md` — keep heading behavior centralized in the existing
  heading decoration extension.
- `apps/desktop/src/components/editor-area/heading-decorations.ts` — existing
  ATX heading line/hash decoration and selection guard.
- `apps/desktop/src/components/editor-area/prosemark-theme.css` — existing
  heading hash CSS and editor line layout.
- `apps/desktop/tests/heading-decorations.test.ts` — focused tests for heading
  decoration behavior.

## Plan

- Reuse the existing `headingDecorations` extension as the single owner of
  heading line classes.
- Add a generic class to every heading line decoration.
- Broaden line classification to include Setext headings, while keeping hash
  movement/caret guards limited to ATX headings.
- Add CSS top padding through the new generic class.
- Validate with focused heading tests plus `vp check` and `vp test`.

## Results

- Added `cm-markdown-heading` to heading line decorations for ATX and Setext
  headings.
- Added `padding-top: 1rem` to the shared heading class.
- Kept ATX hash decorations and selection no-go zones ATX-only.
- Added tests for ATX/Setext heading classification and Setext no-go-zone
  behavior.
- Validation:
  - `vp test run apps/desktop/tests/heading-decorations.test.ts` passed.
  - `vp check` completed with existing unrelated warnings in
    `apps/desktop/e2e`.
  - `vp test` passed.
