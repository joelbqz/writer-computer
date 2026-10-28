import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { buildLlmsTxt, buildSitemap, headingId, renderDoc } from "../docs-plugin";
import { DOC_PAGES, type DocPage } from "../src/docs/pages";

const PAGE: DocPage = {
  slug: "example",
  title: "Example page",
  description: "An example.",
  source: "src/docs/example.md",
};

describe("renderDoc", () => {
  test("renders the page and leaves contributor comments out", () => {
    const html = renderDoc(
      "# Example page\n\n<!-- For contributors only. -->\n\nText with `code`.\n\n## A section\n",
      PAGE,
    );
    expect(html).toContain("<h1>Example page</h1>");
    expect(html).toContain('<h2 id="a-section">A section</h2>');
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("For contributors only");
  });

  test("a comment before the heading doesn't count as the first line", () => {
    expect(renderDoc("<!-- note -->\n\n# Example page\n", PAGE)).toContain("<h1>");
  });

  test("fails when the heading doesn't match the title in pages.ts", () => {
    expect(() => renderDoc("# Something else\n", PAGE)).toThrow(/expected "# Example page"/);
    expect(() => renderDoc("Text first.\n\n# Example page\n", PAGE)).toThrow(/found no heading/);
  });

  test("every page in pages.ts renders", () => {
    for (const page of DOC_PAGES) {
      const source = readFileSync(resolve(import.meta.dirname, "..", page.source), "utf-8");
      expect(renderDoc(source, page)).toContain(`<h1>${page.title}</h1>`);
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

  test("llms.txt gets one link per page in place of the marker", () => {
    const text = buildLlmsTxt("## Docs\n\n{{docs}}\n", [PAGE]);
    expect(text).toBe(
      "## Docs\n\n- [Example page](https://writer.computer/docs/example/): An example.\n",
    );
  });

  test("llms.txt without the marker fails instead of dropping the list", () => {
    expect(() => buildLlmsTxt("## Docs\n", [PAGE])).toThrow(/missing the \{\{docs\}\} line/);
  });
});
