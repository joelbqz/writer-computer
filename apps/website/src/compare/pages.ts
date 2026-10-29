import type { ContentPage, ContentSection } from "../content";
import { DOCS } from "../docs/pages";

/**
 * The comparison pages. Each page's markdown has a `{{comparison}}` line that
 * becomes the table built here, so Writer Computer's column is written once
 * for every page and each competitor's facts sit next to their sources.
 *
 * Every competitor value must come from the competitor's own site, docs or
 * download, checked on `checked` and listed in `sources`. "Not in X's docs"
 * says what the docs show, not what the app lacks. Re-check before changing a
 * page, and update `checked` when you do. See `SPECs/website-compare-spec.md`.
 */

const ROWS = [
  { key: "price", label: "Price", writer: "Free" },
  { key: "source", label: "Source code", writer: "Open source" },
  { key: "platforms", label: "Platforms", writer: "macOS" },
  { key: "storage", label: "Your notes", writer: "Markdown files in any folder you choose" },
  { key: "sync", label: "Sync", writer: "None built in" },
  { key: "mermaid", label: "Mermaid diagrams", writer: "Built in, every Mermaid diagram type" },
  { key: "math", label: "LaTeX math", writer: "Built in (KaTeX)" },
  { key: "wikilinks", label: "[[Wikilinks]]", writer: "Yes, with autocomplete" },
  { key: "search", label: "Search across notes", writer: "File names only" },
  { key: "export", label: "Export", writer: "None" },
  { key: "extensions", label: "Plugins and themes", writer: "No plugins; light and dark themes" },
  { key: "mobile", label: "Mobile apps", writer: "None" },
  { key: "download", label: "macOS download", writer: "6.1 MB (v0.8.0)" },
  { key: "account", label: "Account", writer: "Not needed" },
  { key: "telemetry", label: "Usage data", writer: "Off unless you turn it on" },
] as const;

type RowKey = (typeof ROWS)[number]["key"];

