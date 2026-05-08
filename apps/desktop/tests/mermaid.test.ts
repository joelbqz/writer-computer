import { describe, expect, test, vi, beforeEach } from "vite-plus/test";

// Mock beautiful-mermaid before importing the renderer
vi.mock("beautiful-mermaid", () => {
  const renderMermaidSVG = vi
    .fn()
    .mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  return { renderMermaidSVG };
});

// Import after mock setup
const { renderMermaid, clearMermaidCache } =
  await import("../src/components/editor-area/mermaid-renderer");

describe("renderMermaid", () => {
  beforeEach(() => {
    clearMermaidCache();
    vi.clearAllMocks();
  });

  test("renders valid mermaid source and returns SVG", () => {
    const result = renderMermaid("graph TD;\n  A-->B;");
    expect(result.svg).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain("<svg");
  });

  test("returns cached SVG on second call with same source", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");

    const result1 = renderMermaid("graph TD;\n  A-->B;");
    expect(result1.svg).toBeDefined();

    const result2 = renderMermaid("graph TD;\n  A-->B;");
    expect(result2.svg).toBe(result1.svg);

    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
  });

  test("returns error result when the renderer throws", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockImplementationOnce(() => {
      throw new Error("Parse error in mermaid");
    });

    const result = renderMermaid("not valid mermaid");
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Parse error in mermaid");
    expect(result.svg).toBeUndefined();
  });

  test("handles non-Error thrown values", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockImplementationOnce(() => {
      throw "string error";
    });

    const result = renderMermaid("bad source");
    expect(result.error).toBe("string error");
    expect(result.svg).toBeUndefined();
  });

  test("strips <script> blocks from the rendered SVG", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockReturnValueOnce(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>',
    );

    const result = renderMermaid("xss-script");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("alert(1)");
    expect(result.svg).toContain("<rect");
  });

  test("strips self-closing <script/> tags from the rendered SVG", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockReturnValueOnce(
      '<svg xmlns="http://www.w3.org/2000/svg"><script src="evil.js"/><rect/></svg>',
    );

    const result = renderMermaid("xss-script-selfclosing");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("evil.js");
  });

  test("strips on*= event handler attributes from the rendered SVG", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockReturnValueOnce(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" onmouseover=\'evil()\' onload=stealCookies() /></svg>',
    );

    const result = renderMermaid("xss-handlers");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("onclick");
    expect(result.svg).not.toContain("onmouseover");
    expect(result.svg).not.toContain("onload");
    expect(result.svg).not.toContain("alert(1)");
    expect(result.svg).not.toContain("evil()");
    expect(result.svg).not.toContain("stealCookies");
    expect(result.svg).toContain("<rect");
  });
});

const { MERMAID_CANVAS_HEIGHT } = await import("../src/components/editor-area/mermaid-canvas");
const { computeToggleSelection } =
  await import("../src/components/editor-area/mermaid-decorations");

describe("mermaid canvas frame", () => {
  test("MERMAID_CANVAS_HEIGHT is a positive fixed integer height", () => {
    expect(MERMAID_CANVAS_HEIGHT).toBeGreaterThan(0);
    expect(Number.isInteger(MERMAID_CANVAS_HEIGHT)).toBe(true);
  });
});

describe("computeToggleSelection", () => {
  // Mock fence positions; only the relative ordering matters
  // (fenceFrom < fenceTo < docLength).
  const fenceFrom = 10;
  const fenceTo = 46;
  const docLength = 200;

  test("preview → edit returns a reverse range covering the whole fence", () => {
    expect(computeToggleSelection(false, fenceFrom, fenceTo, docLength)).toEqual({
      anchor: fenceTo,
      head: fenceFrom,
    });
  });

  test("edit → preview moves caret just past the closing fence", () => {
    expect(computeToggleSelection(true, fenceFrom, fenceTo, docLength)).toEqual({
      anchor: fenceTo + 1,
    });
  });

  test("edit → preview clamps to document length when fence is at EOF", () => {
    expect(computeToggleSelection(true, fenceFrom, 199, 199)).toEqual({ anchor: 199 });
  });
});

