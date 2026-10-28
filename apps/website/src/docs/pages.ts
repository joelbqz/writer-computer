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
      slug: "keyboard-shortcuts",
      title: "Keyboard shortcuts",
      description:
        "Every keyboard shortcut in Writer Computer: tabs, search and the command palette, formatting, editing and zoom.",
      // The app's canonical shortcut map, published as is.
      source: "../../docs/keyboard-shortcuts.md",
    },
  ],
};
