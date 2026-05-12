import { describe, expect, test } from "vite-plus/test";
import { createHeadingSlugger, slugifyHeading } from "../src/lib/heading-slug";

describe("slugifyHeading", () => {
  test("lowercases and joins words with hyphens", () => {
    expect(slugifyHeading("Hello World")).toBe("hello-world");
  });

  test("strips ASCII punctuation", () => {
    expect(slugifyHeading("Hello, World!")).toBe("hello-world");
    expect(slugifyHeading("foo.bar/baz")).toBe("foobarbaz");
    expect(slugifyHeading("(parens) and [brackets]")).toBe("parens-and-brackets");
  });

  test("collapses runs of whitespace", () => {
    expect(slugifyHeading("Hello   World")).toBe("hello-world");
    expect(slugifyHeading("\tHello\nWorld\t")).toBe("hello-world");
  });

  test("preserves digits and hyphens", () => {
    expect(slugifyHeading("Q3")).toBe("q3");
    expect(slugifyHeading("GFM-style")).toBe("gfm-style");
  });

  test("preserves underscores", () => {
    expect(slugifyHeading("foo_bar")).toBe("foo_bar");
  });

  test("preserves unicode letters", () => {
    expect(slugifyHeading("Café")).toBe("café");
    expect(slugifyHeading("日本語")).toBe("日本語");
  });

  test("strips general-punctuation block (em dash)", () => {
    expect(slugifyHeading("Title — Em Dash")).toBe("title-em-dash");
  });

  test("strips numeric periods", () => {
    expect(slugifyHeading("1.0 Release Notes")).toBe("10-release-notes");
  });

  test("returns empty string for all-punctuation input", () => {
    expect(slugifyHeading("!!!")).toBe("");
  });
});

describe("createHeadingSlugger", () => {
  test("returns the base slug on first call", () => {
    const slug = createHeadingSlugger();
    expect(slug("Title")).toBe("title");
  });

  test("appends -2, -3, ... for duplicates in document order", () => {
    const slug = createHeadingSlugger();
    expect(slug("Title")).toBe("title");
    expect(slug("Title")).toBe("title-2");
    expect(slug("Title")).toBe("title-3");
  });

  test("dedupes against earlier auto-numbered slugs to avoid collisions", () => {
    const slug = createHeadingSlugger();
    expect(slug("Title 2")).toBe("title-2");
    expect(slug("Title")).toBe("title");
    expect(slug("Title")).toBe("title-3");
  });

  test("treats each instance as independent", () => {
    const a = createHeadingSlugger();
    const b = createHeadingSlugger();
    expect(a("Heading")).toBe("heading");
    expect(b("Heading")).toBe("heading");
    expect(a("Heading")).toBe("heading-2");
    expect(b("Heading")).toBe("heading-2");
  });
});
