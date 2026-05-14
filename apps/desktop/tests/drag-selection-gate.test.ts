import { describe, expect, test } from "vite-plus/test";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  diffDecorationSet,
  diffFoldDecorationsByProximity,
} from "../src/components/editor-area/drag-selection-gate";

// Minimal WidgetType used as a placeholder for zero-width widget decorations
// (e.g. the boundary widget prosemark's imageExtension emits when selection
// touches an image). The diff functions never call `toDOM`, so a stub is
// enough and lets the tests run in the node environment.
class StubWidget extends WidgetType {
  eq(other: StubWidget): boolean {
    return this === other;
  }
  toDOM(): HTMLElement {
    throw new Error("toDOM must not be called from diff tests");
  }
}

// Module-level decoration instances mirror prosemark's pattern: a single
// instance is reused across many ranges. The identity diff relies on this
// invariant.
const hideMarkA = Decoration.mark({ class: "cm-hidden-token" });
const hideMarkB = Decoration.mark({ class: "cm-inline-code" });

describe("diffDecorationSet (identity-based)", () => {
  test("empty snapshot returns Decoration.none", () => {
    const out = diffDecorationSet(Decoration.none, Decoration.none);
    expect(out.size).toBe(0);
  });

  test("snapshot and live identical → returns none", () => {
    const ranges = [hideMarkA.range(5, 6), hideMarkA.range(10, 11)];
    const snapshot = Decoration.set(ranges, true);
    const live = Decoration.set(ranges, true);
    const out = diffDecorationSet(snapshot, live);
    expect(out.size).toBe(0);
  });

  test("snapshot has a decoration live lacks → returned", () => {
    const snapshot = Decoration.set([hideMarkA.range(5, 6), hideMarkA.range(10, 11)], true);
    const live = Decoration.set([hideMarkA.range(5, 6)], true);
    const out = diffDecorationSet(snapshot, live);
    expect(out.size).toBe(1);
    // Confirm the surviving decoration is the one at [10, 11].
    const collected: Array<{ from: number; to: number }> = [];
    out.between(0, 100, (from, to) => {
      collected.push({ from, to });
    });
    expect(collected).toEqual([{ from: 10, to: 11 }]);
  });

  test("live has decoration snapshot lacks → ignored (we only emit snapshot−live)", () => {
    const snapshot = Decoration.set([hideMarkA.range(5, 6)], true);
    const live = Decoration.set([hideMarkA.range(5, 6), hideMarkA.range(10, 11)], true);
    const out = diffDecorationSet(snapshot, live);
    expect(out.size).toBe(0);
  });

  test("same range, different decoration instances → returns the snapshot's", () => {
    // Models prosemark mid-drag dropping `cm-hidden-token` while still emitting
    // the `cm-inline-code` wrapper at the same range.
    const snapshot = Decoration.set([hideMarkA.range(5, 6)], true);
    const live = Decoration.set([hideMarkB.range(5, 6)], true);
    const out = diffDecorationSet(snapshot, live);
    expect(out.size).toBe(1);
  });

  test("multiple decorations at same range bucket independently", () => {
    // Snapshot has both A and B at [5, 6]. Live has only A. Diff should yield B.
    const snapshot = Decoration.set([hideMarkA.range(5, 6), hideMarkB.range(5, 6)], true);
    const live = Decoration.set([hideMarkA.range(5, 6)], true);
    const out = diffDecorationSet(snapshot, live);
    expect(out.size).toBe(1);
    const collected: Array<{ class: string }> = [];
    out.between(0, 100, (_from, _to, deco) => {
      collected.push({ class: (deco.spec as { class: string }).class });
    });
    expect(collected).toEqual([{ class: "cm-inline-code" }]);
  });
});

// For the fold diff, fresh decoration instances each call → identity won't
// help. The proximity check works on ranges only.
function freshFold(from: number, to: number) {
  return Decoration.replace({ widget: new StubWidget() }).range(from, to);
}
function freshBoundaryWidget(at: number) {
  return Decoration.widget({ widget: new StubWidget(), block: true }).range(at, at);
}

describe("diffFoldDecorationsByProximity", () => {
  test("empty snapshot returns Decoration.none", () => {
    const out = diffFoldDecorationsByProximity(Decoration.none, Decoration.none);
    expect(out.size).toBe(0);
  });

  test("snapshot alone (no live nearby) is returned — the list/task case", () => {
    const snapshot = Decoration.set([freshFold(10, 20)], true);
    const out = diffFoldDecorationsByProximity(snapshot, Decoration.none);
    expect(out.size).toBe(1);
  });

  test("live decoration far from snapshot → snapshot returned", () => {
    const snapshot = Decoration.set([freshFold(10, 20)], true);
    const live = Decoration.set([freshFold(50, 60)], true);
    const out = diffFoldDecorationsByProximity(snapshot, live);
    expect(out.size).toBe(1);
  });

  test("live decoration starts exactly at snapshot.to+1 → still treated as conflict", () => {
    // `live.between(from-1, to+1, ...)` is inclusive at both ends, so a live
    // decoration starting at `snapshot.to + 1` (i.e. immediately after) is
    // reported by `between` and treated as a conflict. Documents the boundary.
    const snapshot = Decoration.set([freshFold(10, 20)], true);
    const live = Decoration.set([freshFold(21, 25)], true);
    const out = diffFoldDecorationsByProximity(snapshot, live);
    expect(out.size).toBe(0);
  });

  test("live decoration two positions past snapshot.to → no conflict", () => {
    const snapshot = Decoration.set([freshFold(10, 20)], true);
    const live = Decoration.set([freshFold(22, 25)], true);
    const out = diffFoldDecorationsByProximity(snapshot, live);
    expect(out.size).toBe(1);
  });

  test("image case: live widget at snapshot.to → conflict, snapshot skipped", () => {
    // The load-bearing case the ±1 slack exists for. Snapshot has
    // replace[from, to] (pre-drag folded image); live has widget at [to, to]
    // (mid-drag selection-touched image, per prosemark's imageExtension).
    // Without the slack we'd overlay both and render two stacked widgets.
    const snapshot = Decoration.set([freshFold(10, 20)], true);
    const live = Decoration.set([freshBoundaryWidget(20)], true);
    const out = diffFoldDecorationsByProximity(snapshot, live);
    expect(out.size).toBe(0);
  });

  test("live decoration ends at snapshot.from-1 → conflict (the symmetric case)", () => {
    const snapshot = Decoration.set([freshFold(10, 20)], true);
    const live = Decoration.set([freshFold(5, 9)], true);
    const out = diffFoldDecorationsByProximity(snapshot, live);
    expect(out.size).toBe(0);
  });

  test("multiple snapshot decorations: some included, some skipped", () => {
    const snapshot = Decoration.set(
      [freshFold(10, 20), freshFold(30, 40), freshFold(50, 60)],
      true,
    );
    // Live conflicts with the middle one only.
    const live = Decoration.set([freshFold(35, 36)], true);
    const out = diffFoldDecorationsByProximity(snapshot, live);
    expect(out.size).toBe(2);
    const ranges: Array<[number, number]> = [];
    out.between(0, 100, (from, to) => {
      ranges.push([from, to]);
    });
    expect(ranges).toEqual([
      [10, 20],
      [50, 60],
    ]);
  });
});