const { EditorState, EditorSelection } = await import("@codemirror/state");
const { markdown } = await import("@codemirror/lang-markdown");
const { GFM } = await import("@lezer/markdown");
const { foldExtension } = await import("@prosemark/core");
const {
  dragFrozenSelectionField,
  startDragEffect,
  endDragEffect,
  rangesTouchInclusive,
  mermaidDecorations,
} = await import("../src/components/editor-area/mermaid-decorations");

describe("rangesTouchInclusive", () => {
  test("returns true for an overlap with shared boundary", () => {
    expect(rangesTouchInclusive([EditorSelection.range(5, 10)], { from: 10, to: 20 })).toBe(true);
  });

  test("returns true when range fully contains the node", () => {
    expect(rangesTouchInclusive([EditorSelection.range(0, 100)], { from: 10, to: 20 })).toBe(true);
  });

  test("returns false when range is fully before the node", () => {
    expect(rangesTouchInclusive([EditorSelection.range(0, 9)], { from: 10, to: 20 })).toBe(false);
  });

  test("returns false when range is fully after the node", () => {
    expect(rangesTouchInclusive([EditorSelection.range(21, 30)], { from: 10, to: 20 })).toBe(false);
  });

  test("scans every range, returning true if any touches", () => {
    expect(
      rangesTouchInclusive([EditorSelection.range(0, 5), EditorSelection.range(15, 16)], {
        from: 10,
        to: 20,
      }),
    ).toBe(true);
  });
});

describe("dragFrozenSelectionField", () => {
  function makeState() {
    return EditorState.create({
      doc: "hello world",
      extensions: [dragFrozenSelectionField],
    });
  }

  test("starts as null", () => {
    expect(makeState().field(dragFrozenSelectionField)).toBeNull();
  });

  test("startDragEffect snapshots the provided ranges", () => {
    const s0 = makeState();
    const ranges = [EditorSelection.range(2, 5)];
    const s1 = s0.update({ effects: startDragEffect.of(ranges) }).state;
    expect(s1.field(dragFrozenSelectionField)).toEqual(ranges);
  });

  test("endDragEffect clears the snapshot", () => {
    const s0 = makeState();
    const s1 = s0.update({
      effects: startDragEffect.of([EditorSelection.range(2, 5)]),
    }).state;
    const s2 = s1.update({ effects: endDragEffect.of(null) }).state;
    expect(s2.field(dragFrozenSelectionField)).toBeNull();
  });

  test("snapshot maps through doc changes mid-drag", () => {
    const s0 = makeState();
    const s1 = s0.update({
      effects: startDragEffect.of([EditorSelection.range(2, 5)]),
    }).state;
    // Insert 3 chars at offset 0 — frozen ranges should shift forward.
    const s2 = s1.update({ changes: { from: 0, insert: "XXX" } }).state;
    const frozen = s2.field(dragFrozenSelectionField);
    expect(frozen).not.toBeNull();
    expect(frozen![0].from).toBe(5);
    expect(frozen![0].to).toBe(8);
  });

  test("non-effect transactions leave the snapshot unchanged", () => {
    const s0 = makeState();
    const ranges = [EditorSelection.range(2, 5)];
    const s1 = s0.update({ effects: startDragEffect.of(ranges) }).state;
    const s2 = s1.update({ selection: EditorSelection.single(8) }).state;
    expect(s2.field(dragFrozenSelectionField)).toEqual(ranges);
  });
});

