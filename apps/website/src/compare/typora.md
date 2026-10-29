# Writer Computer vs Typora

Both apps edit plain markdown files where they are, render them as you type, and draw Mermaid diagrams and LaTeX math. Typora is a paid editor for macOS, Windows and Linux, with export to PDF, HTML and, through Pandoc, Word and other formats, plus focus and typewriter modes and themes. Writer Computer is free, open source and macOS-only, and adds Obsidian-style wikilinks for linking notes in a folder; it has no export.

{{comparison}}

## Choose Typora if

- You work on Windows or Linux as well as, or instead of, a Mac.
- You export documents to PDF, HTML, Word or other formats.
- You want focus mode, typewriter mode, or themes and custom CSS.
- You search the text of every file in a folder, or use MathJax extensions such as mhchem.

## Choose Writer Computer if

- You want a free, open-source editor. Typora is a $14.99 license and closed source.
- Your notes link to each other with `[[wikilinks]]`, as in an Obsidian vault.
- You keep several folders open at once, each in its own window.
- A small download matters: about 6 MB for Writer Computer, about 15 MB for Typora.

## Moving between them

Both read and write the same plain markdown files, so there is nothing to convert: open your folder in Writer Computer ([how](/docs/open-a-folder/)) and keep editing.

- Front matter Typora uses for its own settings, such as `typora-root-url` or `typora-copy-images-to`, is kept, shown with the note's other properties and ignored.
- Mermaid diagrams render in both. Typora uses Mermaid itself and Writer Computer uses Pele, so a diagram's layout can differ ([Mermaid diagrams](/docs/mermaid/)).
- Math renders in both. Typora uses MathJax and Writer Computer KaTeX, so MathJax-only extensions don't work in Writer Computer ([Math with LaTeX](/docs/math/)).
