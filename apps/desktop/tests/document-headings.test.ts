import { describe, expect, test } from "vite-plus/test";
import { parseDocumentHeadings } from "../src/hooks/use-document-headings";

describe("parseDocumentHeadings", () => {
  test("returns empty array for empty content", () => {
    expect(parseDocumentHeadings("", 3)).toEqual([]);
  });

  test("extracts H1/H2/H3 headings with level and text", () => {
    const content = ["# Title", "Some body.", "## Section", "### Subsection", ""].join("\n");
    const headings = parseDocumentHeadings(content, 3);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Section"],
      [3, "Subsection"],
    ]);
  });

  test("respects maxDepth", () => {
    const content = ["# A", "## B", "### C", "#### D"].join("\n");
    const headings = parseDocumentHeadings(content, 2);
    expect(headings.map((h) => h.level)).toEqual([1, 2]);
  });

  test("computes line and pos for each heading", () => {
    const content = ["intro", "# Title", "para", "## Section"].join("\n");
    const headings = parseDocumentHeadings(content, 3);
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
    const headings = parseDocumentHeadings(content, 3);
    expect(headings.map((h) => h.text)).toEqual(["Real", "Real too"]);
  });

  test("supports tilde fences", () => {
    const content = ["# Real", "~~~", "# Fake", "~~~", "## Done"].join("\n");
    const headings = parseDocumentHeadings(content, 3);
    expect(headings.map((h) => h.text)).toEqual(["Real", "Done"]);
  });

  test("ignores ATX without space after hashes", () => {
    const content = ["#NotHeading", "# Heading"].join("\n");
    const headings = parseDocumentHeadings(content, 3);
    expect(headings.map((h) => h.text)).toEqual(["Heading"]);
  });

  test("strips trailing closing hashes from ATX headings", () => {
    expect(parseDocumentHeadings("## Title ##", 3)[0].text).toBe("Title");
  });

  test("ignores empty heading text", () => {
    expect(parseDocumentHeadings("# ", 3)).toEqual([]);
  });

  test("slug lowercases and hyphenates", () => {
    const headings = parseDocumentHeadings("# Hello, World!", 3);
    expect(headings[0].slug).toBe("hello-world");
  });

  test("slug strips punctuation but preserves unicode letters", () => {
    const headings = parseDocumentHeadings("# Café & Crème", 3);
    expect(headings[0].slug).toBe("café-crème");
  });
});
