import { createFileRoute } from "@tanstack/react-router";

import { DownloadCta } from "../components/DownloadCta";
import { FeatureList } from "../components/FeatureList";
import { SiteHeader } from "../components/SiteHeader";
import { DOWNLOAD_SIZE, INSTALLED_SIZE_LIMIT, PRODUCT_NAME, SITE_URL, jsonLdScript } from "../site";

const TITLE = `${PRODUCT_NAME} features`;
const DESCRIPTION = `What ${PRODUCT_NAME} does: a free, open-source markdown editor for macOS that's about ${DOWNLOAD_SIZE}, starts faster than Apple Notes and Obsidian, and opens very large workspaces instantly.`;
// The prerendered `features/index.html` is served at `/features/`; Cloudflare
// redirects `/features` there, so this is the URL to name as canonical.
const PAGE_URL = `${SITE_URL}/features/`;

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
    label: "Private",
    description: "your documents stay on your computer; opt-in telemetry only",
  },
  {
    label: "Works with your folders",
    description: "Obsidian vaults, docs repos, wikis; respects .gitignore",
  },
  { label: "Extended markdown", description: "Mermaid, tables, math and HTML" },
  { label: "Multiwindow", description: "snappy switch between multiple workspaces" },
  { label: "Frontmatter", description: "YAML shown as editable properties" },
  { label: "Wikilinks", description: "[[links]] with autocomplete and image embeds" },
];

// Rendered as the visible questions and as the FAQPage JSON-LD below, so the
// two cannot disagree. Plain text only: structured data has no markup. Only
// what the feature list doesn't already answer; every answer is checked
// against the code and docs, see `SPECs/website-ai-search-spec.md`.
const QUESTIONS = [
  { question: "Is it free?", answer: `Yes. ${PRODUCT_NAME} has no account and no subscription.` },
  {
    question: "Is it open source?",
    answer: "Yes. The source is on GitHub at github.com/joelbqz/writer-computer.",
  },
  {
    question: "Does it work with my Obsidian vault?",
    answer:
      "Yes. Open the vault folder; wikilinks and image embeds work, and the .obsidian folder stays out of the sidebar. Plugins and callouts aren't supported.",
  },
  {
    question: "Does it change or move my files?",
    answer:
      "No. Notes stay .md files where they are and are edited in place. Pasted images go in a folder next to the note.",
  },
  {
    question: "Does it collect any data?",
    answer:
      "Only opt-in usage data, never your documents, file names or paths. Declining sends one event recording that choice.",
  },
];

const FAQ_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: QUESTIONS.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
};

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
    scripts: [jsonLdScript(FAQ_STRUCTURED_DATA)],
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

        <section className="questions" aria-labelledby="questions-heading">
          <h2 id="questions-heading">Questions</h2>
          {QUESTIONS.map(({ question, answer }) => (
            <details className="question" key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </section>
      </main>
    </div>
  );
}
