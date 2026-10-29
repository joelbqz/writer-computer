import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, type Token } from "marked";
import type { Plugin } from "vite";

import { type ContentPage, type ContentSection, pagePath } from "./src/content";
import { SECTIONS } from "./src/sections";
import { SITE_URL } from "./src/site";

/**
 * Renders the markdown sections (`src/sections.ts`) at build time, so the site
 * ships each page as HTML and never the parser, and writes `sitemap.xml` and
 * `llms.txt` from the same page lists.
 *
 * - `virtual:writer-pages` exports `PAGE_HTML`, one lazy import per page keyed
 *   by its path, so a page's HTML is only fetched by the page that shows it.
 * - In dev the two generated files are served by middleware; in the build
 *   they are emitted into the client output next to `public/`.
 */

const INDEX_ID = "virtual:writer-pages";
const PAGE_ID_PREFIX = "virtual:writer-page";
const WEBSITE_ROOT = fileURLToPath(new URL(".", import.meta.url));
const LLMS_TEMPLATE = resolve(WEBSITE_ROOT, "src/llms.txt");
const BLOCK_LINE = /^\{\{(\w+)\}\}$/gm;

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
 * The page's HTML. A line `{{name}}` is replaced by `blocks[name]`, HTML the
 * section builds from data. Throws when the file's first heading isn't the
 * page's title, or when a block line and the blocks given don't match up, so
 * the nav, `<title>` and page never disagree and no block is silently dropped.
 */
export function renderPage(
  source: string,
  page: ContentPage,
  blocks: Readonly<Record<string, string>> = {},
): string {
  const unused = new Set(Object.keys(blocks));
  const withBlocks = source.replace(BLOCK_LINE, (_line, name: string) => {
    const html = blocks[name];
    if (html === undefined) throw new Error(`${page.source}: no "${name}" block for {{${name}}}`);
    unused.delete(name);
    // Blank lines around it so marked treats it as one raw HTML block.
    return `\n${html}\n`;
  });
  if (unused.size > 0) {
    throw new Error(`${page.source}: missing the {{${[...unused].join("}}, {{")}}} line`);
  }

  const tokens = markdown.lexer(withBlocks);
  const first = firstHeading(tokens);
  if (first?.type !== "heading" || first.depth !== 1 || first.text !== page.title) {
    const found = first?.type === "heading" ? `"${first.text}"` : "no heading";
    throw new Error(
      `${page.source}: expected "# ${page.title}" (its title in the section's page list) as the first line, found ${found}`,
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

/** `template` with each section's `{{key}}` line replaced by one link per page. */
export function buildLlmsTxt(template: string, sections: readonly ContentSection[]): string {
  let text = template;
  for (const section of sections) {
    const marker = `{{${section.key}}}`;
    if (!text.includes(marker)) {
      throw new Error(`src/llms.txt: missing the ${marker} line the ${section.name} list replaces`);
    }
    const links = section.pages
      .map(
        (page) => `- [${page.title}](${SITE_URL}${pagePath(section, page)}): ${page.description}`,
      )
      .join("\n");
    text = text.replace(marker, links);
  }
  return text;
}

function generatedFiles(): Record<string, { type: string; source: string }> {
  const paths = SECTIONS.flatMap((section) => [
    section.path,
    ...section.pages.map((page) => pagePath(section, page)),
  ]);
  return {
    "sitemap.xml": { type: "application/xml", source: buildSitemap(["/", ...paths]) },
    "llms.txt": {
      type: "text/plain; charset=utf-8",
      source: buildLlmsTxt(readFileSync(LLMS_TEMPLATE, "utf-8"), SECTIONS),
    },
  };
}

function sourceFile(page: ContentPage): string {
  return resolve(WEBSITE_ROOT, page.source);
}

function pageAt(path: string): { section: ContentSection; page: ContentPage } | undefined {
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      if (pagePath(section, page) === path) return { section, page };
    }
  }
  return undefined;
}

export function writerDocs(): Plugin {
  const watched = new Set([
    LLMS_TEMPLATE,
    ...SECTIONS.flatMap((section) => section.pages.map(sourceFile)),
  ]);

  return {
    name: "writer-docs",

    resolveId(id) {
      if (id === INDEX_ID || id.startsWith(`${PAGE_ID_PREFIX}/`)) return `\0${id}`;
      return undefined;
    },

    load(id) {
      if (id === `\0${INDEX_ID}`) {
        const entries = SECTIONS.flatMap((section) =>
          section.pages.map((page) => {
            const path = pagePath(section, page);
            return `  ${JSON.stringify(path)}: () => import(${JSON.stringify(PAGE_ID_PREFIX + path)}),`;
          }),
        );
        return `export const PAGE_HTML = {\n${entries.join("\n")}\n};\n`;
      }
      if (id.startsWith(`\0${PAGE_ID_PREFIX}/`)) {
        const path = id.slice(PAGE_ID_PREFIX.length + 1);
        const found = pageAt(path);
        if (!found) throw new Error(`No page at ${path} in src/sections.ts`);
        const { section, page } = found;
        const file = sourceFile(page);
        this.addWatchFile(file);
        const html = renderPage(readFileSync(file, "utf-8"), page, section.blocks?.(page));
        return `export default ${JSON.stringify(html)};\n`;
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
