import { Link, Outlet } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { type ContentSection, pagePath } from "../content";
import { SECTIONS } from "../sections";
import { PRODUCT_NAME } from "../site";
import { SiteHeader } from "./SiteHeader";

/**
 * The frame of every docs page: the site header, a nav of every section's
 * pages, the page, and a footer that defines the app and links to the download. The top section's index is "Overview"; a nested
 * section's index heads its group of pages.
 */
export function ContentLayout() {
  return (
    <div className="docs">
      <SiteHeader />
      <div className="docs-body">
        <nav className="docs-nav" aria-label="Docs">
          {SECTIONS.map((section) => (
            <Fragment key={section.key}>
              <Link
                to={section.path}
                className={section.parent ? "docs-nav-group" : undefined}
                activeOptions={{ exact: true }}
              >
                {section.parent ? section.name : "Overview"}
              </Link>
              {section.pages.map((page) => (
                <Link key={page.slug} to={pagePath(section, page)}>
                  {page.title}
                </Link>
              ))}
            </Fragment>
          ))}
        </nav>
        <main className="docs-main">
          <Outlet />
          <footer className="docs-footer">
            <p>
              {PRODUCT_NAME} is a free, open-source markdown editor for macOS.{" "}
              <Link to="/">Download it from the homepage</Link>.
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