export interface ComparePage extends ContentPage {
  /** The other app's name, as its makers write it. */
  competitor: string;
  /** When the competitor's facts were last checked, `YYYY-MM-DD`. */
  checked: string;
  values: Record<RowKey, string>;
  sources: readonly { label: string; url: string }[];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-10-28` as "October 28, 2026", without depending on the build machine's locale. */
function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The comparison table and the line that dates and sources the competitor's column. */
function comparisonHtml(page: ComparePage): string {
  const rows = ROWS.map(
    (row) =>
      `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.writer)}</td><td>${escapeHtml(page.values[row.key])}</td></tr>`,
  );
  const sources = page.sources
    .map((source) => `<a href="${escapeHtml(source.url)}">${escapeHtml(source.label)}</a>`)
    .join(", ");
  return [
    '<table class="compare-table">',
    `<thead><tr><th scope="col"></th><th scope="col">Writer Computer</th><th scope="col">${escapeHtml(page.competitor)}</th></tr></thead>`,
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
    `<p class="compare-sources">${escapeHtml(page.competitor)} details as of ${longDate(page.checked)}, from ${sources}. Writer Computer details are for v0.8.0.</p>`,
  ].join("");
}

export const COMPARE: ContentSection<ComparePage> = {
  key: "compare",
  name: "Compare",
  path: "/docs/compare/",
  parent: DOCS,
  blocks: (page) => ({ comparison: comparisonHtml(page) }),
  pages: [
    {
      slug: "writer-computer-vs-obsidian",
      title: "Writer Computer vs Obsidian",
      competitor: "Obsidian",
      description:
        "Writer Computer and Obsidian both keep notes as markdown files in a folder. How they compare on price, platforms, sync, plugins, Mermaid, math and size, and who each suits.",
      source: "src/compare/obsidian.md",
      checked: "2026-10-28",
      values: {
        price: "Free; Sync from $4 and Publish from $8 a month, billed annually",
        source: "Closed source",
        platforms: "macOS, Windows, Linux, iOS, Android",
        storage: "Markdown files in a folder (a vault)",
        sync: "Obsidian Sync (paid), or third-party sync",
        mermaid: "Built in",
        math: "Built in (MathJax)",
        wikilinks: "Yes, with backlinks and graph view",
        search: "Full text, with a core Search plugin",
        export: "PDF (desktop)",
        extensions: "Core and community plugins, community themes",
        mobile: "iOS and Android",
        download: "234.8 MB (v1.14.5)",
        account: "Only for Sync, Publish and purchases",
        telemetry: "None collected, per its privacy policy",
      },
      sources: [
        { label: "pricing", url: "https://obsidian.md/pricing" },
        { label: "download", url: "https://obsidian.md/download" },
        { label: "help", url: "https://obsidian.md/help/" },
        { label: "privacy policy", url: "https://obsidian.md/privacy" },
        {
          label: "v1.14.5 release",
          url: "https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.14.5",
        },
      ],
    },
    {
      slug: "writer-computer-vs-typora",
      title: "Writer Computer vs Typora",
      competitor: "Typora",
      description:
        "Writer Computer and Typora both edit markdown files in place with Mermaid and math. How they compare on price, platforms, export, wikilinks and size, and who each suits.",
      source: "src/compare/typora.md",
      checked: "2026-10-28",
      values: {
        price: "$14.99 one-time, up to 3 devices; 15-day trial",
        source: "Closed source",
        platforms: "macOS, Windows, Linux",
        storage: "Markdown files, with a folder sidebar",
        sync: "None of its own; works with third-party sync",
        mermaid: "Built in, turned on in Preferences",
        math: "Built in (MathJax)",
        wikilinks: "Not in Typora's docs",
        search: "Full text across files, with regular expressions",
        export: "PDF, HTML, image; Word and more via Pandoc",
        extensions: "6 themes, community themes, custom CSS",
        mobile: "None",
        download: "15.2 MB (v1.14.15)",
        account: "Not needed; license code",
        telemetry: "Anonymous, only if you turn it on",
      },
      sources: [
        { label: "typora.io", url: "https://typora.io/" },
        { label: "store", url: "https://store.typora.io/" },
        { label: "support docs", url: "https://support.typora.io/" },
        { label: "privacy policy", url: "https://support.typora.io/Privacy-Policy/" },
        { label: "macOS download", url: "https://downloads.typora.io/mac/Typora.dmg" },
      ],
    },
    {
      slug: "writer-computer-vs-ia-writer",
      title: "Writer Computer vs iA Writer",
      competitor: "iA Writer",
      description:
        "Writer Computer and iA Writer are unrelated apps that both edit markdown files with wikilinks and math. How they compare on price, platforms, writing tools, export, diagrams and size.",
      source: "src/compare/ia-writer.md",
      checked: "2026-10-28",
      values: {
        price:
          "Mac $49.99 one-time, Windows $29.99; iPhone and iPad sold separately; 7-day trial on Mac and Windows",
        source: "Not open source",
        platforms: "macOS, Windows, iPhone, iPad",
        storage: "Plain text files in iCloud Drive or folders you add",
        sync: "Through iCloud, Dropbox, Google Drive or OneDrive; no service of its own",
        mermaid: "Not in iA Writer's docs",
        math: "Built in (KaTeX)",
        wikilinks: "Yes, on Mac, iPhone and iPad",
        search: "Global search in the library",
        export: "PDF, Word, HTML, Markdown",
        extensions: "Preview templates in HTML, CSS and JavaScript",
        mobile: "iPhone and iPad",
        download: "17.6 MB on the Mac App Store (v8.1.1)",
        account: "Apple ID on the App Store; iA Account for direct downloads",
        telemetry: "Anonymous statistics and crash reports",
      },
      sources: [
        { label: "pricing", url: "https://ia.net/writer/pricing" },
        { label: "features", url: "https://ia.net/writer/support/basics/features" },
        { label: "support docs", url: "https://ia.net/writer/support" },
        { label: "privacy notice", url: "https://ia.net/legal/privacy/writer" },
        {
          label: "Mac App Store",
          url: "https://apps.apple.com/us/app/ia-writer/id775737590?mt=12",
        },
      ],
    },
    {
      slug: "writer-computer-vs-apple-notes",
      title: "Writer Computer vs Apple Notes",
      competitor: "Apple Notes",
      description:
        "Apple Notes keeps rich-text notes in iCloud; Writer Computer edits markdown files in your own folders. How they compare on platforms, sync, markdown, diagrams, math and search.",
      source: "src/compare/apple-notes.md",
      checked: "2026-10-28",
      values: {
        price: "Free, built into macOS, iOS and iPadOS",
        source: "Proprietary, part of macOS",
        platforms: "Mac, iPhone, iPad, Apple Vision Pro, Apple Watch; iCloud.com in a browser",
        storage:
          "Inside Notes accounts (iCloud, On My Mac or email accounts); markdown import and export since macOS Tahoe 26",
        sync: "iCloud, or Google, Yahoo, Exchange and other accounts",
        mermaid: "Not in Apple's docs",
        math: "Math Results for calculations; LaTeX not in Apple's docs",
        wikilinks: "Links between notes, typed with >>",
        search: "Full text, including PDFs, handwriting and scans",
        export: "PDF and Markdown",
        extensions: "No plugins in Apple's docs",
        mobile: "iPhone and iPad",
        download: "Built in",
        account: "Apple Account for iCloud; not for On My Mac notes",
        telemetry: "Covered by Apple's privacy policy",
      },
      sources: [
        {
          label: "Notes User Guide for Mac",
          url: "https://support.apple.com/guide/notes/welcome/mac",
        },
        {
          label: "import and export",
          url: "https://support.apple.com/guide/notes/import-export-and-print-notes-not201900c07/mac",
        },
        { label: "markdown in Notes", url: "https://support.apple.com/en-us/102223" },
        { label: "iCloud data security", url: "https://support.apple.com/en-us/102651" },
        { label: "App Store", url: "https://apps.apple.com/us/app/notes/id1110145109" },
      ],
    },
  ],
};
