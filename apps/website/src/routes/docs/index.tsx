import { Link, createFileRoute } from "@tanstack/react-router";

import { DOCS_PATH, DOC_PAGES } from "../../docs/pages";
import { PRODUCT_NAME, SITE_URL } from "../../site";

const TITLE = `Docs — ${PRODUCT_NAME}`;
const DESCRIPTION = `How to use ${PRODUCT_NAME}, the free, open-source markdown editor for macOS: opening folders and Obsidian vaults, Mermaid diagrams, LaTeX math and keyboard shortcuts.`;
const PAGE_URL = `${SITE_URL}${DOCS_PATH}`;

export const Route = createFileRoute("/docs/")({
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
  component: DocsIndex,
});

function DocsIndex() {
  return (
    <article className="doc">
      <h1>{PRODUCT_NAME} docs</h1>
      <p>
        {PRODUCT_NAME} is a free, open-source markdown editor for macOS that opens the folders you
        already have. These pages cover what it reads, how it treats your files and how to use it.
      </p>
      <ul className="docs-index">
        {DOC_PAGES.map((page) => (
          <li key={page.slug}>
            <Link to="/docs/$slug/" params={{ slug: page.slug }}>
              {page.title}
            </Link>
            <span>{page.description}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
