import { createFileRoute } from "@tanstack/react-router";

import { DownloadCta } from "../components/DownloadCta";
import { FeatureList } from "../components/FeatureList";
import { SiteHeader } from "../components/SiteHeader";
import { DOWNLOAD_SIZE, INSTALLED_SIZE_LIMIT, PRODUCT_NAME, SITE_URL } from "../site";

const TITLE = `${PRODUCT_NAME} features`;
const DESCRIPTION = `What ${PRODUCT_NAME} does: a free, open-source markdown editor for macOS that's about ${DOWNLOAD_SIZE}, starts faster than Apple Notes and Obsidian, and opens very large workspaces instantly.`;
// The prerendered `features/index.html` is served at `/features/`; Cloudflare
// redirects `/features` there, so this is the URL to name as canonical.
const PAGE_URL = `${SITE_URL}/features/`;

// Every line is checked against the code and docs; see
// `SPECs/website-ai-search-spec.md`.
const FEATURES = [
  { label: "Blazing fast", description: "starts faster than Apple Notes and Obsidian" },
  {
    label: "Instant cold starts",
    description: "even on very large workspaces; indexing runs in the background",
  },
  {
    label: "Tiny",
    description: `about ${DOWNLOAD_SIZE} download, under ${INSTALLED_SIZE_LIMIT} installed`,
  },
  {
    label: "Free and open source",
    description: "no account, no subscription; the source is on GitHub",
  },
  {
    label: "Private",
    description: "your documents stay on your computer; opt-in telemetry only",
  },
  {
    label: "Works with your folders",
    description: "Obsidian vaults, docs repos, wikis; respects .gitignore",
  },
  { label: "Plain files", description: "notes stay .md files where they are, edited in place" },
  { label: "Extended markdown", description: "Mermaid, tables, math and HTML" },
  { label: "Multiwindow", description: "snappy switch between multiple workspaces" },
  { label: "Frontmatter", description: "YAML shown as editable properties" },
  {
    label: "Wikilinks",
    description: "Obsidian-style [[links]] with autocomplete and image embeds",
  },
];

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: PAGE_URL },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
  }),
  component: FeaturesPage,
});

function FeaturesPage() {
  return (
    <div className="features-page">
      <SiteHeader />

      <main className="features-column">
        <h1 className="headline">{PRODUCT_NAME}</h1>
        <p className="lede">
          {PRODUCT_NAME} is a free, open-source markdown editor for macOS. It's about{" "}
          {DOWNLOAD_SIZE}, starts faster than Apple Notes and Obsidian, and works with the folders
          you already have, like Obsidian vaults and docs repos.
        </p>
        <DownloadCta />

        <section aria-labelledby="features-heading">
          <h2 className="sr-only" id="features-heading">
            Features
          </h2>
          <FeatureList features={FEATURES} />
        </section>
      </main>
    </div>
  );
}
