# Writer Computer vs Apple Notes

Apple Notes comes with every Mac, iPhone and iPad, syncs through iCloud, and holds much more than text: scanned documents, sketches, audio recordings with transcripts, checklists, shared folders and locked notes. Its notes live inside the app's accounts; since macOS Tahoe 26 it can import and export markdown, converting it to and from rich text. Writer Computer works the other way round: it edits markdown files themselves, in folders you choose, so git, scripts and other editors can read them too. It has no sync and no iPhone app.

{{comparison}}

## Choose Apple Notes if

- You want your notes on your iPhone and iPad, synced with no setup.
- You scan documents, sketch, record audio or keep photos and PDFs in your notes.
- You share notes or folders with other people and edit them together.
- You want to lock notes with your Mac's password or Touch ID.

## Choose Writer Computer if

- You want notes as plain markdown files that you own and any app can open.
- You write in markdown and use Mermaid diagrams, LaTeX math, frontmatter or `[[wikilinks]]`.
- Your notes live in an Obsidian vault, a git repository or a docs folder.
- You want open-source software you can read and build yourself.

## Moving notes over

From Apple Notes to Writer Computer: in macOS 27, open a note and choose **File → Export To → Markdown** (in macOS Tahoe 26, **File → Export as → Markdown**). Apple's guide describes exporting one note at a time. Save the files in a folder, then open the folder in Writer Computer ([how](/docs/open-a-folder/)).

From Writer Computer to Apple Notes: import the files into Notes (in macOS Tahoe 26, **File → Import Markdown**). Notes converts them to rich text and keeps them as its own notes, in an Imported Notes folder; the markdown files stay where they were.
