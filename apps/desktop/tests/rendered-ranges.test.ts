import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  offscreenSelectionLines,
  renderedRanges,
  renderedRangesChanged,
} from "../src/lib/prosemark-core/utils";

// Five lines of ten characters: line n spans [11(n-1), 11(n-1)+10].
const DOC = ["# Heading!", "para one..", "para two..", "para three", "para four."].join("\n");
const line = (n: number) => ({ from: 11 * (n - 1), to: 11 * (n - 1) + 10 });

function state(anchor: number, head = anchor) {
  return EditorState.create({ doc: DOC, selection: EditorSelection.single(anchor, head) });
}

describe("offscreenSelectionLines", () => {
  test("is empty while the selection sits inside the viewport", () => {
    expect(offscreenSelectionLines({ state: state(25), viewport: line(3) })).toEqual([]);
  });

  test("treats the viewport bounds as inside, like CodeMirror does", () => {
    expect(offscreenSelectionLines({ state: state(22), viewport: { from: 22, to: 40 } })).toEqual(
      [],
    );
    expect(offscreenSelectionLines({ state: state(40), viewport: { from: 22, to: 40 } })).toEqual(
      [],
    );
  });

  test("returns the caret's line once it scrolls out of the viewport", () => {
    expect(offscreenSelectionLines({ state: state(3), viewport: line(3) })).toEqual([line(1)]);
  });

  test("returns anchor and head lines of a range selection, deduplicated", () => {
    expect(offscreenSelectionLines({ state: state(2, 50), viewport: line(3) })).toEqual([
      line(1),
      line(5),
    ]);
    expect(offscreenSelectionLines({ state: state(2, 8), viewport: line(3) })).toEqual([line(1)]);
  });
});

describe("renderedRanges", () => {
  test("is the visible ranges themselves when nothing is off screen", () => {
    const visibleRanges = [line(3)];
    expect(renderedRanges({ state: state(25), viewport: line(3), visibleRanges })).toBe(
      visibleRanges,
    );
  });

  test("adds off-viewport selection lines in document order", () => {
    expect(
      renderedRanges({ state: state(50, 2), viewport: line(3), visibleRanges: [line(3)] }),
    ).toEqual([line(1), line(3), line(5)]);
  });
});

describe("renderedRangesChanged", () => {
  const view = (s: EditorState) => ({ state: s, viewport: line(3) });

  test("is true whenever the viewport changed", () => {
    const s = state(25);
    expect(
      renderedRangesChanged({
        viewportChanged: true,
        selectionSet: false,
        startState: s,
        view: view(s),
      }),
    ).toBe(true);
  });

  test("ignores a caret moving between lines inside the viewport", () => {
    expect(
      renderedRangesChanged({
        viewportChanged: false,
        selectionSet: true,
        startState: state(23),
        view: view(state(30)),
      }),
    ).toBe(false);
  });

  test("ignores a caret moving within its off-viewport line", () => {
    expect(
      renderedRangesChanged({
        viewportChanged: false,
        selectionSet: true,
        startState: state(1),
        view: view(state(5)),
      }),
    ).toBe(false);
  });

  test("is true when the caret leaves the viewport, enters it, or changes off-viewport line", () => {
    const changed = (a: number, b: number) =>
      renderedRangesChanged({
        viewportChanged: false,
        selectionSet: true,
        startState: state(a),
        view: view(state(b)),
      });
    expect(changed(25, 1)).toBe(true);
    expect(changed(1, 25)).toBe(true);
    expect(changed(1, 50)).toBe(true);
  });

  test("is false without a selection change", () => {
    expect(
      renderedRangesChanged({
        viewportChanged: false,
        selectionSet: false,
        startState: state(1),
        view: view(state(1)),
      }),
    ).toBe(false);
  });
});
