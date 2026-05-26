import { describe, expect, test } from "vite-plus/test";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { prosemarkMarkdownSyntaxExtensions } from "../src/lib/prosemark-core/markdown";

function makeState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM, prosemarkMarkdownSyntaxExtensions] })],
  });
  ensureSyntaxTree(state, doc.length, 1000);
  return state;
}

function nodeTexts(doc: string, nodeName: string): string[] {
  const state = makeState(doc);
  const texts: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === nodeName) texts.push(doc.slice(node.from, node.to));
    },
  });
  return texts;
}

describe("markdown links with spaced destinations", () => {
  test("parses bare-space markdown link destinations", () => {
    const doc = "[Todo Label](Writer TODOs.md)";
    expect(nodeTexts(doc, "Link")).toEqual([doc]);
    expect(nodeTexts(doc, "URL")).toEqual(["Writer TODOs.md"]);
  });

  test("parses bare-space markdown image destinations", () => {
    const doc = "![Image Label](Writer TODOs-assets/20260525 image.png)";
    expect(nodeTexts(doc, "Image")).toEqual([doc]);
    expect(nodeTexts(doc, "URL")).toEqual(["Writer TODOs-assets/20260525 image.png"]);
  });

  test("keeps quoted titles separate from spaced destinations", () => {
    const doc = '[Todo](Writer TODOs.md "Readable Title")';
    expect(nodeTexts(doc, "Link")).toEqual([doc]);
    expect(nodeTexts(doc, "URL")).toEqual(["Writer TODOs.md"]);
    expect(nodeTexts(doc, "LinkTitle")).toEqual(['"Readable Title"']);
  });

  test("leaves standard title parsing intact when the destination has no spaces", () => {
    const doc = '[Todo](writer-todos.md "Readable Title")';
    expect(nodeTexts(doc, "URL")).toEqual(["writer-todos.md"]);
    expect(nodeTexts(doc, "LinkTitle")).toEqual(['"Readable Title"']);
  });
});
