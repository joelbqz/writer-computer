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
const { foldExtension } = await import("../src/lib/prosemark-core/main");
const {
  DRAG_END_USER_EVENT,
  buildEndDragDispatch,
  dragFrozenSelectionField,
  startDragEffect,
  endDragEffect,
  rangesTouchInclusive,
  mermaidDecorations,
  shouldStartDragGate,
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
    // gate inactive. (Why is the gate inactive at click time? `mousedown`
    // stopPropagation on the button does NOT stop the corresponding
    // `pointerdown` — they're separate event types. What suppresses the
    // gate is shouldStartDragGate's `closest('.cm-mermaid-widget')` skip,
    // tested separately in the predicate suite below.)
    const s1 = s0.update({
      selection: EditorSelection.single(fenceTo, fenceFrom),
    }).state;

    expect(fenceDecorationKind(s1)).toBe("widget");
  });
});

// Pointer-handler predicates. These test the filter logic that the ViewPlugin
// wraps — primary-button gate, isPrimary, in-widget skip, idempotent re-entry,
// and the end-drag dispatch builder. Pure functions so we don't need a real
// EditorView (test environment is "node" — no jsdom).
describe("shouldStartDragGate", () => {
  function makeState() {
    return EditorState.create({
      doc: "hello world",
      extensions: [dragFrozenSelectionField],
    });
  }

  // Minimal stand-in for a non-widget click target. We don't need a full DOM —
  // shouldStartDragGate only calls `closest()` which we can stub.
  const NON_WIDGET_TARGET = {
    closest: (sel: string) => (sel === ".cm-mermaid-widget" ? null : null),
  } as unknown as Element;

  // Element-like with closest('.cm-mermaid-widget') returning a truthy node —
  // simulates a click that originated inside a mermaid widget (canvas pan,
  // Edit-code button, Preview button).
  const WIDGET_TARGET = {
    closest: (sel: string) => (sel === ".cm-mermaid-widget" ? ({} as Element) : null),
  } as unknown as Element;

  test("returns dispatch with startDragEffect for primary button + non-widget target", () => {
    const dispatch = shouldStartDragGate(makeState(), {
      isPrimary: true,
      button: 0,
      target: NON_WIDGET_TARGET,
    });
    expect(dispatch).not.toBeNull();
    expect(dispatch!.effects).toBeDefined();
  });

  test("skips non-primary pointer (isPrimary=false)", () => {
    expect(
      shouldStartDragGate(makeState(), {
        isPrimary: false,
        button: 0,
        target: NON_WIDGET_TARGET,
      }),
    ).toBeNull();
  });

  test("skips non-left button (button=2 right click)", () => {
    expect(
      shouldStartDragGate(makeState(), {
        isPrimary: true,
        button: 2,
        target: NON_WIDGET_TARGET,
      }),
    ).toBeNull();
  });

  test("skips middle-click (button=1 — autoscroll path)", () => {
    expect(
      shouldStartDragGate(makeState(), {
        isPrimary: true,
        button: 1,
        target: NON_WIDGET_TARGET,
      }),
    ).toBeNull();
  });

  test("skips when target is inside .cm-mermaid-widget (canvas pan / button click)", () => {
    expect(
      shouldStartDragGate(makeState(), {
        isPrimary: true,
        button: 0,
        target: WIDGET_TARGET,
      }),
    ).toBeNull();
  });

  test("skips when gate is already active (idempotent re-entry)", () => {
    const s0 = makeState();
    const s1 = s0.update({
      effects: startDragEffect.of([EditorSelection.range(0, 0)]),
    }).state;
    expect(
      shouldStartDragGate(s1, { isPrimary: true, button: 0, target: NON_WIDGET_TARGET }),
    ).toBeNull();
  });

  test("handles non-Element target gracefully (e.g., text node)", () => {
    // PointerEvent.target can be any EventTarget; only Elements have closest().
    // The instanceof check should let a non-Element through to the gate-active
    // check rather than throwing.
    const dispatch = shouldStartDragGate(makeState(), {
      isPrimary: true,
      button: 0,
      target: {
        /* not an Element */
      } as EventTarget,
    });
    expect(dispatch).not.toBeNull();
  });
});

