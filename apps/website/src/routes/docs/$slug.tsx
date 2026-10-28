import { createFileRoute, notFound } from "@tanstack/react-router";
import { DOC_HTML } from "virtual:writer-docs";

import { DOCS_PATH, docPath, findDocPage } from "../../docs/pages";
import { APP_ID, AUTHOR_ID, PRODUCT_NAME, SITE_URL, jsonLdScript } from "../../site";

export const Route = createFileRoute("/docs/$slug")({
  loader: async ({ params }) => {
    const page = findDocPage(params.slug);
    if (!page) throw notFound();
    const { default: html } = await DOC_HTML[page.slug]();
    return { page, html };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { page } = loaderData;
    const url = `${SITE_URL}${docPath(page)}`;
    const title = `${page.title} — ${PRODUCT_NAME}`;
    return {
      meta: [
        { title },
        { name: "description", content: page.description },
        { property: "og:title", content: title },
        { property: "og:description", content: page.description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLdScript({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "TechArticle",
              headline: page.title,
              description: page.description,
              url,
              about: { "@id": APP_ID },
              author: { "@id": AUTHOR_ID },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: PRODUCT_NAME, item: `${SITE_URL}/` },
                { "@type": "ListItem", position: 2, name: "Docs", item: `${SITE_URL}${DOCS_PATH}` },
                { "@type": "ListItem", position: 3, name: page.title, item: url },
              ],
            },
          ],
        }),
      ],
    };
  },
  component: DocPage,
});

function DocPage() {
  const { html } = Route.useLoaderData();
  // Rendered at build time from the repo's own markdown; see `docs-plugin.ts`.
  return <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />;
}
