import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { buildLlmsTxt, buildSitemap, headingId, renderPage } from "../docs-plugin";
import { COMPARE } from "../src/compare/pages";
import { type ContentPage, type ContentSection, sectionTrail } from "../src/content";
import { SECTIONS } from "../src/sections";

const PAGE: ContentPage = {
  slug: "example",
  title: "Example page",
  description: "An example.",
  source: "src/docs/example.md",
};

const SECTION: ContentSection = { key: "docs", name: "Docs", path: "/docs/", pages: [PAGE] };

describe("renderPage", () => {
  test("renders the page and leaves contributor comments out", () => {
    const html = renderPage(
      "# Example page\n\n<!-- For contributors only. -->\n\nText with `code`.\n\n## A section\n",
      PAGE,
    );
    expect(html).toContain("<h1>Example page</h1>");
    expect(html).toContain('<h2 id="a-section">A section</h2>');
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("For contributors only");
  });

  test("a comment before the heading doesn't count as the first line", () => {
    expect(renderPage("<!-- note -->\n\n# Example page\n", PAGE)).toContain("<h1>");
  });

  test("fails when the heading doesn't match the page's title", () => {
    expect(() => renderPage("# Something else\n", PAGE)).toThrow(/expected "# Example page"/);
    expect(() => renderPage("Text first.\n\n# Example page\n", PAGE)).toThrow(/found no heading/);
  });

  test("a block line is replaced by the section's HTML, as is", () => {
    const html = renderPage("# Example page\n\nBefore.\n{{table}}\nAfter.\n", PAGE, {
      table: "<table><tr><td>*cell*</td></tr></table>",
    });
    expect(html).toContain("<p>Before.</p>\n<table><tr><td>*cell*</td></tr></table>");
    expect(html).toContain("<p>After.</p>");
  });

  test("a block line without its block, or a block without its line, fails", () => {
    expect(() => renderPage("# Example page\n\n{{table}}\n", PAGE)).toThrow(/no "table" block/);
    expect(() => renderPage("# Example page\n", PAGE, { table: "<table></table>" })).toThrow(
      /missing the \{\{table\}\} line/,
    );
  });

  test("every page in every section renders", () => {
    for (const section of SECTIONS) {
      for (const page of section.pages) {
        const source = readFileSync(resolve(import.meta.dirname, "..", page.source), "utf-8");
        expect(renderPage(source, page, section.blocks?.(page))).toContain(
          `<h1>${page.title}</h1>`,
        );
      }
    }
  });
});

describe("comparison pages", () => {
  test("the table has a row per fact and the competitor's checked date and sources", () => {
    for (const page of COMPARE.pages) {
      const { comparison } = COMPARE.blocks!(page);
      expect(comparison).toContain(`<th scope="col">${page.competitor}</th>`);
      const [year, , day] = page.checked.split("-").map(Number);
      expect(comparison).toMatch(new RegExp(`details as of \\w+ ${day}, ${year}`));
      for (const { url } of page.sources) expect(comparison).toContain(`href="${url}"`);
    }
  });
});

describe("sections", () => {
  test("comparisons sit under the docs, so they share its nav and breadcrumbs", () => {
    expect(sectionTrail(COMPARE).map((section) => section.path)).toEqual([
      "/docs/",
      "/docs/compare/",
    ]);
  });

  test("a nested section is served under its parent's path", () => {
    for (const section of SECTIONS) {
      if (section.parent) expect(section.path.startsWith(section.parent.path)).toBe(true);
    }
  });
});

describe("headingId", () => {
  test("matches GitHub's heading anchors", () => {
    expect(headingId("What is sent when it's on")).toBe("what-is-sent-when-its-on");
    expect(headingId("The writer command")).toBe("the-writer-command");
    expect(headingId("Pan & zoom")).toBe("pan--zoom");
  });
});

describe("generated files", () => {
  test("the sitemap lists each path under the site URL", () => {
    const sitemap = buildSitemap(["/", "/docs/"]);
    expect(sitemap).toContain("<loc>https://writer.computer/</loc>");
    expect(sitemap).toContain("<loc>https://writer.computer/docs/</loc>");
  });

  test("llms.txt gets one link per page in place of the section's marker", () => {
    const text = buildLlmsTxt("## Docs\n\n{{docs}}\n", [SECTION]);
    expect(text).toBe(
      "## Docs\n\n- [Example page](https://writer.computer/docs/example/): An example.\n",
    );
  });

  test("llms.txt without a section's marker fails instead of dropping the list", () => {
    expect(() => buildLlmsTxt("## Docs\n", [SECTION])).toThrow(/missing the \{\{docs\}\} line/);
  });
});
