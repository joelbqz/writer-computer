import { Link, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { COMPARE } from "../compare/pages";
import { type ContentSection, pagePath } from "../content";
import { PRODUCT_NAME } from "../site";
import { SiteHeader } from "./SiteHeader";

/**
 * The frame every markdown section shares: the site header, a nav of the
 * section's pages, the page, and a footer that defines the app and links to
 * the download and the comparisons.
 */
export function ContentLayout({
  section,
  overview,
}: {
  section: ContentSection;
  overview: string;
}) {
  return (
    <div className="docs">
      <SiteHeader />
      <div className="docs-body">
        <nav className="docs-nav" aria-label={section.name}>
          <Link to={section.path} activeOptions={{ exact: true }}>
            {overview}
          </Link>
          {section.pages.map((page) => (
            <Link key={page.slug} to={pagePath(section, page)}>
              {page.title}
            </Link>
          ))}
        </nav>
        <main className="docs-main">
          <Outlet />
          <footer className="docs-footer">
            <p>
              {PRODUCT_NAME} is a free, open-source markdown editor for macOS.{" "}
              <Link to="/">Download it from the homepage</Link>.
            </p>
            <p>
              Compared with{" "}
              {COMPARE.pages.map((page, index) => (
                <span key={page.slug}>
                  {index > 0 && (index === COMPARE.pages.length - 1 ? " and " : ", ")}
                  <Link to={pagePath(COMPARE, page)}>{page.competitor}</Link>
                </span>
              ))}
              .
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

/** A section's index: its heading, an introduction and every page with its description. */
export function SectionIndex({
  section,
  title,
  children,
}: {
  section: ContentSection;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="doc">
      <h1>{title}</h1>
      {children}
      <ul className="docs-index">
        {section.pages.map((page) => (
          <li key={page.slug}>
            <Link to={pagePath(section, page)}>{page.title}</Link>
            <span>{page.description}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** One page's HTML, rendered at build time from the repo's markdown; see `docs-plugin.ts`. */
export function ContentArticle({ html }: { html: string }) {
  return <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />;
}
