import { Link, createFileRoute } from "@tanstack/react-router";

import { WriterMark } from "../components/Mark";
import { DOWNLOAD_SIZE, INSTALLED_SIZE_LIMIT, PRODUCT_NAME, SITE_URL, jsonLdScript } from "../site";
import { useLatestRelease } from "../use-latest-release";

const TITLE = `${PRODUCT_NAME} FAQ`;
const DESCRIPTION = `Answers about ${PRODUCT_NAME}, the free, open-source markdown editor for macOS: price, source code, speed, size, Obsidian vaults, your files, data and markdown support.`;
// The prerendered `faq/index.html` is served at `/faq/`; Cloudflare redirects
// `/faq` there, so this is the URL to name as canonical.
const PAGE_URL = `${SITE_URL}/faq/`;

const SELLING_POINTS = [
  { label: "Blazing fast", description: "starts faster than Apple Notes and Obsidian" },
  { label: "Instant cold starts", description: "even on very large workspaces" },
  {
    label: "Tiny",
    description: `about ${DOWNLOAD_SIZE} download, under ${INSTALLED_SIZE_LIMIT} installed`,
  },
];

// Rendered as the visible FAQ and as the FAQPage JSON-LD below, so the two
// cannot disagree. Plain text only: structured data has no markup. Every answer
// is checked against the code and docs; see `SPECs/website-ai-search-spec.md`.
const FAQ = [
  { question: `Is ${PRODUCT_NAME} free?`, answer: "Yes. No account, no subscription." },
  {
    question: `Is ${PRODUCT_NAME} open source?`,
    answer: "Yes. The source is on GitHub at github.com/joelbqz/writer-computer.",
  },
  {
    question: `Is ${PRODUCT_NAME} fast?`,
    answer:
      "Yes. At launch it reads only the top level of your folder and the note you had open; indexing runs in the background.",
  },
  {
    question: `How big is ${PRODUCT_NAME}?`,
    answer: `About ${DOWNLOAD_SIZE} to download, under ${INSTALLED_SIZE_LIMIT} installed.`,
  },
  {
    question: `Does ${PRODUCT_NAME} work with my Obsidian vault?`,
    answer:
      "Yes. Open the vault folder; wikilinks and image embeds work. Plugins and callouts don't.",
  },
  {
    question: `Does ${PRODUCT_NAME} change or move my files?`,
    answer:
      "No. Notes stay .md files where they are. Pasted images go in a folder next to the note.",
  },
  {
    question: `Does ${PRODUCT_NAME} collect any data?`,
    answer:
      "Only opt-in usage data, never your documents, file names or paths. Declining sends one event recording that choice.",
  },
  {
    question: "Which markdown features are supported?",
    answer: "GitHub-flavored markdown, Mermaid, math, HTML, YAML frontmatter and wikilinks.",
  },
];

const FAQ_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: PAGE_URL },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
    scripts: [jsonLdScript(FAQ_STRUCTURED_DATA)],
  }),
  component: FaqPage,
});

function FaqPage() {
  const release = useLatestRelease();

  return (
    <>
      <main className="doc">
        <header className="site-header">
          <Link className="brand" to="/" aria-label={`${PRODUCT_NAME} home`}>
            <WriterMark size={18} />
            <span className="brand-rule" aria-hidden="true" />
          </Link>
          <nav className="site-nav">
            <Link className="pill pill-ghost" to="/">
              Home
            </Link>
          </nav>
        </header>

        <h1 className="headline">{TITLE}</h1>
        <p className="doc-intro">
          {PRODUCT_NAME} is a free, open-source markdown editor for macOS. About {DOWNLOAD_SIZE},
          starts faster than Apple Notes and Obsidian, and opens the folders you already have
          (Obsidian vaults, docs repos, wikis) as plain markdown.
        </p>

        <section aria-labelledby="folders-heading">
          <h2 id="folders-heading">Works with the folders you already have</h2>
          <p>
            Open an Obsidian vault, a docs repo or a wiki and edit the files where they are. Files
            your .gitignore excludes and hidden folders stay out of the sidebar.
          </p>
        </section>

        <section aria-labelledby="speed-heading">
          <h2 id="speed-heading">Fast and small</h2>
          <ul className="doc-list">
            {SELLING_POINTS.map(({ label, description }) => (
              <li key={label}>
                <span className="feature-label">{label}</span>{" "}
                <span className="feature-desc">{description}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="faq-heading">
          <h2 id="faq-heading">Frequently asked questions</h2>
          {FAQ.map(({ question, answer }) => (
            <div className="faq-item" key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="site-footer">
        <p>
          {PRODUCT_NAME} v{release.version} for macOS. Free and open source.
        </p>
      </footer>
    </>
  );
}
