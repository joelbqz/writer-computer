import { notFound } from "@tanstack/react-router";
import { PAGE_HTML } from "virtual:writer-pages";

import { type ContentPage, type ContentSection, findPage, pagePath } from "./content";
import { APP_ID, AUTHOR_ID, PRODUCT_NAME, SITE_URL, jsonLdScript } from "./site";

/** Loader for a section's `$slug` route: the page and its prerendered HTML. */
export async function loadPage<Page extends ContentPage>(
  section: ContentSection<Page>,
  slug: string,
): Promise<{ page: Page; html: string }> {
  const page = findPage(section, slug);
  if (!page) throw notFound();
  const { default: html } = await PAGE_HTML[pagePath(section, page)]();
  return { page, html };
}

/** Head for a section's index: title, description, canonical and `og:*`. */
export function sectionIndexHead(section: ContentSection, title: string, description: string) {
  const url = `${SITE_URL}${section.path}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/**
 * Head for one page: title, description, canonical, `og:*`, and an article +
 * breadcrumb JSON-LD graph that points at the app and author the root head
 * declares.
 */
export function pageHead(
  section: ContentSection,
  page: ContentPage,
  articleType: "TechArticle" | "Article",
) {
  const url = `${SITE_URL}${pagePath(section, page)}`;
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
            "@type": articleType,
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
              {
                "@type": "ListItem",
                position: 2,
                name: section.name,
                item: `${SITE_URL}${section.path}`,
              },
              { "@type": "ListItem", position: 3, name: page.title, item: url },
            ],
          },
        ],
      }),
    ],
  };
}
