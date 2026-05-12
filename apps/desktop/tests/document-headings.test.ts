import { describe, expect, test } from "vite-plus/test";
import { buildSlugIndex, parseDocumentHeadings } from "../src/hooks/use-document-headings";

describe("parseDocumentHeadings", () => {
  test("returns empty array for empty content", () => {
    expect(parseDocumentHeadings("", { maxDepth: 3 })).toEqual([]);
  });

  test("extracts H1/H2/H3 headings with level and text", () => {
    const content = ["# Title", "Some body.", "## Section", "### Subsection", ""].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Section"],
      [3, "Subsection"],
    ]);
  });

  test("respects maxDepth", () => {
    const content = ["# A", "## B", "### C", "#### D"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 2 });
    expect(headings.map((h) => h.level)).toEqual([1, 2]);
  });

  test("computes line and pos for each heading", () => {
    const content = ["intro", "# Title", "para", "## Section"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings).toEqual([
      expect.objectContaining({ level: 1, text: "Title", line: 1, pos: "intro\n".length }),
      expect.objectContaining({
        level: 2,
        text: "Section",
        line: 3,
        pos: "intro\n# Title\npara\n".length,
      }),
    ]);
  });

  test("skips headings inside fenced code blocks", () => {
    const content = ["# Real", "```", "# Fake", "## Also fake", "```", "## Real too"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.text)).toEqual(["Real", "Real too"]);
  });

  test("supports tilde fences", () => {
    const content = ["# Real", "~~~", "# Fake", "~~~", "## Done"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.text)).toEqual(["Real", "Done"]);
  });

  test("ignores ATX without space after hashes", () => {
    const content = ["#NotHeading", "# Heading"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.text)).toEqual(["Heading"]);
  });

  test("strips trailing closing hashes from ATX headings", () => {
    expect(parseDocumentHeadings("## Title ##", { maxDepth: 3 })[0].text).toBe("Title");
  });

  test("ignores empty heading text", () => {
    expect(parseDocumentHeadings("# ", { maxDepth: 3 })).toEqual([]);
  });

  test("slug lowercases and hyphenates", () => {
    const headings = parseDocumentHeadings("# Hello, World!", { maxDepth: 3 });
    expect(headings[0].slug).toBe("hello-world");
  });

  test("slug strips punctuation but preserves unicode letters", () => {
    const headings = parseDocumentHeadings("# Café & Crème", { maxDepth: 3 });
    expect(headings[0].slug).toBe("café-crème");
  });

  test("dedupes colliding slugs with -2, -3 in document order", () => {
    const content = ["# Setup", "## Setup", "### Setup"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    expect(headings.map((h) => h.slug)).toEqual(["setup", "setup-2", "setup-3"]);
  });

  test("dedup walks deeper levels even when they're filtered from the rail", () => {
    const content = ["# Setup", "#### Setup", "## Setup"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3, slugDepth: 6 });
    expect(headings.map((h) => [h.level, h.slug])).toEqual([
      [1, "setup"],
      [2, "setup-3"],
    ]);
  });
});

describe("buildSlugIndex", () => {
  test("maps each slug to its heading", () => {
    const content = ["# A", "## B", "### A"].join("\n");
    const headings = parseDocumentHeadings(content, { maxDepth: 3 });
    const index = buildSlugIndex(headings);
    expect(index.size).toBe(3);
    expect(index.get("a")?.level).toBe(1);
    expect(index.get("a-2")?.level).toBe(3);
    expect(index.get("b")?.level).toBe(2);
  });
});
