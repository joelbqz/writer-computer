import { describe, expect, test } from "vite-plus/test";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { computeCheckboxToggle, listExtension, __test } from "../src/lib/prosemark-core/list";
import { withFullParse } from "./helpers/parsed-state";

const {
  clampCollapsedListPrefixRange,
  computeCheckboxToggleFromLine,
  isOnListLine,
  listPrefixBoundaryMove,
  parseBulletTaskLine,
  findPrevListItemIndent,
  listEnter,
  listBackspace,
  listIndent,
  listOutdent,
  listLineAt,
} = __test;

function makeState(doc: string, anchor = 0, head?: number): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] }), listExtension],
    selection: EditorSelection.single(anchor, head ?? anchor),
  });
  // Full parse committed so `isOnListLine` and `listDecorationsField` see it.
  return withFullParse(state);
}

function run(cmd: StateCommand, state: EditorState): { state: EditorState; ran: boolean } {
  let next = state;
  const dispatch = (tr: Transaction): void => {
    next = tr.state;
  };
  const ran = cmd({ state, dispatch });
  return { state: next, ran };
}

function prefixMarks(
  state: EditorState,
): Array<{ from: number; to: number; className: string; style: string }> {
  const decos = state.field(__test.listDecorationsField);
  const marks: Array<{ from: number; to: number; className: string; style: string }> = [];
  decos.all.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: unknown; attributes?: { style?: unknown } };
    if (typeof spec.class !== "string") return;
    if (!spec.class.includes("cm-list-prefix")) return;
    marks.push({
      from,
      to,
      className: spec.class,
      style: typeof spec.attributes?.style === "string" ? spec.attributes.style : "",
    });
  });
  return marks;
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

describe("listLineAt (tree-gated prefix parse)", () => {
  test("ignores a bullet-looking line inside a fenced code block", () => {
    const doc = "```\n- item\n```\n";
    const s = makeState(doc);
    expect(listLineAt(s, doc.indexOf("item"))).toBeNull();
  });

  test("caret guard leaves carets alone inside a fenced code block", () => {
    const doc = "```\n- item\n```\n";
    const s = makeState(doc);
    const between = doc.indexOf("- item") + 1;
    const tr = s.update({ selection: EditorSelection.cursor(between) });
    expect(tr.state.selection.main.head).toBe(between);
  });

  test("Backspace inside a fenced code block is not a list operation", () => {
    const doc = "```\n- item\n```\n";
    const s = makeState(doc, doc.indexOf("item"));
    expect(run(listBackspace, s).ran).toBe(false);
  });

  test("accepts a tab after the marker, matching the decoration builder", () => {
    const s = makeState("-\titem");
    expect(listLineAt(s, 3)).toMatchObject({ markerFrom: 0, bodyFrom: 2, isTask: false });
    const { state, ran } = run(listEnter, makeState("-\titem", 6));
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("-\titem\n-\t");
  });
});

describe("parseBulletTaskLine", () => {
  test("returns the three list-prefix boundaries for nested bullets", () => {
    const s = makeState("    - item", 0);
    expect(parseBulletTaskLine(s.doc.line(1))).toEqual({
      lineFrom: 0,
      markerFrom: 4,
      bodyFrom: 6,
      indentLen: 4,
      markerLen: 2,
      isTask: false,
    });
  });

  test("treats the full task checkbox as the marker", () => {
    const s = makeState("  - [x] item", 0);
    expect(parseBulletTaskLine(s.doc.line(1))).toEqual({
      lineFrom: 0,
      markerFrom: 2,
      bodyFrom: 8,
      indentLen: 2,
      markerLen: 6,
      isTask: true,
    });
  });

  test("does not parse ordered lists", () => {
    const s = makeState("1. item", 0);
    expect(parseBulletTaskLine(s.doc.line(1))).toBeNull();
  });
});

