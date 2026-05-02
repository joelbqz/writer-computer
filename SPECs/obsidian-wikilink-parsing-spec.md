# Obsidian Wikilink Parsing Spec

## Summary

Writer's wiki-link resolver treated all text inside `[[...]]` as a filename. Obsidian vaults commonly use aliases, escaped table pipes, and heading or block fragments, so links like `[[No prior experience|I have no prior experience]]` failed by trying to open a note named `No prior experience|I have no prior experience`.

## Goals

- Parse Obsidian-style wiki-link aliases and resolve only the destination note name.
- Display the alias text when a link has one.
- Ignore heading and block fragments for file lookup so fragment-bearing links still open the right file.
- Resolve same-file fragment links to the current document.
- Support table-escaped piped links such as `[[Format your notes\|Formatting]]`.

## Non-Goals

- Scrolling to heading or block fragments. `SPECs/heading-anchor-links-spec.md` owns anchor scrolling.
- Inline rendering for `![[...]]` embeds. `SPECs/obsidian-image-embed-spec.md` owns embed rendering.
- Rewriting existing markdown syntax on save.

## Acceptance Criteria

- Clicking `[[No prior experience|I have no prior experience]]` opens `No prior experience.md` and displays `I have no prior experience`.
- Clicking `[[Format your notes#^376b9d|second option]]` opens `Format your notes.md`.
- Clicking `[[#^0f681f|with great power comes great responsibility]]` stays on the current file.
- `[[Format your notes\|Formatting]]` behaves as a piped link for table compatibility.
- Duplicate stems remain unresolved unless the link is path-qualified.
