import type { ContentSection } from "../content";

/** The docs pages, in nav order. See `src/content.ts` for how a page is built. */
export const DOCS: ContentSection = {
  key: "docs",
  name: "Docs",
  path: "/docs/",
  pages: [
    {
      slug: "open-a-folder",
      title: "Open a folder or Obsidian vault",
      description:
        "Open an existing folder of markdown files, an Obsidian vault or a single note in Writer Computer, and what it does and doesn't change on disk.",
      source: "src/docs/open-a-folder.md",
    },
    {
      slug: "obsidian",
      title: "Obsidian compatibility",
      description:
        "Which Obsidian syntax Writer Computer supports: wikilinks, image embeds and frontmatter, plus what works differently and what isn't supported.",
      source: "src/docs/obsidian.md",
    },
    {
      slug: "navigate-a-note",
      title: "Find your way around a note",
      description:
        "Move around long notes in Writer Computer: the heading outline at the edge of every note, links to headings, find and replace, and word counts.",
      source: "src/docs/navigate-a-note.md",
    },
    {
      slug: "tables-tasks-and-code",
      title: "Tables, tasks and code",
      description:
        "How Writer Computer shows tables, task checkboxes, highlighted code, frontmatter properties, HTML, images and emoji, while the file stays plain markdown.",
      source: "src/docs/tables-tasks-and-code.md",
    },
    {
      slug: "mermaid",
      title: "Mermaid diagrams",
      description:
        "Draw Mermaid diagrams in your notes with Writer Computer: every diagram type built into Mermaid, with pan, zoom and full screen.",
      source: "src/docs/mermaid.md",
    },
    {
      slug: "math",
      title: "Math with LaTeX",
      description:
        "Write inline and display math with LaTeX in Writer Computer, rendered by KaTeX: the delimiters, the dollar-sign rules and what isn't supported.",
      source: "src/docs/math.md",
    },
    {
      slug: "customize-the-look",
      title: "Customize the look",
      description:
        "Change Writer Computer's look: light and dark themes, accent color, translucency and contrast, your own fonts, text size, line height, zoom and column width.",
      source: "src/docs/customize-the-look.md",
    },
    {
      slug: "sidebar",
      title: "The sidebar",
      description:
        "Use Writer Computer's sidebar: pinned and recent notes, sorting, titles or filenames, moving notes by dragging, the right-click menus and Open in Terminal.",
      source: "src/docs/sidebar.md",
    },
    {
      slug: "keyboard-shortcuts",
      title: "Keyboard shortcuts",
      description:
        "Every keyboard shortcut in Writer Computer: tabs, search and the command palette, formatting, editing and zoom.",
      // The app's canonical shortcut map, published as is.
      source: "../../docs/keyboard-shortcuts.md",
    },
  ],
};
