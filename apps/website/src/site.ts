/**
 * Facts the site states in more than one place: the visible copy, the head
 * tags and the JSON-LD. The static files in `public/` (`llms.txt`,
 * `sitemap.xml`, `robots.txt`) repeat some of them and must be kept in step
 * by hand.
 *
 * "Writer Computer" is the canonical name wherever the product is defined;
 * "Writer" alone collides with writer.com, iA Writer and LibreOffice Writer.
 * See `SPECs/website-ai-search-spec.md`.
 */
export const SITE_URL = "https://writer.computer";
export const PRODUCT_NAME = "Writer Computer";
export const SHORT_NAME = "Writer";
export const AUTHOR_X_URL = "https://x.com/joelbqz";
export const AUTHOR_GITHUB_URL = "https://github.com/joelbqz";
export const LICENSE_NAME = "GPL-3.0";
export const LICENSE_URL = `${__WRITER_REPO_URL__}/blob/master/LICENSE`;
export const LATEST_RELEASE_URL = `${__WRITER_REPO_URL__}/releases/latest`;

/**
 * Every Apple silicon Mac ships with macOS 11 or later, so the bundle's
 * `minimumSystemVersion` (10.15) never binds; the chip is the requirement.
 */
export const REQUIREMENTS = "Requires a Mac with Apple silicon (M1 or later)";

/**
 * A `head().scripts` entry carrying JSON-LD. `<` is escaped so no string in the
 * data (the FAQ mentions `<details>`) can close the script element early.
 */
export function jsonLdScript(data: object) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data).replace(/</g, "\\u003c"),
  };
}
