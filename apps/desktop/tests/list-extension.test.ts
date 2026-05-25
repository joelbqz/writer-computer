import { describe, expect, test } from "vite-plus/test";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { computeCheckboxToggle, listExtension, __test } from "../src/lib/prosemark-core/list";

const { isOnListLine, findPrevListItemIndent, listEnter, listBackspace, listIndent, listOutdent } =
  __test;

function makeState(doc: string, anchor = 0, head?: number): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] }), listExtension],
    selection: EditorSelection.single(anchor, head ?? anchor),
  });
  // Force a full parse so `syntaxTree(state)` is populated for the
  // line-range iteration in `isOnListLine` and `buildListDecorations`.
  ensureSyntaxTree(state, doc.length, 1000);
  return state;
}

function run(cmd: StateCommand, state: EditorState): { state: EditorState; ran: boolean } {
  let next = state;
  const dispatch = (tr: Transaction): void => {
    next = tr.state;
  };
  const ran = cmd({ state, dispatch });
  return { state: next, ran };
}

// ---------------------------------------------------------------------------
// isOnListLine
// ---------------------------------------------------------------------------

describe("isOnListLine", () => {
  test("true on a plain bullet line", () => {
    const s = makeState("- foo");
    expect(isOnListLine(s, 0)).toBe(true);
    expect(isOnListLine(s, 5)).toBe(true);
  });

  test("true on a task line at every position including end", () => {
    const s = makeState("- [ ] task");
    expect(isOnListLine(s, 0)).toBe(true);
    expect(isOnListLine(s, 10)).toBe(true);
  });

  test("true on an empty task line at line.to", () => {
    const s = makeState("- [ ] ");
    expect(isOnListLine(s, 6)).toBe(true);
  });

  test("false on a plain paragraph", () => {
    const s = makeState("just text");
    expect(isOnListLine(s, 4)).toBe(false);
  });

  test("true on ordered-list lines (ListMark is present)", () => {
    const s = makeState("1. foo");
    expect(isOnListLine(s, 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findPrevListItemIndent
// ---------------------------------------------------------------------------

describe("findPrevListItemIndent", () => {
  test("returns the prior list item's indent", () => {
    const s = makeState("- a\n  - b\n");
    expect(findPrevListItemIndent(s, 2, () => true)).toBe(0);
  });

  test("returns -1 when prior line is blank", () => {
    const s = makeState("- a\n\n- b");
    expect(findPrevListItemIndent(s, 3, () => true)).toBe(-1);
  });

  test("respects the predicate filter for indent-only constraints", () => {
    const s = makeState("- a\n  - b\n    - c\n");
    // Looking for a list item with indent ≤ 4 from line 3: that's `  - b` (2).
    expect(findPrevListItemIndent(s, 3, (i) => i <= 4)).toBe(2);
    // Looking for indent strictly < 4: same answer (2).
    expect(findPrevListItemIndent(s, 3, (i) => i < 4)).toBe(2);
    // Looking for indent strictly < 2 from line 2: `- a` at 0.
    expect(findPrevListItemIndent(s, 2, (i) => i < 2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// listEnter
// ---------------------------------------------------------------------------

describe("listEnter", () => {
  test("continues a bullet with matching marker", () => {
    const s = makeState("- foo", 5);
    const { state, ran } = run(listEnter, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- foo\n- ");
    expect(state.selection.main.head).toBe(8);
  });

  test("continues with the SAME bullet character", () => {
    const s = makeState("+ foo", 5);
    expect(run(listEnter, s).state.doc.toString()).toBe("+ foo\n+ ");
    const s2 = makeState("* foo", 5);
    expect(run(listEnter, s2).state.doc.toString()).toBe("* foo\n* ");
  });

  test("continues a task line — always unchecked, even from a checked source", () => {
    const s = makeState("- [x] done", 10);
    const { state } = run(listEnter, s);
    expect(state.doc.toString()).toBe("- [x] done\n- [ ] ");
  });

  test("preserves leading indent on nested continuation", () => {
    const s = makeState("- a\n  - b", 9);
    const { state } = run(listEnter, s);
    expect(state.doc.toString()).toBe("- a\n  - b\n  - ");
  });

  test("wipes the line when item is empty (`- `)", () => {
    const s = makeState("- ", 2);
    const { state, ran } = run(listEnter, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("");
    expect(state.selection.main.head).toBe(0);
  });

  test("wipes the line when empty task (`- [ ] `)", () => {
    const s = makeState("- [ ] ", 6);
    const { state } = run(listEnter, s);
    expect(state.doc.toString()).toBe("");
  });

  test("wipes the line when empty nested item (`  - `)", () => {
    const s = makeState("- a\n  - ", 8);
    const { state } = run(listEnter, s);
    expect(state.doc.toString()).toBe("- a\n");
  });

  test("defers to default Enter when cursor is at/before the prefix end", () => {
    const s = makeState("- foo", 0);
    expect(run(listEnter, s).ran).toBe(false);
  });

  test("defers on a non-list line", () => {
    const s = makeState("hello", 5);
    expect(run(listEnter, s).ran).toBe(false);
  });

  test("defers when selection is non-empty (multi-line indent out of scope)", () => {
    const s = makeState("- foo", 1, 3);
    expect(run(listEnter, s).ran).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listBackspace
// ---------------------------------------------------------------------------

describe("listBackspace", () => {
  test("at bullet right edge wipes `- ` and leading indent", () => {
    const s = makeState("  - foo", 4);
    const { state, ran } = run(listBackspace, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("foo");
    expect(state.selection.main.head).toBe(0);
  });

  test("at bullet right edge (no indent) wipes just `- `", () => {
    const s = makeState("- foo", 2);
    expect(run(listBackspace, s).state.doc.toString()).toBe("foo");
  });

  test("at task right edge wipes `- [ ] ` and leading indent", () => {
    const s = makeState("  - [ ] task", 8);
    const { state } = run(listBackspace, s);
    expect(state.doc.toString()).toBe("task");
  });

  test("at spacer right edge removes one indent step only", () => {
    // `    - c` only renders as a depth-2 list item when there's a proper
    // parent chain above (Lezer treats 4 leading spaces at top level as a
    // code block). Build the chain so the depth-2 spacer split exists.
    const s = makeState("- a\n  - b\n    - c", 12);
    const { state } = run(listBackspace, s);
    expect(state.doc.toString()).toBe("- a\n  - b\n  - c");
    expect(state.selection.main.head).toBe(10);
  });

  test("defers when cursor isn't at any list-decoration right edge", () => {
    const s = makeState("- foo", 4); // inside "foo"
    expect(run(listBackspace, s).ran).toBe(false);
  });

  test("defers on a non-list line", () => {
    const s = makeState("hello", 5);
    expect(run(listBackspace, s).ran).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listIndent / listOutdent
// ---------------------------------------------------------------------------

describe("listIndent (Tab)", () => {
  test("nests bullet under the previous sibling", () => {
    const s = makeState("- a\n- b", 7);
    const { state, ran } = run(listIndent, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n  - b");
    expect(state.selection.main.head).toBe(9);
  });

  test("nests a task line under the prior bullet", () => {
    const s = makeState("- a\n- [ ] b", 11);
    const { state } = run(listIndent, s);
    expect(state.doc.toString()).toBe("- a\n  - [ ] b");
  });

  test("nests deeper when an intermediate sibling exists", () => {
    const s = makeState("- a\n  - b\n  - c", 15);
    const { state } = run(listIndent, s);
    expect(state.doc.toString()).toBe("- a\n  - b\n    - c");
  });

  test("consumes Tab as no-op when no valid parent exists (avoids inserting \\t)", () => {
    const s = makeState("- a", 3);
    const { state, ran } = run(listIndent, s);
    expect(ran).toBe(true); // consumed
    expect(state.doc.toString()).toBe("- a"); // unchanged
  });

  test("consumes Tab when already nested as deep as the prior chain allows", () => {
    const s = makeState("- a\n  - b", 9);
    const { state, ran } = run(listIndent, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n  - b"); // can't go deeper
  });

  test("defers on a non-list line", () => {
    const s = makeState("hello", 5);
    expect(run(listIndent, s).ran).toBe(false);
  });
});

describe("listOutdent (Shift-Tab)", () => {
  test("outdents to the prior shallower indent", () => {
    // `- a\n  - b` — b at depth 1. Shift-Tab targets the prior list item
    // with strictly shallower indent (a, at indent 0), so b goes to 0.
    const s = makeState("- a\n  - b", 9);
    const { state, ran } = run(listOutdent, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n- b");
  });

  test("steps from depth 2 to depth 1", () => {
    const s = makeState("- a\n  - b\n    - c", 17);
    const { state } = run(listOutdent, s);
    // Prior shallower (indent < 4) is `  - b` at 2 — c goes to indent 2.
    expect(state.doc.toString()).toBe("- a\n  - b\n  - c");
  });

  test("no-op at indent 0", () => {
    const s = makeState("- a", 3);
    const { state, ran } = run(listOutdent, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a");
  });
});

// ---------------------------------------------------------------------------
// computeCheckboxToggle
// ---------------------------------------------------------------------------

describe("computeCheckboxToggle", () => {
  test("toggles `[ ]` → `[x]` at the widget start", () => {
    const s = makeState("- [ ] task");
    const spec = computeCheckboxToggle(s, 0);
    expect(spec).not.toBeNull();
    expect(spec?.changes).toEqual({ from: 3, to: 4, insert: "x" });
  });

  test("toggles `[x]` → `[ ]`", () => {
    const s = makeState("- [x] done");
    const spec = computeCheckboxToggle(s, 0);
    expect(spec?.changes).toEqual({ from: 3, to: 4, insert: " " });
  });

  test("works on indented task (widget start at the `-`, not line.from)", () => {
    const s = makeState("  - [ ] nested");
    // Widget for the nested task starts at pos 2 (the `-`).
    const spec = computeCheckboxToggle(s, 2);
    expect(spec?.changes).toEqual({ from: 5, to: 6, insert: "x" });
  });

  test("returns null when not pointing at a task pattern", () => {
    const s = makeState("- foo");
    expect(computeCheckboxToggle(s, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Decoration field
// ---------------------------------------------------------------------------

describe("ordered lists", () => {
  test("renders no bullet widget — source `1. ` stays visible", () => {
    const s = makeState("1. foo");
    const decos = s.field(__test.listDecorationsField);
    let markerCount = 0;
    decos.marker.between(0, s.doc.length, () => {
      markerCount++;
    });
    expect(markerCount).toBe(0);
  });

  test("adds the hanging-indent line decoration on `1. foo`", () => {
    const s = makeState("1. foo");
    const decos = s.field(__test.listDecorationsField);
    const styles: string[] = [];
    decos.all.between(0, s.doc.length, (_from, _to, value) => {
      const spec = (value as { spec?: { attributes?: { style?: string } } }).spec;
      const style = spec?.attributes?.style;
      if (style) styles.push(style);
    });
    expect(styles).toContain("padding-inline-start: 3ch; text-indent: -3ch;");
  });

  test("adds a spacer per nesting level for `  1. b`", () => {
    const s = makeState("- a\n  1. b");
    const decos = s.field(__test.listDecorationsField);
    // Atomic set on the nested-1 line should hold exactly one spacer.
    let spacerCount = 0;
    decos.atomic.between(4, 10, () => {
      spacerCount++;
    });
    // 1 spacer (no bullet widget for ordered).
    expect(spacerCount).toBe(1);
  });
});

describe("listDecorationsField", () => {
  test("does not render a bullet for a bare `-` (no trailing space)", () => {
    const s = makeState("-", 1);
    const decos = s.field(__test.listDecorationsField);
    // Marker set should be empty — nothing to render.
    let markerCount = 0;
    decos.marker.between(0, 1, () => {
      markerCount++;
    });
    expect(markerCount).toBe(0);
  });

  test("renders a bullet once trailing space exists", () => {
    const s = makeState("- ", 2);
    const decos = s.field(__test.listDecorationsField);
    let markerCount = 0;
    decos.marker.between(0, 2, () => {
      markerCount++;
    });
    expect(markerCount).toBe(1);
  });

  test("renders one spacer per nesting depth", () => {
    const s = makeState("- a\n  - b\n    - c");
    const decos = s.field(__test.listDecorationsField);
    // Atomic set holds 3 markers + 1 + 2 spacers = 6 ranges.
    let total = 0;
    decos.atomic.between(0, s.doc.length, () => {
      total++;
    });
    expect(total).toBe(6);
  });
});
