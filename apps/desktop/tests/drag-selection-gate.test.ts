import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  defaultHideExtensions,
  hideExtension,
  unfurlFreezeFacet,
} from "../src/lib/prosemark-core/main";
import {
  dragFreezeExtensions,
  dragFrozenSelectionField,
  endDragEffect,
  startDragEffect,
} from "../src/components/editor-area/drag-selection-gate";

// Document: an ATX heading. Prosemark's `hideExtension` hides the `# ` prefix
// when the selection is outside the heading and reveals it when the selection
// touches. We use the decoration count as a proxy for "did hideExtension
// recompute": touched = 0 decorations, outside = ≥1 decoration on the marker.
const DOC = "# heading\nplain";
const INSIDE_HEADING = 1; // caret between `#` and ` h`
const OUTSIDE_HEADING = 12; // caret in "plain"

function makeState() {
  return EditorState.create({
    doc: DOC,
    selection: EditorSelection.single(OUTSIDE_HEADING),
    extensions: [markdown({ extensions: [GFM] }), defaultHideExtensions, dragFreezeExtensions],
  });
}

function hideSize(state: EditorState): number {
  return state.field(hideExtension).size;
}

describe("unfurlFreezeFacet integration", () => {
  test("facet is false when no drag is active", () => {
    expect(makeState().facet(unfurlFreezeFacet)).toBe(false);
  });

  test("facet flips true while dragFrozenSelectionField holds a snapshot", () => {
    const s0 = makeState();
    const s1 = s0.update({ effects: startDragEffect.of(s0.selection.ranges) }).state;
    expect(s1.facet(unfurlFreezeFacet)).toBe(true);
    expect(s1.field(dragFrozenSelectionField)).not.toBeNull();
  });

  test("selection change mid-drag does NOT rebuild hideExtension", () => {
    const s0 = makeState();
    const baseline = hideSize(s0);
    expect(baseline).toBeGreaterThan(0); // hash mark is hidden when caret is outside

    const s1 = s0.update({ effects: startDragEffect.of(s0.selection.ranges) }).state;
    // Live selection moves into the heading — would normally drop the hide.
    const s2 = s1.update({ selection: EditorSelection.single(INSIDE_HEADING) }).state;

    expect(hideSize(s2)).toBe(baseline);
  });

  test("end-drag dispatch rebuilds against the live selection", () => {
    const s0 = makeState();
    const s1 = s0.update({ effects: startDragEffect.of(s0.selection.ranges) }).state;
    const s2 = s1.update({ selection: EditorSelection.single(INSIDE_HEADING) }).state;
    expect(hideSize(s2)).toBeGreaterThan(0); // still frozen at "outside" decorations

    // Mirror buildEndDragDispatch: clear the field AND re-assert selection so
    // the unfreeze transaction itself triggers a rebuild.
    const s3 = s2.update({
      selection: s2.selection,
      effects: endDragEffect.of(null),
    }).state;

    expect(s3.facet(unfurlFreezeFacet)).toBe(false);
    // Live selection now touches the heading → hide is dropped.
    expect(hideSize(s3)).toBe(0);
  });

  test("doc changes during freeze still re-map decoration positions", () => {
    const s0 = makeState();
    const before = hideSize(s0);
    const s1 = s0.update({ effects: startDragEffect.of(s0.selection.ranges) }).state;
    // Insert 3 chars before the heading. Without re-mapping, the hide ranges
    // would point at stale positions and CodeMirror would throw on render.
    const s2 = s1.update({ changes: { from: 0, insert: "xyz" } }).state;
    expect(hideSize(s2)).toBe(before);
  });
});
