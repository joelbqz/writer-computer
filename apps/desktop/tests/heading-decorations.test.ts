import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { headingDecorations, __test } from "../src/components/editor-area/heading-decorations";

const { collectHeadingNoGoZones, clampRangesToZones, couldBeInZone } = __test;

function makeState(doc: string, selection?: EditorSelection): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] }), headingDecorations],
    selection,
  });
  // Force a full parse so `syntaxTree(state)` is populated.
  ensureSyntaxTree(state, doc.length, 1000);
  return state;
}

describe("collectHeadingNoGoZones", () => {
  test("returns empty for a doc with no headings", () => {
    const state = makeState("just a paragraph");
    expect(collectHeadingNoGoZones(state)).toEqual([]);
  });

  test("zone for a single H1 covers [lineFrom, '# '.length)", () => {
    const state = makeState("# Title");
    expect(collectHeadingNoGoZones(state)).toEqual([{ from: 0, to: 2 }]);
  });

  test("zone for H3 covers '### '", () => {
    const state = makeState("### Subsection");
    expect(collectHeadingNoGoZones(state)).toEqual([{ from: 0, to: 4 }]);
  });

  test("collects every heading in the doc", () => {
    const doc = ["# A", "body", "## B", "para", "###### C"].join("\n");
    const state = makeState(doc);
    const zones = collectHeadingNoGoZones(state);
    expect(zones).toHaveLength(3);
    // H1 at 0
    expect(zones[0]).toEqual({ from: 0, to: 2 });
    // H2 starts after "# A\nbody\n" = 9
    expect(zones[1]).toEqual({ from: 9, to: 12 });
    // H6 starts after "# A\nbody\n## B\npara\n" = 19
    expect(zones[2]).toEqual({ from: 19, to: 26 });
  });

  test("ignores non-heading lines that start with #", () => {
    // "#NotHeading" (no space) is not an ATXHeading.
    const state = makeState("#NotHeading\n# Real");
    const zones = collectHeadingNoGoZones(state);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.from).toBe("#NotHeading\n".length);
  });
});

describe("couldBeInZone", () => {
  test("returns true for positions within first 7 chars of a line", () => {
    const state = makeState("# Title\nbody line two");
    for (let col = 0; col <= 7; col++) {
      expect(couldBeInZone(state, col)).toBe(true);
    }
  });

  test("returns false past column 7", () => {
    const state = makeState("body text longer than seven chars");
    expect(couldBeInZone(state, 8)).toBe(false);
    expect(couldBeInZone(state, 20)).toBe(false);
  });

  test("is line-local, not doc-wide", () => {
    const state = makeState("body\n# Title");
    // Position 5 is line 2 column 0 — fast-path applies.
    expect(couldBeInZone(state, 5)).toBe(true);
  });
});

describe("clampRangesToZones", () => {
  test("clamps caret inside a zone to zone.to", () => {
    const zones = [{ from: 0, to: 2 }];
    const ranges = [EditorSelection.range(0, 0)];
    const result = clampRangesToZones(ranges, zones);
    expect(result.changed).toBe(true);
    expect(result.ranges[0]?.anchor).toBe(2);
    expect(result.ranges[0]?.head).toBe(2);
  });

  test("leaves caret at zone.to alone (the exclusive end is safe)", () => {
    const zones = [{ from: 0, to: 2 }];
    const ranges = [EditorSelection.range(2, 2)];
    const result = clampRangesToZones(ranges, zones);
    expect(result.changed).toBe(false);
    expect(result.ranges[0]?.head).toBe(2);
  });

  test("clamps both endpoints of a non-empty range independently", () => {
    const zones = [{ from: 0, to: 2 }];
    // Selection from position 5 backward to position 1 (inside the zone).
    const ranges = [EditorSelection.range(5, 1)];
    const result = clampRangesToZones(ranges, zones);
    expect(result.changed).toBe(true);
    expect(result.ranges[0]?.anchor).toBe(5);
    expect(result.ranges[0]?.head).toBe(2);
  });

  test("handles multiple cursors landing in different zones", () => {
    const zones = [
      { from: 0, to: 2 },
      { from: 10, to: 13 },
    ];
    const ranges = [EditorSelection.range(0, 0), EditorSelection.range(11, 11)];
    const result = clampRangesToZones(ranges, zones);
    expect(result.changed).toBe(true);
    expect(result.ranges[0]?.head).toBe(2);
    expect(result.ranges[1]?.head).toBe(13);
  });

  test("no-op when nothing is in a zone", () => {
    const zones = [{ from: 0, to: 2 }];
    const ranges = [EditorSelection.range(5, 10)];
    const result = clampRangesToZones(ranges, zones);
    expect(result.changed).toBe(false);
  });
});

describe("headingSelectionGuard (via EditorState.update)", () => {
  test("clamps a dispatched caret-at-line-start into the hash range to hashEnd", () => {
    const state = makeState("# Title");
    const tr = state.update({ selection: { anchor: 0 } });
    expect(tr.newSelection.main.head).toBe(2);
  });

  test("clamps a caret on the trailing space of '# ' to position 2", () => {
    const state = makeState("# Title");
    const tr = state.update({ selection: { anchor: 1 } });
    expect(tr.newSelection.main.head).toBe(2);
  });

  test("clamps a caret on a '###' hash char to position 4", () => {
    const state = makeState("### Section");
    const tr = state.update({ selection: { anchor: 2 } });
    expect(tr.newSelection.main.head).toBe(4);
  });

  test("leaves a caret on the first heading char alone", () => {
    const state = makeState("# Title");
    const tr = state.update({ selection: { anchor: 2 } });
    expect(tr.newSelection.main.head).toBe(2);
  });

  test("leaves a caret in body text alone (fast-path)", () => {
    const state = makeState("# Title\nbody text here");
    // Position 10 = "body" line, column 2 — but past line start of line 2 so fine.
    const tr = state.update({ selection: { anchor: 13 } });
    expect(tr.newSelection.main.head).toBe(13);
  });

  test("clamps multi-cursor with one cursor in a zone", () => {
    const state = makeState("# Title\nbody");
    // Anchor 0 (in zone) + anchor 9 (column 1 of body line, not a heading).
    const tr = state.update({
      selection: EditorSelection.create([EditorSelection.range(0, 0), EditorSelection.range(9, 9)]),
    });
    expect(tr.newSelection.ranges[0]?.head).toBe(2);
    expect(tr.newSelection.ranges[1]?.head).toBe(9);
  });

  test("is a no-op when the doc has no headings", () => {
    const state = makeState("plain paragraph text");
    const tr = state.update({ selection: { anchor: 0 } });
    expect(tr.newSelection.main.head).toBe(0);
  });
});