// Integration: exercise the full mermaid decoration pipeline (markdown parser
// + prosemark foldExtension + mermaidFoldExtension) and verify the gate
// suppresses the Preview→Edit flip while the drag snapshot is active.
describe("mermaidDecorations drag-gate integration", () => {
  // Doc layout:
  //   "before\n```mermaid\ngraph TD;\n  A-->B;\n```\nafter"
  //    0      7          18         28        37  41
  // Fence (FencedCode node) covers `[7, 40]` approximately. We don't need the
  // exact offsets — we use markers to derive them.
  const before = "before\n";
  const fence = "```mermaid\ngraph TD;\n  A-->B;\n```";
  const after = "\nafter";
  const doc = before + fence + after;
  const fenceFrom = before.length;
  const fenceTo = fenceFrom + fence.length;

  function makeState(selection: { anchor: number; head?: number }) {
    return EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM] }), mermaidDecorations()],
      selection: EditorSelection.single(selection.anchor, selection.head),
    });
  }

  // Returns the merged decoration spans inside the foldExtension's set that
  // overlap the fence range. Replace decorations span [fenceFrom, fenceTo]
  // (Preview); widget decorations are zero-width at fenceTo with source
  // visible above (Edit). We iterate the full doc to bypass any inclusive/
  // exclusive ambiguity with `between` on coincident boundaries.
  function fenceDecorationKind(state: ReturnType<typeof makeState>): "replace" | "widget" | "none" {
    const set = state.field(foldExtension);
    let kind: "replace" | "widget" | "none" = "none";
    set.between(0, doc.length, (from, to, deco) => {
      const spec = (deco as unknown as { spec?: { widget?: unknown } }).spec ?? {};
      if (!spec.widget) return undefined;
      if (from === fenceFrom && to === fenceTo) {
        kind = "replace";
        return false;
      }
      if (from === fenceTo && to === fenceTo) {
        kind = "widget";
        return false;
      }
      return undefined;
    });
    return kind;
  }

  test("caret outside fence → Preview (replace)", () => {
    const state = makeState({ anchor: 0 });
    expect(fenceDecorationKind(state)).toBe("replace");
  });

  test("selection overlapping fence → Edit (widget)", () => {
    const state = makeState({ anchor: fenceFrom + 5, head: fenceFrom + 5 });
    expect(fenceDecorationKind(state)).toBe("widget");
  });

  test("drag gate freezes Preview when live selection extends into fence", () => {
    // Pre-drag: caret outside fence (Preview).
    const s0 = makeState({ anchor: 0 });
    expect(fenceDecorationKind(s0)).toBe("replace");

    // Snapshot the pre-drag selection, then extend the live selection into
    // the fence — what would normally happen on every drag-extend mousemove.
    const s1 = s0.update({
      effects: startDragEffect.of(s0.selection.ranges),
      selection: EditorSelection.single(0, fenceFrom + 5),
    }).state;

    // Gate active + frozen ranges don't touch fence → stays in Preview.
    expect(fenceDecorationKind(s1)).toBe("replace");

    // Pointerup: clear gate + nudge selection so foldExtension rebuilds.
    const s2 = s1.update({
      effects: endDragEffect.of(null),
      selection: s1.selection,
    }).state;

    // Now the live selection wins → flips to Edit.
    expect(fenceDecorationKind(s2)).toBe("widget");
  });

  test("drag gate freezes Edit when live selection leaves fence mid-drag", () => {
    // Pre-drag: caret inside fence (Edit).
    const s0 = makeState({ anchor: fenceFrom + 5 });
    expect(fenceDecorationKind(s0)).toBe("widget");

    // Snapshot pre-drag (selection touches fence). Extend selection out
    // past the fence — would normally collapse the widget back to Preview.
    const s1 = s0.update({
      effects: startDragEffect.of(s0.selection.ranges),
      selection: EditorSelection.single(fenceFrom + 5, doc.length),
    }).state;

    // Gate active + frozen ranges still touch fence → stays in Edit.
    expect(fenceDecorationKind(s1)).toBe("widget");
  });

  test("click-Edit-code dispatch (gate inactive) flips Preview → Edit", () => {
    const s0 = makeState({ anchor: 0 });
    expect(fenceDecorationKind(s0)).toBe("replace");

    // Simulate the toggleEditMode dispatch: range covering the entire fence,
    // gate inactive (button mousedown is stopPropagation'd before reaching
    // the editor's pointerdown handler — but even if it weren't, the
    // pointerup-driven endDragEffect would clear the gate before the click
    // event fires).
    const s1 = s0.update({
      selection: EditorSelection.single(fenceTo, fenceFrom),
    }).state;

    expect(fenceDecorationKind(s1)).toBe("widget");
  });
});
