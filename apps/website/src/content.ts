/**
 * The site's markdown sections (`/docs/`, `/compare/`). Each section is a list
 * of pages, and each page is one markdown file that `docs-plugin.ts` renders
 * to HTML at build time and lists in `sitemap.xml` and `llms.txt`. A page's
 * file must start with `# <title>`; the build fails if it doesn't.
 *
 * Imported by `vite.config.ts` as well as the routes, so this file and the
 * section files must stay free of build-time globals such as
 * `__WRITER_VERSION__`.
 */
export interface ContentPage {
  /** URL segment: the page is served at `<section path><slug>/`. */
  slug: string;
  /** The page's `# ` heading, its nav label and the start of its `<title>`. */
  title: string;
  /** Meta description, and the line under the page's link on the section index. */
  description: string;
  /** Markdown source, relative to `apps/website/`. */
  source: string;
}

export interface ContentSection<Page extends ContentPage = ContentPage> {
  /** Names the section's `{{key}}` line in the `llms.txt` template. */
  key: string;
  /** Breadcrumb label. */
  name: string;
  /** Where the section's index is served, with both slashes. */
  path: string;
  pages: readonly Page[];
  /**
   * HTML built from data for a page, by name: a line `{{name}}` in the page's
   * markdown is replaced by `blocks(page)[name]`. Method syntax so a section
   * of a narrower page type still fits `ContentSection`.
   */
  blocks?(page: Page): Readonly<Record<string, string>>;
}

export function pagePath(section: ContentSection, page: ContentPage): string {
  return `${section.path}${page.slug}/`;
}

export function findPage<Page extends ContentPage>(
  section: ContentSection<Page>,
  slug: string,
): Page | undefined {
  return section.pages.find((page) => page.slug === slug);
}
