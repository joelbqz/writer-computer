import { Link, createFileRoute } from "@tanstack/react-router";

import { useAnalytics } from "../analytics";
import { AppleGlyph, WriterMark } from "../components/Mark";

const FEATURES = [
  { label: "Private", description: "all your documents live in your computer" },
  { label: "Blazing fast", description: "cold starts takes a fraction of a second" },
  { label: "Extended markdown", description: "mermaid charts, tables and HTML" },
  { label: "Multiwindow", description: "snappy switch between multiple workspaces" },
  { label: "Frontmatter", description: "YAML metadata support built-in" },
];

const DEMOS = [
  "/demo-videos/00.mp4",
  "/demo-videos/01.mp4",
  "/demo-videos/02.mp4",
  "/demo-videos/03.mp4",
  "/demo-videos/04.mp4",
  "/demo-videos/05.mp4",
  "/demo-videos/06.mp4",
  "/demo-videos/07.mp4",
  "/demo-videos/08.mp4",
];

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const capture = useAnalytics();

  return (
    <div className="page">
      <main className="hero">
        <header className="site-header">
          <Link className="brand" to="/" aria-label="Writer">
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
            href={__WRITER_DMG_URL__}
            onClick={() => capture("download_started", { app_version: __WRITER_VERSION__ })}
          >
            <AppleGlyph size={20} />
            <span>Download for MacOS</span>
          </a>
          <span className="alpha-pill">Alpha</span>
          <span className="version">v{__WRITER_VERSION__}</span>
        </div>

        <p className="caption">Free and open source. Forever</p>

        <ul className="features">
          {FEATURES.map(({ label, description }) => (
            <li className="feature" key={label}>
              <span className="feature-label">{label}</span>
              <span className="feature-desc">{description}</span>
            </li>
          ))}
        </ul>
      </main>

      <aside className="screenshots">
        {DEMOS.map((src) => (
          <DemoVideo key={src} src={src} />
        ))}
      </aside>
    </div>
  );
}

function DemoVideo({ src }: { src: string }) {
  return (
    <div className="shot">
      <video
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="Writer app demo"
      />
    </div>
  );
}
