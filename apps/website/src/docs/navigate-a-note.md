# Find your way around a note

Long notes stay easy to move around in Writer Computer: an outline of your headings sits at the edge of the note, links can jump to any heading, find and replace marks every match, and the status bar counts your words.

<!-- Behavior is from apps/desktop/src/components/editor-area/ (section-rail.tsx, link-navigation.ts, editor-search-*.ts, document-footer.tsx). -->

## The section rail

When a note has five or more headings of levels 1 to 3, a column of short marks appears at its right edge, one for each heading. The mark for the section you're reading is brighter, and it follows you as you scroll.

- **Hover** over the rail to see the outline: every heading in the note, with the current one in the accent color.
- **Click** a mark or a heading in the outline to jump straight to it.
- **Right-click** a mark or heading and choose **Copy heading link** to copy a link to it, such as `[Install](#install)`, ready to paste into the same note.

## Links to headings

Every heading has an anchor made from its text, the way GitHub makes them: lowercase, punctuation removed, spaces turned into hyphens, so "Getting started!" becomes `#getting-started`. A second heading with the same text becomes `#getting-started-2`.

- `[text](#getting-started)` scrolls to that heading in the same note.
- `[text](setup.md#getting-started)` opens `setup.md` and jumps to the heading. Paths are relative to the note, and a link without an extension finds `setup.md` too.

A click on a link follows it; you don't need to hold ⌘. If the heading doesn't exist, Writer says so in a small notice at the top of the note. To follow links between notes by name instead, see `[[wikilinks]]` in [Obsidian compatibility](/docs/obsidian/).

## Find and replace

Press ⌘F to open the find panel at the bottom right of the note. It fills in the text you've selected, if any, and shows which match you're on out of how many.

- Enter or ⌘G goes to the next match, and Shift+Enter or ⌘⇧G to the previous one.
- **Replace** opens a second field, with **Replace** for the current match and **All** for every match.
- Esc closes the panel and puts you back in the note.

While the panel is open, a thin strip at the right edge marks where every match is in the note, with the current one in the accent color. Click a mark to jump to that match.

Matching is plain text and ignores case. Search looks inside the open note; to find a note by its name, use the command palette (⌘P). Writer doesn't search the text of every note in a folder yet.

## Back and forward

The ← and → buttons in the tab bar step back and forward through the notes you've opened in that tab, and so do ⌥← and ⌥→ when the cursor isn't in the note. When you go back to a note, it opens where you left off, with the cursor and scroll position as they were.

## Word count

The status bar at the bottom of the note shows its **words**, **characters** and **paragraphs**. Markdown syntax doesn't count: a link counts as its text, and `#` or `-` at the start of a line doesn't count as a word.

Right-click the status bar to choose which counts to show. If you hide all three, the status bar goes away; turn them back on in Preferences under **Status Bar**.
