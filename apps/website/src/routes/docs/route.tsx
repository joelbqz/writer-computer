import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { SiteHeader } from "../../components/SiteHeader";
import { DOC_PAGES } from "../../docs/pages";
import { PRODUCT_NAME } from "../../site";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  return (
    <div className="docs">
      <SiteHeader />
      <div className="docs-body">
        <nav className="docs-nav" aria-label="Docs">
          <Link to="/docs/" activeOptions={{ exact: true }}>
            Overview
          </Link>
          {DOC_PAGES.map((page) => (
            <Link key={page.slug} to="/docs/$slug/" params={{ slug: page.slug }}>
              {page.title}
            </Link>
          ))}
        </nav>
        <main className="docs-main">
          <Outlet />
          <p className="docs-footer">
            {PRODUCT_NAME} is a free, open-source markdown editor for macOS.{" "}
            <Link to="/">Download it from the homepage</Link>.
          </p>
        </main>
      </div>
    </div>
  );
}
