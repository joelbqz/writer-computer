import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { foldExtension, foldableSyntaxFacet } from "../src/lib/prosemark-core/fold/core";
import { withFullParse } from "./helpers/parsed-state";

const mark = Decoration.mark({ class: "hit" });

function hits(doc: string, nodePath: string | string[] | ((p: string) => boolean)) {
  const state = withFullParse(
    EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [GFM] }),
        foldableSyntaxFacet.of({
          nodePath,
          keepDecorationOnUnfold: true,
          buildDecorations: (_state, node) => mark.range(node.from, node.to),
        }),
      ],
    }),
  );
  const out: string[] = [];
  state.field(foldExtension).between(0, doc.length, (from, to) => {
    out.push(doc.slice(from, to));
  });
  return out;
}

describe("foldableSyntaxFacet node matching", () => {
  test("bare node name matches that node only", () => {
    expect(hits("plain\n\n- item", "Paragraph")).toEqual(["plain", "item"]);
  });

  test("path spec matches on segment boundaries", () => {
    expect(hits("plain\n\n- item", "ListItem/Paragraph")).toEqual(["item"]);
    // A suffix that is not a whole segment must not match.
    expect(hits("plain\n\n- item", "tem/Paragraph")).toEqual([]);
  });

  test("array spec matches any entry", () => {
    expect(hits("plain\n\n- item", ["ListItem/Paragraph", "ListMark"])).toEqual(["-", "item"]);
  });

  test("predicate spec sees the full lineage path", () => {
    const seen: string[] = [];
    hits("plain", (p) => {
      seen.push(p);
      return p === "Document/Paragraph";
    });
    expect(seen).toContain("Document/Paragraph");
  });
});
