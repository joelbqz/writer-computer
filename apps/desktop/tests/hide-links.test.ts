import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  defaultHideExtensions,
  hideExtension,
  prosemarkMarkdownSyntaxExtensions,
} from "../src/lib/prosemark-core/main";
import { linkUrlAt, rawUrlAt } from "../src/lib/prosemark-core/links";
import { withFullParse } from "./helpers/parsed-state";

function makeState(doc: string) {
  return withFullParse(
    EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
        defaultHideExtensions,
      ],
    }),
  );
}

function hiddenRanges(state: EditorState) {
  const ranges: Array<[number, number]> = [];
  state.field(hideExtension).between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: unknown };
    if (spec.class === "cm-hidden-token") ranges.push([from, to]);
  });
  return ranges;
}

describe("link hiding", () => {
  test("hides the title of a titled link along with its marks and URL", () => {
    const doc = 'see [text](http://x.y "the title") ok';
    const state = makeState(doc);
    const titleFrom = doc.indexOf('"the title"');
    const titleTo = titleFrom + '"the title"'.length;
    expect(hiddenRanges(state)).toContainEqual([titleFrom, titleTo]);
  });
});

describe("link lookup helpers", () => {
  test("linkUrlAt resolves the destination of the enclosing link", () => {
    const doc = "see [text](http://x.y) ok";
    const state = makeState(doc);
    expect(linkUrlAt(state, doc.indexOf("text") + 1)).toBe("http://x.y");
    expect(linkUrlAt(state, 1)).toBeUndefined();
  });

  test("rawUrlAt resolves bare URLs but not link destinations", () => {
    const doc = "go to https://example.com now";
    const state = makeState(doc);
    expect(rawUrlAt(state, doc.indexOf("example"))).toBe("https://example.com");
    const linked = makeState("see [text](http://x.y) ok");
    expect(rawUrlAt(linked, 13)).toBeUndefined();
  });
});
