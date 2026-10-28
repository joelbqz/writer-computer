import { Link, createFileRoute } from "@tanstack/react-router";

import { useAnalytics } from "../analytics";
import { AppleGlyph, WriterMark } from "../components/Mark";
import { DOWNLOAD_SIZE, INSTALLED_SIZE_LIMIT, PRODUCT_NAME, SITE_URL, jsonLdScript } from "../site";
import { useLatestRelease } from "../use-latest-release";

const FEATURES = [
  { label: "Blazing fast", description: "starts faster than Apple Notes and Obsidian" },
  { label: "Instant cold starts", description: "even on very large workspaces" },
  { label: "Tiny", description: `about ${DOWNLOAD_SIZE} download` },
  { label: "Private", description: "your documents stay on your computer" },
  { label: "Extended markdown", description: "mermaid charts, tables and HTML" },
  { label: "Multiwindow", description: "snappy switch between workspaces" },
  { label: "Frontmatter", description: "YAML metadata built in" },
];

const DEMOS = [
  {
    src: "/demo-videos/00.mp4",
    caption:
      "Following links from a daily note to a project note with properties, tasks and a table.",
  },
  { src: "/demo-videos/01.mp4", caption: "Opening the command palette and browsing commands." },
  {
    src: "/demo-videos/02.mp4",
    caption: "Adjusting the dark theme's accent, translucency and contrast in Settings.",
  },
  {
    src: "/demo-videos/03.mp4",
    caption:
      "Scrolling through rendered Mermaid diagrams: entity-relationship, Gantt, state and sequence.",
  },
  {
    src: "/demo-videos/04.mp4",
    caption:
      "Switching notes from the sidebar: a checklist, a migration plan and a design system note with CSS.",
  },
  {
    src: "/demo-videos/05.mp4",
    caption: "Hiding and showing the sidebar on a note with frontmatter properties.",
  },
  {
    src: "/demo-videos/06.mp4",
    caption: "Scrolling through Settings: workspace, editor, file and theme options.",
  },
  {
    src: "/demo-videos/07.mp4",
    caption:
      "Scrolling an architecture note with a text diagram, a TOML code block and related links.",
  },
  {
    src: "/demo-videos/08.mp4",
    caption: "Following a link from a daily note to a project note, then checking off a task.",
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

export const Route = createFileRoute("/")({
  head: () => ({
    scripts: [jsonLdScript(FAQ_STRUCTURED_DATA)],
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
  }),
  component: HomePage,
});

function HomePage() {
  const capture = useAnalytics();
  const release = useLatestRelease();

  return (
    <>
      <main>
        <div className="page">
          <div className="hero">
            <header className="site-header">
              <Link className="brand" to="/" aria-label={PRODUCT_NAME}>
                <WriterMark size={18} />
                <span className="brand-rule" aria-hidden="true" />
              </Link>
              <nav className="site-nav">
                <a
                  className="pill pill-ghost"
                  href="https://x.com/joelbqz"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => capture("updates_opened")}
                >
                  Updates
                </a>
                <a
                  className="pill pill-outline"
                  href={__WRITER_REPO_URL__}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => capture("github_opened")}
                >
                  GitHub
                </a>
              </nav>
            </header>

            <h1 className="headline">
              Fast and lightweight app for your workspace's markdown files
            </h1>

            <p className="intro">
              {PRODUCT_NAME} is a free, open-source markdown editor for macOS. About {DOWNLOAD_SIZE}
              , starts faster than Apple Notes and Obsidian, and opens the folders you already have
              (Obsidian vaults, docs repos, wikis) as plain markdown.
            </p>

            <div className="cta">
              <a
                className="download"
                href={release.dmgUrl}
                onClick={() => capture("download_started", { app_version: release.version })}
              >
                <AppleGlyph size={20} />
                <span>Download for MacOS</span>
              </a>
              <span className="beta-pill">Beta</span>
              <span className="version">v{release.version}</span>
            </div>

            <p className="caption">Free and open source. Forever</p>

            <section className="features" aria-labelledby="features-heading">
              <h2 className="sr-only" id="features-heading">
                Features
              </h2>
              <ul className="feature-list">
                {FEATURES.map(({ label, description }) => (
                  <li className="feature" key={label}>
                    <span className="feature-label">{label}</span>{" "}
                    <span className="feature-desc">{description}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="screenshots" aria-label="Demo videos">
            {DEMOS.map(({ src, caption }) => (
              <DemoVideo key={src} src={src} caption={caption} />
            ))}
          </aside>
        </div>

        <div className="details">
          <section className="details-section" aria-labelledby="folders-heading">
            <h2 id="folders-heading">Works with the folders you already have</h2>
            <p>
              Open an Obsidian vault, a docs repo or a wiki and edit the files where they are. Files
              your .gitignore excludes and hidden folders stay out of the sidebar.
            </p>
          </section>

          <section className="details-section" aria-labelledby="faq-heading">
            <h2 id="faq-heading">Frequently asked questions</h2>
            {FAQ.map(({ question, answer }) => (
              <div className="faq-item" key={question}>
                <h3>{question}</h3>
                <p>{answer}</p>
              </div>
            ))}
          </section>
        </div>
      </main>

      <footer className="site-footer">
        <p>
          {PRODUCT_NAME} v{release.version} for macOS. Free and open source.
        </p>
      </footer>
    </>
  );
}

function DemoVideo({ src, caption }: { src: string; caption: string }) {
  return (
    <figure className="shot">
      <video src={src} autoPlay muted loop playsInline preload="metadata" />
      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}
