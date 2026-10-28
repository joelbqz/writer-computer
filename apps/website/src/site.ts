/**
 * Facts the site states in more than one place: the visible copy, the head
 * tags and the JSON-LD. `public/robots.txt` and the `llms.txt` template in
 * `src/llms.txt` repeat some of them and must be kept in step by hand.
 *
 * "Writer Computer" is the canonical name wherever the product is defined;
 * "Writer" alone collides with writer.com, iA Writer and LibreOffice Writer.
 * See `SPECs/website-ai-search-spec.md`.
 *
 * `vite.config.ts` imports this file too, so it must stay free of build-time
 * globals such as `__WRITER_REPO_URL__`.
 */
export const SITE_URL = "https://writer.computer";
export const PRODUCT_NAME = "Writer Computer";
export const SHORT_NAME = "Writer";
export const AUTHOR_X_URL = "https://x.com/joelbqz";
export const AUTHOR_GITHUB_URL = "https://github.com/joelbqz";

/** JSON-LD `@id`s, so the docs and comparison pages can point at the app and its author. */
export const APP_ID = `${SITE_URL}/#app`;
export const AUTHOR_ID = `${SITE_URL}/#author`;

/**
 * Measured on v0.8.0: the DMG is 6.1 MB, `Writer.app.tar.gz` 5.7 MB, and the
 * installed `Writer.app` 9.2 MB. Re-measure when a release grows; the
 * installed figure has little headroom. `llms.txt` and the README repeat these.
 * The download size is approximate and the installed one an upper bound, so
 * copy says "about" and "under" around them. The non-breaking spaces keep the
 * number and unit on one line.
 */
export const DOWNLOAD_SIZE = "6\u00a0MB";
export const INSTALLED_SIZE_LIMIT = "10\u00a0MB";

/**
 * A `head().scripts` entry carrying JSON-LD. `<` is escaped so no string in the
 * data can close the script element early.
 */
export function jsonLdScript(data: object) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data).replace(/</g, "\\u003c"),
  };
}
