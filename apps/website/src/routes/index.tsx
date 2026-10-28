import { Link, createFileRoute } from "@tanstack/react-router";

import { useAnalytics } from "../analytics";
import { AppleGlyph, WriterMark } from "../components/Mark";
import { PRODUCT_NAME, SITE_URL } from "../site";
import { useLatestRelease } from "../use-latest-release";

const FEATURES = [
  { label: "Private", description: "all your documents live in your computer" },
  { label: "Blazing fast", description: "cold starts take a fraction of a second" },
  { label: "Extended markdown", description: "mermaid charts, tables and HTML" },
  { label: "Multiwindow", description: "snappy switch between multiple workspaces" },
  { label: "Frontmatter", description: "YAML metadata support built-in" },
];

// Captions are visually hidden: they describe each clip for screen readers and
// crawlers without changing the page.
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

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
  }),
  component: HomePage,
});

function HomePage() {
  const capture = useAnalytics();
  const release = useLatestRelease();

  return (
    <div className="page">
      <main className="hero">
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

        <h1 className="headline">Fast and lightweight app for your workspace's markdown files</h1>

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

        <ul className="features">
          {FEATURES.map(({ label, description }) => (
            <li className="feature" key={label}>
              {/* The space keeps the line readable as text without CSS. */}
              <span className="feature-label">{label}</span>{" "}
              <span className="feature-desc">{description}</span>
            </li>
          ))}
        </ul>
      </main>

      <aside className="screenshots" aria-label="Demo videos">
        {DEMOS.map(({ src, caption }) => (
          <DemoVideo key={src} src={src} caption={caption} />
        ))}
      </aside>
    </div>
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
