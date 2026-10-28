# Website Docs Spec

## Summary

Add a small docs section to writer.computer at `/docs/`, so search engines and AI assistants have pages that answer specific questions (opening an Obsidian vault, Mermaid, LaTeX math, shortcuts) and people who find them can read how the app behaves before downloading it. Follows [`website-ai-search-spec.md`](./website-ai-search-spec.md), whose one-page site had about 60 visible words to rank on.

## Decisions

- **Five pages, each written around a question people search for**, not around the app's menus: open a folder or vault, Obsidian compatibility, Mermaid diagrams, math with LaTeX, keyboard shortcuts. Plus an index at `/docs/`. A privacy and telemetry page was dropped at the owner's request; `docs/telemetry.md` on GitHub remains the disclosure, linked from `llms.txt`.
- **Facts come from the code, not the specs.** Each claim was checked against `apps/desktop/` on master at v0.8.0 (which ships Pele). What the app doesn't do is stated as plainly as what it does (no callouts, no note embeds, `[[Note#Heading]]` doesn't jump to the heading, renames don't update links), because assistants repeat those limits and readers trust a page that names them.
- **One source per fact.**
  - `apps/website/src/docs/pages.ts` is the page list: slug, title, description and markdown source. The nav, the index, `sitemap.xml` and the docs list in `llms.txt` are all built from it, so adding a page is one entry plus its file.
  - The shortcuts page is `docs/keyboard-shortcuts.md`, the app's canonical shortcut map, published as is. Its prose is now written for users; implementation notes moved into HTML comments, which the site drops.
- **Rendered at build time.** `apps/website/docs-plugin.ts` turns each markdown file into HTML with `marked` (a dev dependency) and serves it through `virtual:writer-pages` (renamed from `virtual:writer-docs` when `/compare/` was added), one lazy chunk per page. The client bundle carries HTML strings, not a parser. The build fails if a file's `# ` heading differs from its title in `pages.ts`.
- **Trailing-slash URLs.** Pages prerender to `<path>/index.html`, which Cloudflare serves at `<path>/`. The router uses `trailingSlash: "always"` so links and canonicals already carry the slash and crawlers never hit the redirect.
- **Head per page:** title `<Page> — Writer Computer`, description, canonical, `og:*` overrides, and a `TechArticle` + `BreadcrumbList` JSON-LD graph pointing at the app (`#app`) and author (`#author`) declared in the root head.
- **Shared header.** The homepage and docs render `components/SiteHeader.tsx`, which adds a **Docs** pill before Updates and GitHub. The pill sends no event; docs visits are counted by PostHog's own `$pageview`. The homepage's copy is unchanged.
- **Every docs page ends with the definition** ("Writer Computer is a free, open-source markdown editor for macOS") and a link home, so a reader arriving from search can get to the download.

## Out of scope

- A blog, search within the docs. (Comparison pages came later: [`website-compare-spec.md`](./website-compare-spec.md).)
- Rendering Mermaid or KaTeX output on the site; the Mermaid page shows the existing demo video instead.
- A Markdown syntax reference page (tables, task lists, frontmatter); the Obsidian page covers the overlap.

## Validation

- `vp check`, `vp test` (`apps/website/tests/docs.test.ts` renders every registered page and covers the title check, comment stripping, heading ids, sitemap and `llms.txt` generation).
- `vp run website#build` prerenders `/`, `/docs/` and the five pages; each has one title, description, canonical and `og:url`, and the docs pages carry the extra JSON-LD.
- Screenshots at 1440 px and 390 px; no page scrolls horizontally at 390 px. Client-side navigation between docs pages swaps the page and its head without a reload.
