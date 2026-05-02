# Worksheet: Obsidian Wikilink Parsing

## Task

- TODO: Obsidian-style wikilink parsing, linked to `SPECs/obsidian-wikilink-parsing-spec.md`.
- Worktree was clean before starting.

## Reviewed

- `apps/desktop/src/lib/wiki-links.ts`
- `apps/desktop/src/components/editor-area/wiki-link-extension.ts`
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`
- `apps/desktop/src-tauri/src/commands/search.rs`
- `~/j/tmp/Sandbox` Obsidian sandbox vault links
- `docs/workflows/agent-loop.md`

## Findings

- Writer parsed everything inside `[[...]]` as the file target, so piped aliases polluted lookup and folded display text.
- Fragment links such as `[[Format your notes#^376b9d|second option]]` also polluted lookup.
- Same-file fragment links had no way to resolve because the resolver did not receive the current file path.
- Backend fuzzy search normalized query spaces to hyphens only, so exact stem lookup missed Sandbox files whose names contain spaces.

## Plan

- Add a pure wiki-link parser that splits destination, fragment, and display alias.
- Feed the current file path into wiki-link click resolution for same-file fragments.
- Keep fragment scrolling and embed rendering out of scope.
- Make fuzzy search tolerant of both space and hyphen query variants.
- Add targeted frontend and Rust tests, then run validation.

## Results

- Implemented parser and resolver support for Obsidian aliases, table-escaped pipes, note fragments, and same-file fragment links.
- Updated folded wiki-link display to show alias text when present.
- Made backend fuzzy search match both space-separated and hyphen-separated query variants so note names with spaces resolve.
- Validation:
  - `vp test apps/desktop/tests/wiki-links.test.ts` passed.
  - `vp check` passed with two existing E2E JavaScript warnings.
  - `vp test` passed.
  - `cargo test` passed.
  - `cargo clippy` passed with existing warnings outside this task.
  - `cargo fmt --check` passed.