describe("buildEndDragDispatch", () => {
  function makeState() {
    return EditorState.create({
      doc: "hello world",
      extensions: [dragFrozenSelectionField],
    });
  }

  test("returns null when gate is inactive (idempotent — pointerup/cancel/blur all fire)", () => {
    expect(buildEndDragDispatch(makeState())).toBeNull();
  });

  test("returns dispatch with endDragEffect + selection nudge + userEvent tag when gate active", () => {
    const s0 = makeState();
    const s1 = s0.update({
      effects: startDragEffect.of([EditorSelection.range(0, 0)]),
    }).state;
    const dispatch = buildEndDragDispatch(s1);
    expect(dispatch).not.toBeNull();
    expect(dispatch!.selection).toBe(s1.selection);
    expect(dispatch!.userEvent).toBe(DRAG_END_USER_EVENT);
  });

  test("DRAG_END_USER_EVENT is a 'select' sub-event (consumers can opt out)", () => {
    // The tag is hierarchical: tr.isUserEvent("select") matches it (so
    // generic select-listeners still fire), but tr.isUserEvent("select.pointer.drag-end")
    // distinguishes the no-op nudge from a real user-driven select.
    expect(DRAG_END_USER_EVENT.startsWith("select.")).toBe(true);
  });
});

// Multi-block integration: drag through two adjacent mermaid fences. Both
// must stay in their pre-drag state for the duration of the gate.
describe("mermaidDecorations multi-block drag-gate integration", () => {
  const before = "before\n";
  const fence1 = "```mermaid\ngraph TD;\n  A-->B;\n```";
  const between = "\nmiddle\n";
  const fence2 = "```mermaid\ngraph TD;\n  C-->D;\n```";
  const after = "\nafter";
  const doc = before + fence1 + between + fence2 + after;
  const fence1From = before.length;
  const fence1To = fence1From + fence1.length;
  const fence2From = fence1To + between.length;
  const fence2To = fence2From + fence2.length;

  function makeState(selection: { anchor: number; head?: number }) {
    return EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM] }), mermaidDecorations()],
      selection: EditorSelection.single(selection.anchor, selection.head),
    });
  }

  function decorationKindAt(
    state: ReturnType<typeof makeState>,
    fenceFrom: number,
    fenceTo: number,
  ): "replace" | "widget" | "none" {
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

  test("drag spanning both fences leaves both in Preview during gate", () => {
    // Pre-drag: caret outside both fences.
    const s0 = makeState({ anchor: 0 });
    expect(decorationKindAt(s0, fence1From, fence1To)).toBe("replace");
    expect(decorationKindAt(s0, fence2From, fence2To)).toBe("replace");

    // Snapshot pre-drag selection (touches neither fence). Extend live
    // selection across both fences — would normally flip both to Edit.
    const s1 = s0.update({
      effects: startDragEffect.of(s0.selection.ranges),
      selection: EditorSelection.single(0, fence2To),
    }).state;

    expect(decorationKindAt(s1, fence1From, fence1To)).toBe("replace");
    expect(decorationKindAt(s1, fence2From, fence2To)).toBe("replace");

    // Pointerup: clear gate. Both flip to Edit since live selection now
    // overlaps both fences.
    const s2 = s1.update({
      effects: endDragEffect.of(null),
      selection: s1.selection,
    }).state;

    expect(decorationKindAt(s2, fence1From, fence1To)).toBe("widget");
    expect(decorationKindAt(s2, fence2From, fence2To)).toBe("widget");
  });
});

// Loop risk per spec: the endDrag transaction itself must not trigger
// another endDrag-style dispatch. We model this by replaying the transaction
// builder against the post-endDrag state and asserting it returns null.
describe("end-drag dispatch is one-shot (no loop)", () => {
  test("buildEndDragDispatch returns null on the state produced by a prior endDrag", () => {
    const s0 = EditorState.create({
      doc: "hello world",
      extensions: [dragFrozenSelectionField],
    });
    const s1 = s0.update({
      effects: startDragEffect.of([EditorSelection.range(0, 0)]),
    }).state;
    const first = buildEndDragDispatch(s1);
    expect(first).not.toBeNull();

    // Apply the dispatch; the field is now null.
    const s2 = s1.update({
      selection: first!.selection,
      effects: first!.effects,
    }).state;
    expect(s2.field(dragFrozenSelectionField)).toBeNull();

    // Re-running the builder against s2 must short-circuit. This is what
    // protects pointerup → endDrag dispatch → (would-be) pointerup loop.
    expect(buildEndDragDispatch(s2)).toBeNull();
  });
});
