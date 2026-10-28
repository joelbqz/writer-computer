import { Link } from "@tanstack/react-router";

import { useAnalytics } from "../analytics";
import { PRODUCT_NAME } from "../site";
import { WriterMark } from "./Mark";

/** The mark and nav pills the homepage and every docs page open with. */
export function SiteHeader() {
  const capture = useAnalytics();

  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label={PRODUCT_NAME}>
        <WriterMark size={18} />
        <span className="brand-rule" aria-hidden="true" />
      </Link>
      <nav className="site-nav">
        <Link className="pill pill-ghost" to="/docs/">
          Docs
        </Link>
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
  );
}
