# Writer Computer vs Obsidian

Both apps keep your notes as plain markdown files in a folder on your disk, and Writer Computer opens an Obsidian vault as it is. Obsidian is a full knowledge-base platform: apps for every major platform, plugins, backlinks, graph view, Canvas, and paid Sync and Publish. Writer Computer is a small, free, open-source editor for macOS that reads the same files, with wikilinks, Mermaid diagrams and math built in, and no plugins.

{{comparison}}

## Choose Obsidian if

- You need your notes on an iPhone, iPad or Android phone, or on Windows or Linux.
- You want sync from the same company (Obsidian Sync) or to publish notes as a website (Obsidian Publish).
- You rely on backlinks, graph view, Canvas, full-text search across the vault, or community plugins.
- You export notes to PDF.

## Choose Writer Computer if

- You write on a Mac and want an editor for your markdown folder rather than a platform around it.
- You want open-source software you can read and build yourself. Obsidian is closed source.
- A small app matters to you: the Writer Computer download is about 6 MB, Obsidian's about 235 MB.
- Your notes use wikilinks, frontmatter, Mermaid and math, and you don't depend on plugins.

## Using both on one vault

You don't have to pick one. Open the vault's folder in Writer Computer ([how](/docs/open-a-folder/)) and it edits the same files, leaves the `.obsidian` folder alone and picks up changes Obsidian makes.

Some Obsidian syntax works differently or not at all in Writer Computer, and [Obsidian compatibility](/docs/obsidian/) lists it all. The ones you're most likely to notice:

- Callouts show as ordinary blockquotes, and note embeds (`![[Note]]`) aren't shown.
- `[[Note#Heading]]` opens the note but doesn't jump to the heading.
- Obsidian renders math with MathJax and Writer Computer with KaTeX. Most formulas look the same; MathJax extensions such as mhchem's `\ce` don't work in Writer Computer.
- Anything a plugin adds, such as Dataview queries, stays as plain text.
