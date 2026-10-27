import { Link, createFileRoute } from "@tanstack/react-router";

import { useAnalytics } from "../analytics";
import { AppleGlyph, WriterMark } from "../components/Mark";
import { PRODUCT_NAME, SITE_URL, jsonLdScript } from "../site";
import { useLatestRelease } from "../use-latest-release";

const FEATURES = [
  {
    label: "Private",
    description: "Your documents stay on your computer as plain markdown files.",
  },
  { label: "Blazing fast", description: "Cold starts take a fraction of a second." },
  {
    label: "Extended markdown",
    description: "Mermaid diagrams, tables, math and HTML render right in the editor.",
  },
  {
    label: "Multiwindow",
    description: "Open each workspace in its own window and switch between them quickly.",
  },
  { label: "Frontmatter", description: "YAML frontmatter shows up as properties you can edit." },
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
  {
    question: `Is ${PRODUCT_NAME} free?`,
    answer: `Yes. ${PRODUCT_NAME} is free to download and use. There is no account to create, no subscription and no paid tier.`,
  },
  {
    question: `Is ${PRODUCT_NAME} open source?`,
    answer: `Yes. The full source code is on GitHub at github.com/joelbqz/writer-computer.`,
  },
  {
    question: "Does it work with my Obsidian vault?",
    answer: `Yes. Open the vault folder and ${PRODUCT_NAME} edits its notes in place. It follows [[wikilinks]], suggests note names as you type one, and shows ![[image]] embeds. It leaves the .obsidian settings folder alone. Obsidian plugins and callouts are not supported.`,
  },
  {
    question: `Does ${PRODUCT_NAME} change or move my files?`,
    answer: `No. Notes stay ordinary .md files where they are, and saving writes your text back to the same file. Nothing is moved, renamed or converted unless you do it in the app. The one thing it adds is a folder next to a note (note-assets for note.md) when you paste an image into that note.`,
  },
  {
    question: `Does ${PRODUCT_NAME} collect any data?`,
    answer: `Only if you opt in. Usage data is off until you turn it on in the first-run prompt or in Preferences, and then covers a few events, such as app opened and file created, tied to a random install ID. It never includes your documents, file names or paths. If you answer Not now, the app sends one event recording that choice and nothing after it.`,
  },
  {
    question: "Which markdown features are supported?",
    answer: `CommonMark with GitHub-flavored tables, task lists and strikethrough, plus Mermaid diagrams, math with $ and $$ (KaTeX), HTML blocks such as <details>, YAML frontmatter shown as editable properties, syntax-highlighted code blocks, images and wikilinks. Footnotes and Obsidian callouts are not rendered.`,
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
              {PRODUCT_NAME} is a free and open-source markdown editor for macOS. It's made for
              people who keep their writing in plain-text folders: Obsidian vaults, docs repos and
              personal wikis. Open a folder and edit its files in place; your notes stay ordinary
              markdown files on your disk.
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
              Open any folder of markdown files as a workspace: an Obsidian vault, a docs repo, a
              personal wiki. {PRODUCT_NAME} edits the files where they are, so they stay plain
              markdown on your disk and keep working with Git, Obsidian and your other tools.
            </p>
            <p>
              Files your .gitignore excludes and hidden folders such as .git and .obsidian stay out
              of the sidebar and search. Each workspace can have its own window, so a work repo and
              a personal vault can be open side by side.
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