describe("list prefix caret zones", () => {
  // A nested item under a real parent: a 4-space-indented bullet with no
  // parent is an indented code block per CommonMark, and the guard defers to
  // the syntax tree for that.
  const NESTED = "- parent\n    - item";
  const L2 = 9; // start of the nested line

  test("clamps collapsed carets inside indentation to marker start", () => {
    const s = makeState(NESTED, 0);
    const range = clampCollapsedListPrefixRange(s, EditorSelection.cursor(L2 + 2));
    expect(range.from).toBe(L2 + 4);
    expect(range.to).toBe(L2 + 4);
  });

  test("clamps collapsed carets inside marker to body start", () => {
    const s = makeState(NESTED, 0);
    const range = clampCollapsedListPrefixRange(s, EditorSelection.cursor(L2 + 5));
    expect(range.from).toBe(L2 + 6);
    expect(range.to).toBe(L2 + 6);
  });

  test("leaves non-empty selections alone", () => {
    const s = makeState(NESTED, 0);
    const range = EditorSelection.range(L2 + 2, L2 + 5);
    expect(clampCollapsedListPrefixRange(s, range)).toBe(range);
  });

  test("leaves carets alone on an indented code block that looks like a bullet", () => {
    const s = makeState("    - item", 0);
    const range = EditorSelection.cursor(2);
    expect(clampCollapsedListPrefixRange(s, range)).toBe(range);
  });

  test("moves left and right across only the allowed prefix boundaries", () => {
    expect(listPrefixBoundaryMove(makeState(NESTED, L2 + 6), "left")).toBe(L2 + 4);
    expect(listPrefixBoundaryMove(makeState(NESTED, L2 + 4), "left")).toBe(L2);
    expect(listPrefixBoundaryMove(makeState(NESTED, L2), "right")).toBe(L2 + 4);
    expect(listPrefixBoundaryMove(makeState(NESTED, L2 + 4), "right")).toBe(L2 + 6);
  });

  test("does not get stuck on top-level items where line start equals marker start", () => {
    expect(listPrefixBoundaryMove(makeState("- item", 0), "left")).toBeNull();
    expect(listPrefixBoundaryMove(makeState("- item", 0), "right")).toBe(2);
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
  test("at nested bullet body start removes marker and one indent level", () => {
    const s = makeState("  - foo", 4);
    const { state, ran } = run(listBackspace, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("foo");
    expect(state.selection.main.head).toBe(0);
  });

  test("at top-level bullet body start removes just `- `", () => {
    const s = makeState("- foo", 2);
    expect(run(listBackspace, s).state.doc.toString()).toBe("foo");
  });

  test("at nested task body start removes marker and one indent level", () => {
    const s = makeState("  - [ ] task", 8);
    const { state } = run(listBackspace, s);
    expect(state.doc.toString()).toBe("task");
  });

  test("at marker start removes one indent level only", () => {
    // `    - c` only renders as a depth-2 list item when there's a proper
    // parent chain above (Lezer treats 4 leading spaces at top level as a
    // code block). Build the chain so the depth-2 spacer split exists.
    const s = makeState("- a\n  - b\n    - c", 14);
    const { state } = run(listBackspace, s);
    expect(state.doc.toString()).toBe("- a\n  - b\n  - c");
    expect(state.selection.main.head).toBe(12);
  });

  test("at top-level marker start falls through", () => {
    const s = makeState("- foo", 0);
    expect(run(listBackspace, s).ran).toBe(false);
  });

  test("at nested body start removes marker and one indent level", () => {
    const s = makeState("- a\n  - b\n    - c", 16);
    const { state } = run(listBackspace, s);
    expect(state.doc.toString()).toBe("- a\n  - b\n  c");
    expect(state.selection.main.head).toBe(12);
  });

  test("at line start falls through", () => {
    const s = makeState("  - foo", 0);
    expect(run(listBackspace, s).ran).toBe(false);
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

  test("indents every selected list line that can move deeper", () => {
    const s = makeState("- a\n- b\n- c", 4, 11);
    const { state, ran } = run(listIndent, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n  - b\n  - c");
  });

  test("leaves non-list lines unchanged in multi-line selections", () => {
    const s = makeState("- a\npara\n- b", 0, 12);
    const { state, ran } = run(listIndent, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\npara\n  - b");
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

  test("outdents every selected nested list line one level", () => {
    const s = makeState("- a\n  - b\n  - c", 4, 15);
    const { state, ran } = run(listOutdent, s);
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n- b\n- c");
  });
});

// ---------------------------------------------------------------------------
// computeCheckboxToggle
// ---------------------------------------------------------------------------

describe("computeCheckboxToggle", () => {
  test("toggles `[ ]` → `[x]` at the marker start", () => {
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

  test("works on indented task (marker start at the `-`, not line.from)", () => {
    const s = makeState("  - [ ] nested");
    // The nested task marker starts at pos 2 (the `-`).
    const spec = computeCheckboxToggle(s, 2);
    expect(spec?.changes).toEqual({ from: 5, to: 6, insert: "x" });
  });

  test("line fallback toggles indented tasks from line start", () => {
    const s = makeState("  - [ ] nested");
    const spec = computeCheckboxToggleFromLine(s, 0);
    expect(spec?.changes).toEqual({ from: 5, to: 6, insert: "x" });
  });

  test("line fallback returns null on non-task list lines", () => {
    const s = makeState("  - nested");
    expect(computeCheckboxToggleFromLine(s, 0)).toBeNull();
  });

  test("returns null when not pointing at a task pattern", () => {
    const s = makeState("- foo");
    expect(computeCheckboxToggle(s, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Decoration field
// ---------------------------------------------------------------------------

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

  test("renders the bullet prefix as a source-backed mark", () => {
    const s = makeState("- ", 2);
    expect(prefixMarks(s)).toEqual([
      {
        from: 0,
        to: 2,
        className: "cm-list-prefix cm-list-prefix-bullet",
        style: "width: 3ch; --cm-list-marker-offset: 0ch; --cm-list-marker-width: 3ch",
      },
    ]);
  });

  test("renders the checkbox prefix as a source-backed mark", () => {
    const s = makeState("- [ ] ", 6);
    expect(prefixMarks(s)).toEqual([
      {
        from: 0,
        to: 6,
        className: "cm-list-prefix cm-list-prefix-task",
        style: "width: 3ch; --cm-list-marker-offset: 0ch; --cm-list-marker-width: 3ch",
      },
    ]);
  });

  test("uses the same prefix range when body text exists", () => {
    const bullet = makeState("- body", 2);
    const task = makeState("- [ ] body", 6);
    expect(prefixMarks(bullet)).toEqual([
      {
        from: 0,
        to: 2,
        className: "cm-list-prefix cm-list-prefix-bullet",
        style: "width: 3ch; --cm-list-marker-offset: 0ch; --cm-list-marker-width: 3ch",
      },
    ]);
    expect(prefixMarks(task)).toEqual([
      {
        from: 0,
        to: 6,
        className: "cm-list-prefix cm-list-prefix-task",
        style: "width: 3ch; --cm-list-marker-offset: 0ch; --cm-list-marker-width: 3ch",
      },
    ]);
  });

  test("marks checked tasks and carries nested marker geometry", () => {
    const s = makeState("- a\n  - [x] nested", 16);
    expect(prefixMarks(s).filter((mark) => mark.className.includes("cm-list-prefix-task"))).toEqual(
      [
        {
          from: 4,
          to: 12,
          className: "cm-list-prefix cm-list-prefix-task cm-list-prefix-task-checked",
          style: "width: 6ch; --cm-list-marker-offset: 3ch; --cm-list-marker-width: 3ch",
        },
      ],
    );
  });
});
