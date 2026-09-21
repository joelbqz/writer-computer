import { describe, expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  __testCodeFenceExtension,
  codeBlockDecorationsExtension,
} from "../src/lib/prosemark-core/codeFenceExtension";
import {
  clampOffset,
  codeBlockAt,
  codeBlockScrollField,
  revealOffset,
  setCodeBlockScroll,
  thumbGeometry,
  wheelDeltaX,
} from "../src/lib/prosemark-core/codeFenceScroll";
import { withFullParse } from "./helpers/parsed-state";

const first = ["```ts", "const a = 1;", "```"].join("\n");
const second = ["```", "b", "```"].join("\n");
const doc = `intro\n\n${first}\n\n${second}\n\nafter`;
const firstFrom = "intro\n\n".length;
const secondFrom = firstFrom + first.length + 2;

function makeState(content = doc): EditorState {
  return withFullParse(
    EditorState.create({
      doc: content,
      extensions: [markdown({ extensions: [GFM] }), codeBlockDecorationsExtension],
    }),
  );
}

function scrolled(state: EditorState, from: number, offset: number): EditorState {
  return state.update({ effects: setCodeBlockScroll.of({ from, offset }) }).state;
}

function lineStyles(state: EditorState): Map<number, string | undefined> {
  const styles = new Map<number, string | undefined>();
  const decorations = __testCodeFenceExtension.buildCodeBlockDecorations(
    state,
    [{ from: 0, to: state.doc.length }],
    state.field(codeBlockScrollField),
  );
  decorations.between(0, state.doc.length, (from, _to, decoration) => {
    const spec = decoration.spec as { class?: string; attributes?: { style?: string } };
    if (spec.class?.includes("cm-fenced-code-line")) styles.set(from, spec.attributes?.style);
  });
  return styles;
}

describe("codeBlockAt", () => {
  test("finds the block from its first line, a middle line, and after its closing fence", () => {
    const state = makeState();
    expect(codeBlockAt(state, firstFrom)?.from).toBe(firstFrom);
    expect(codeBlockAt(state, firstFrom + "```ts\n".length)?.from).toBe(firstFrom);
    expect(codeBlockAt(state, firstFrom + first.length)?.from).toBe(firstFrom);
  });

  test("returns null outside code blocks", () => {
    const state = makeState();
    expect(codeBlockAt(state, 0)).toBeNull();
    expect(codeBlockAt(state, state.doc.length)).toBeNull();
  });
});

describe("codeBlockScrollField", () => {
  test("starts empty and stores an offset per block start", () => {
    const state = scrolled(scrolled(makeState(), firstFrom, 120), secondFrom, 8);
    expect(state.field(codeBlockScrollField)).toEqual(
      new Map([
        [firstFrom, 120],
        [secondFrom, 8],
      ]),
    );
  });

  test("an offset of zero drops the entry", () => {
    const state = scrolled(scrolled(makeState(), firstFrom, 120), firstFrom, 0);
    expect(state.field(codeBlockScrollField).size).toBe(0);
  });

  test("a no-op effect keeps the same map instance", () => {
    const state = scrolled(makeState(), firstFrom, 120);
    const before = state.field(codeBlockScrollField);
    expect(scrolled(state, firstFrom, 120).field(codeBlockScrollField)).toBe(before);
  });

  test("follows the block through an insertion above it", () => {
    const state = scrolled(makeState(), secondFrom, 40);
    const inserted = "more intro\n";
    const next = state.update({ changes: { from: 0, insert: inserted } }).state;
    expect(next.field(codeBlockScrollField)).toEqual(new Map([[secondFrom + inserted.length, 40]]));
  });

  test("drops the entry when the block is deleted", () => {
    const state = scrolled(makeState(), firstFrom, 40);
    const next = state.update({
      changes: { from: firstFrom, to: firstFrom + first.length, insert: "plain text" },
    }).state;
    expect(next.field(codeBlockScrollField).size).toBe(0);
  });
});

describe("code block decorations", () => {
  test("lines carry no style until the block is scrolled", () => {
    const styles = lineStyles(makeState());
    expect(styles.size).toBe(6);
    expect([...styles.values()].every((style) => style === undefined)).toBe(true);
  });

  test("every line of a scrolled block gets the same negative text-indent", () => {
    const styles = lineStyles(scrolled(makeState(), firstFrom, 120));
    const firstLines = [...styles].filter(([from]) => from < secondFrom);
    const secondLines = [...styles].filter(([from]) => from >= secondFrom);
    expect(firstLines.map(([, style]) => style)).toEqual(Array(3).fill("text-indent:-120px"));
    expect(secondLines.map(([, style]) => style)).toEqual(Array(3).fill(undefined));
  });
});

describe("scroll geometry", () => {
  test("clampOffset keeps the offset within [0, max] and rounds to whole pixels", () => {
    expect(clampOffset(-5, 100)).toBe(0);
    expect(clampOffset(40.4, 100)).toBe(40);
    expect(clampOffset(140, 100)).toBe(100);
    expect(clampOffset(10, -3)).toBe(0);
  });

  test("revealOffset moves just enough to bring the caret inside the visible box", () => {
    expect(revealOffset(50, 120, 100, 300)).toBe(50);
    expect(revealOffset(50, 90, 100, 300)).toBe(40);
    expect(revealOffset(50, 330, 100, 300)).toBe(80);
  });

  test("thumbGeometry sizes the thumb to the visible share and slides it with the offset", () => {
    // 400px visible out of 800px content: half-width thumb, 200px of travel.
    expect(thumbGeometry(0, 400, 400)).toEqual({ left: 0, width: 200, perPixel: 2 });
    expect(thumbGeometry(200, 400, 400)).toEqual({ left: 100, width: 200, perPixel: 2 });
    expect(thumbGeometry(400, 400, 400)).toEqual({ left: 200, width: 200, perPixel: 2 });
    // A stale offset past the end pins the thumb to the end of the track.
    expect(thumbGeometry(900, 400, 400).left).toBe(200);
  });

  test("thumbGeometry keeps a minimum thumb width on very wide blocks", () => {
    const { left, width, perPixel } = thumbGeometry(10_000, 10_000, 100);
    expect(width).toBe(24);
    expect(left).toBe(76);
    expect(perPixel).toBeCloseTo(10_000 / 76);
  });

  test("wheelDeltaX scales line and page deltas into pixels", () => {
    expect(wheelDeltaX({ deltaX: 12, deltaMode: 0 }, 400)).toBe(12);
    expect(wheelDeltaX({ deltaX: 2, deltaMode: 1 }, 400)).toBe(32);
    expect(wheelDeltaX({ deltaX: 1, deltaMode: 2 }, 400)).toBe(400);
  });
});

describe("codeFenceTheme", () => {
  test("fenced code lines never wrap and clip their overflow", () => {
    const line = __testCodeFenceExtension.codeFenceThemeSpec[".cm-fenced-code-line"];
    expect(line.whiteSpace).toBe("pre");
    expect(line.overflowX).toBe("clip");
  });

  test("styles the overflow scrollbar thumb", () => {
    const thumb = __testCodeFenceExtension.codeFenceThemeSpec[".cm-code-scrollbar-thumb"];
    expect(thumb.backgroundColor).toContain("--scrollbar-thumb");
  });
});
