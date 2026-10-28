/**
 * The docs pages, in nav order. Each page is one markdown file that
 * `docs-plugin.ts` renders to HTML at build time and lists in `sitemap.xml`
 * and `llms.txt`, so adding a page is an entry here plus its file. The file's
 * `# ` heading must equal `title`; the build fails if it doesn't.
 *
 * Imported by `vite.config.ts` as well as the routes, so it must stay free of
 * build-time globals such as `__WRITER_VERSION__`.
 */
export interface DocPage {
  /** URL segment: the page is served at `/docs/<slug>/`. */
  slug: string;
  /** The page's `# ` heading, its nav label and the start of its `<title>`. */
  title: string;
  /** Meta description, and the line under the page's link on `/docs/`. */
  description: string;
  /** Markdown source, relative to `apps/website/`. */
  source: string;
}

export const DOCS_PATH = "/docs/";

export const DOC_PAGES: readonly DocPage[] = [
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
  {
    slug: "privacy",
    title: "Privacy and telemetry",
    description:
      "What Writer Computer sends and never sends: usage data is off until you turn it on, and your notes, file names and paths never leave your Mac.",
    source: "src/docs/privacy.md",
  },
];

export function docPath(page: DocPage): string {
  return `${DOCS_PATH}${page.slug}/`;
}

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}
