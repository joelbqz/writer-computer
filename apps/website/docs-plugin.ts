import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, type Token } from "marked";
import type { Plugin } from "vite";

import { DOCS_PATH, DOC_PAGES, docPath, type DocPage } from "./src/docs/pages";
import { SITE_URL } from "./src/site";

/**
 * Renders the docs pages from markdown at build time, so the site ships each
 * page as HTML and never the parser, and writes `sitemap.xml` and `llms.txt`
 * from the same page list (`src/docs/pages.ts`).
 *
 * - `virtual:writer-docs` exports `DOC_HTML`, one lazy import per page, so a
 *   page's HTML is only fetched by the page that shows it.
 * - In dev the two generated files are served by middleware; in the build
 *   they are emitted into the client output next to `public/`.
 */

const INDEX_ID = "virtual:writer-docs";
const PAGE_ID_PREFIX = "virtual:writer-doc/";
const WEBSITE_ROOT = fileURLToPath(new URL(".", import.meta.url));
const LLMS_TEMPLATE = resolve(WEBSITE_ROOT, "src/llms.txt");
const DOCS_MARKER = "{{docs}}";

/** GitHub-style heading id, so section links match the ones GitHub shows. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function isComment(html: string): boolean {
  return /^\s*<!--[\s\S]*?-->\s*$/.test(html);
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    // Notes for contributors live in HTML comments; they stay in the source
    // file and out of the published page.
    html({ text }) {
      return isComment(text) ? "" : text;
    },
    heading({ tokens, depth, text }) {
      const inner = this.parser.parseInline(tokens);
      // The page has one h1 and nothing links to it.
      if (depth === 1) return `<h1>${inner}</h1>\n`;
      return `<h${depth} id="${headingId(text)}">${inner}</h${depth}>\n`;
    },
  },
});

function firstHeading(tokens: Token[]): Token | undefined {
  return tokens.find((token) => token.type !== "space" && token.type !== "html");
}

/**
 * The page's HTML. Throws when the file's first heading isn't the `# ` heading
 * `pages.ts` expects, so the nav, `<title>` and page never disagree.
 */
export function renderDoc(source: string, page: DocPage): string {
  const tokens = markdown.lexer(source);
  const first = firstHeading(tokens);
  if (first?.type !== "heading" || first.depth !== 1 || first.text !== page.title) {
    const found = first?.type === "heading" ? `"${first.text}"` : "no heading";
    throw new Error(
      `${page.source}: expected "# ${page.title}" (its title in src/docs/pages.ts) as the first line, found ${found}`,
    );
  }
  return markdown.parser(tokens);
}

export function buildSitemap(paths: readonly string[]): string {
  const urls = paths.map((path) => `  <url>\n    <loc>${SITE_URL}${path}</loc>\n  </url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/** `template` with its `{{docs}}` line replaced by one link per page. */
export function buildLlmsTxt(template: string, pages: readonly DocPage[]): string {
  if (!template.includes(DOCS_MARKER)) {
    throw new Error(`src/llms.txt: missing the ${DOCS_MARKER} line the docs list replaces`);
  }
  const links = pages
    .map((page) => `- [${page.title}](${SITE_URL}${docPath(page)}): ${page.description}`)
    .join("\n");
  return template.replace(DOCS_MARKER, links);
}

function generatedFiles(): Record<string, { type: string; source: string }> {
  return {
    "sitemap.xml": {
      type: "application/xml",
      source: buildSitemap(["/", DOCS_PATH, ...DOC_PAGES.map(docPath)]),
    },
    "llms.txt": {
      type: "text/plain; charset=utf-8",
      source: buildLlmsTxt(readFileSync(LLMS_TEMPLATE, "utf-8"), DOC_PAGES),
    },
  };
}

function sourceFile(page: DocPage): string {
  return resolve(WEBSITE_ROOT, page.source);
}

export function writerDocs(): Plugin {
  const watched = new Set([LLMS_TEMPLATE, ...DOC_PAGES.map(sourceFile)]);

  return {
    name: "writer-docs",

    resolveId(id) {
      if (id === INDEX_ID || id.startsWith(PAGE_ID_PREFIX)) return `\0${id}`;
      return undefined;
    },

    load(id) {
      if (id === `\0${INDEX_ID}`) {
        const entries = DOC_PAGES.map(
          (page) =>
            `  ${JSON.stringify(page.slug)}: () => import(${JSON.stringify(PAGE_ID_PREFIX + page.slug)}),`,
        );
        return `export const DOC_HTML = {\n${entries.join("\n")}\n};\n`;
      }
      if (id.startsWith(`\0${PAGE_ID_PREFIX}`)) {
        const slug = id.slice(PAGE_ID_PREFIX.length + 1);
        const page = DOC_PAGES.find((candidate) => candidate.slug === slug);
        if (!page) throw new Error(`No docs page "${slug}" in src/docs/pages.ts`);
        const file = sourceFile(page);
        this.addWatchFile(file);
        return `export default ${JSON.stringify(renderDoc(readFileSync(file, "utf-8"), page))};\n`;
      }
      return undefined;
    },

    configureServer(server) {
      server.watcher.add([...watched]);
      server.watcher.on("change", (file) => {
        if (!watched.has(file)) return;
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use((req, res, next) => {
        const file = generatedFiles()[req.url?.slice(1) ?? ""];
        if (!file) return next();
        res.setHeader("Content-Type", file.type);
        res.end(file.source);
      });
    },

    generateBundle() {
      if (this.environment.name !== "client") return;
      for (const [fileName, { source }] of Object.entries(generatedFiles())) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}
