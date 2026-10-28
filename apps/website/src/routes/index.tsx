import { createFileRoute } from "@tanstack/react-router";

import { DownloadCta } from "../components/DownloadCta";
import { FeatureList } from "../components/FeatureList";
import { SiteHeader } from "../components/SiteHeader";
import { SITE_URL } from "../site";

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
  return (
    <div className="page">
      <main className="hero">
        <SiteHeader />

        <h1 className="headline">Fast and lightweight app for your workspace's markdown files</h1>

        <DownloadCta />

        <p className="caption">Free and open source. Forever</p>

        <FeatureList features={FEATURES} />
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
