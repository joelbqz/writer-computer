import { describe, expect, test } from "vite-plus/test";
import { getDocumentStats } from "../src/lib/document-stats";

describe("getDocumentStats", () => {
  test("empty document", () => {
    expect(getDocumentStats("")).toEqual({ words: 0, characters: 0, paragraphs: 0 });
    expect(getDocumentStats("   \n\n  ")).toEqual({ words: 0, characters: 0, paragraphs: 0 });
  });

  test("strips markdown prefixes and counts words, characters, paragraphs", () => {
    const doc = "# Title\n\n- one two\n- three\n\n> quoted `code` [link](x) [[wiki]]\n";
    expect(getDocumentStats(doc)).toEqual({ words: 8, characters: 41, paragraphs: 3 });
  });

  test("counts an emoji as one character", () => {
    expect(getDocumentStats("hi 😀")).toEqual({ words: 2, characters: 4, paragraphs: 1 });
  });

  test("collapses whitespace runs to one character", () => {
    expect(getDocumentStats("a   b\n\n\nc")).toEqual({ words: 3, characters: 5, paragraphs: 2 });
  });
});
