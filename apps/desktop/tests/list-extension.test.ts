import { describe, expect, test } from "vite-plus/test";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
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
  listItemLineAt,
  listEnter,
  listBackspace,
  listIndent,
  listOutdent,
  listLineAt,
} = __test;

function makeState(doc: string, anchor = 0, head?: number): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] }), listExtension, history()],
    selection: EditorSelection.single(anchor, head ?? anchor),
  });
  // Full parse committed so `isOnListLine` and `listDecorationsField` see it.
  return withFullParse(state);
}

// `doc` with `|` marking the caret, or two `|` marking a selection.
function makeMarked(marked: string): EditorState {
  const anchor = marked.indexOf("|");
  const rest = marked.slice(anchor + 1);
  const headOffset = rest.indexOf("|");
  const head = headOffset >= 0 ? anchor + headOffset : anchor;
  return makeState(marked.replace(/\|/g, ""), anchor, head);
}

// Result doc with `|` re-inserted at the main selection's head.
function markedDoc(state: EditorState): string {
  const doc = state.doc.toString();
  const head = state.selection.main.head;
  return `${doc.slice(0, head)}|${doc.slice(head)}`;
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
// listItemLineAt
// ---------------------------------------------------------------------------

describe("listItemLineAt", () => {
  const entryAt = (doc: string, lineNumber: number) => {
    const s = makeState(doc);
    return listItemLineAt(s, s.doc.line(lineNumber));
  };

  test("reads the leading whitespace and the child content column", () => {
    expect(entryAt("- a\n  - b", 2)).toMatchObject({
      markFrom: 6,
      leadingWs: "  ",
      contentWs: "    ",
    });
  });

  test("a child of an ordered item needs the ordered marker's width", () => {
    expect(entryAt("1. a", 1)).toMatchObject({ leadingWs: "", contentWs: "   " });
    expect(entryAt("10. a", 1)).toMatchObject({ leadingWs: "", contentWs: "    " });
  });

  test("keeps tabs in the child indent so tab-indented lists stay tab-indented", () => {
    expect(entryAt("- a\n\t- b", 2)).toMatchObject({ leadingWs: "\t", contentWs: "\t  " });
    expect(entryAt("-\tb", 1)).toMatchObject({ leadingWs: "", contentWs: " \t" });
  });

  test("uses the real content column when extra spaces follow the marker", () => {
    expect(entryAt("-   a", 1)).toMatchObject({ contentWs: "    " });
  });

  test("a task's content column is after `- `, not after the checkbox", () => {
    expect(entryAt("- [ ] a", 1)).toMatchObject({ contentWs: "  " });
  });

  test("returns null on non-list lines and on blank lines inside a list", () => {
    expect(entryAt("para", 1)).toBeNull();
    expect(entryAt("- a\n\n- b", 2)).toBeNull();
    expect(entryAt("- a\n  cont", 2)).toBeNull();
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

  test("outdents an empty nested item one level instead of wiping it", () => {
    const { state, ran } = run(listEnter, makeMarked("- a\n  - |"));
    expect(ran).toBe(true);
    expect(markedDoc(state)).toBe("- a\n- |");
  });

  test("outdents an empty depth-2 item to its parent's indent", () => {
    const { state } = run(listEnter, makeMarked("- a\n  - b\n    - |"));
    expect(markedDoc(state)).toBe("- a\n  - b\n  - |");
  });

  test("keeps the task box when outdenting an empty nested task", () => {
    const { state } = run(listEnter, makeMarked("- a\n  - b\n    - [ ] |"));
    expect(markedDoc(state)).toBe("- a\n  - b\n  - [ ] |");
  });

  test("outdents an empty nested item across a loose list's blank line", () => {
    const { state } = run(listEnter, makeMarked("- a\n\n  - |"));
    expect(markedDoc(state)).toBe("- a\n\n- |");
  });

  test("outdents an empty tab-indented item to the parent's whitespace", () => {
    const { state } = run(listEnter, makeMarked("- a\n\t- b\n\t  - |"));
    expect(markedDoc(state)).toBe("- a\n\t- b\n\t- |");
  });

  test("inherits a depth-3 prefix on continuation", () => {
    const { state } = run(listEnter, makeMarked("- a\n  - b\n    - c\n      - d|"));
    expect(markedDoc(state)).toBe("- a\n  - b\n    - c\n      - d\n      - |");
  });

  test("splits a nested item at the caret and carries the prefix", () => {
    const { state } = run(listEnter, makeMarked("- a\n  - b\n    - c|d"));
    expect(markedDoc(state)).toBe("- a\n  - b\n    - c\n    - |d");
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

  test("at marker start steps back one tab level, not two characters", () => {
    const { state } = run(listBackspace, makeMarked("- a\n\t- b\n\t\t|- c"));
    expect(markedDoc(state)).toBe("- a\n\t- b\n\t|- c");
  });

  test("at marker start under an ordered parent removes the whole three-space level", () => {
    const { state } = run(listBackspace, makeMarked("1. a\n   |- b"));
    expect(markedDoc(state)).toBe("1. a\n|- b");
  });

  test("at body start of a tab-indented depth-2 item keeps the parent's tab", () => {
    const { state } = run(listBackspace, makeMarked("- a\n\t- b\n\t\t- |c"));
    expect(markedDoc(state)).toBe("- a\n\t- b\n\t|c");
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

  test("nests a bullet under a different bullet character", () => {
    expect(markedDoc(run(listIndent, makeMarked("* a\n- b|")).state)).toBe("* a\n  - b|");
    expect(markedDoc(run(listIndent, makeMarked("- a\n+ b|")).state)).toBe("- a\n  + b|");
  });

  test("nests a bullet under an ordered parent at the ordered content column", () => {
    const { state } = run(listIndent, makeMarked("1. a\n- b|"));
    expect(markedDoc(state)).toBe("1. a\n   - b|");
    expect(prefixMarks(state).map((m) => m.style)).toEqual([
      "width: 6ch; --cm-list-marker-offset: 3ch; --cm-list-marker-width: 3ch",
    ]);
  });

  test("nests an ordered item under the item before it", () => {
    expect(markedDoc(run(listIndent, makeMarked("- a\n1. b|")).state)).toBe("- a\n  1. b|");
    expect(markedDoc(run(listIndent, makeMarked("1. a\n2. b|")).state)).toBe("1. a\n   2. b|");
  });

  test("nests under a tab-indented sibling with a tab, not spaces before the tab", () => {
    const { state } = run(listIndent, makeMarked("- a\n\t- b\n\t- c|"));
    expect(markedDoc(state)).toBe("- a\n\t- b\n\t  - c|");
    expect(prefixMarks(state).map((m) => m.style)).toEqual([
      "width: 3ch; --cm-list-marker-offset: 0ch; --cm-list-marker-width: 3ch",
      "width: 6ch; --cm-list-marker-offset: 3ch; --cm-list-marker-width: 3ch",
      "width: 9ch; --cm-list-marker-offset: 6ch; --cm-list-marker-width: 3ch",
    ]);
  });

  test("is a no-op on a tab-indented item that is already as deep as it can go", () => {
    const { state, ran } = run(listIndent, makeMarked("- a\n\t- b|"));
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n\t- b");
  });

  test("nests under an oddly indented sibling in one press", () => {
    // `   - c` (three spaces) is still b's sibling per CommonMark; d nests
    // under it at c's content column, not at a hard-coded +2.
    const { state } = run(listIndent, makeMarked("- a\n  - b\n   - c\n  - d|"));
    expect(markedDoc(state)).toBe("- a\n  - b\n   - c\n     - d|");
  });

  test("nests across a blank line in a loose list", () => {
    expect(markedDoc(run(listIndent, makeMarked("- a\n\n- b|")).state)).toBe("- a\n\n  - b|");
    expect(markedDoc(run(listIndent, makeMarked("- a\n\n  - b\n\n  - c|")).state)).toBe(
      "- a\n\n  - b\n\n    - c|",
    );
  });

  test("does not nest across a paragraph that ends the list", () => {
    const { state, ran } = run(listIndent, makeMarked("- a\n\npara\n\n- b|"));
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n\npara\n\n- b");
  });

  test("keeps a caret at the line start in place and moves a body caret with the text", () => {
    expect(markedDoc(run(listIndent, makeMarked("- a\n|- b")).state)).toBe("- a\n|  - b");
    expect(markedDoc(run(listIndent, makeMarked("- a\n- |b")).state)).toBe("- a\n  - |b");
  });

  test("moves a selected parent's children with it", () => {
    const { state } = run(listIndent, makeMarked("- x\n|- a\n  - b\n    - c|"));
    expect(state.doc.toString()).toBe("- x\n  - a\n    - b\n      - c");
    expect([state.selection.main.from, state.selection.main.to]).toEqual([4, 27]);
  });

  test("shifts a selection of mixed depths as one block", () => {
    const { state } = run(listIndent, makeMarked("- a\n|- b\n  - c\n- d|"));
    expect(state.doc.toString()).toBe("- a\n  - b\n    - c\n  - d");
  });

  test("leaves a selected subtree alone when its root cannot nest", () => {
    const { state, ran } = run(listIndent, makeMarked("|- a\n  - b\n    - c|"));
    expect(ran).toBe(true);
    expect(state.doc.toString()).toBe("- a\n  - b\n    - c");
  });

  test("nests selected nested siblings one under the other", () => {
    const { state } = run(listIndent, makeMarked("- a\n  |- b\n  - c|"));
    expect(state.doc.toString()).toBe("- a\n  - b\n    - c");
  });

  test("undo after a selection Tab restores the document and selection", () => {
    const before = makeMarked("- x\n|- a\n  - b\n    - c|");
    let state = run(listIndent, before).state;
    undo({
      state,
      dispatch: (tr) => {
        state = tr.state;
      },
    });
    expect(state.doc.toString()).toBe(before.doc.toString());
    expect(state.selection.toJSON()).toEqual(before.selection.toJSON());
  });

  test("works on freshly pasted nested lines", () => {
    const base = makeState("- a\n", 4);
    const pasted = withFullParse(
      base.update({ changes: { from: 4, insert: "- p\n  - q" }, selection: { anchor: 4 } }).state,
    );
    const selected = pasted.update({ selection: EditorSelection.single(4, 13) }).state;
    expect(run(listIndent, selected).state.doc.toString()).toBe("- a\n  - p\n    - q");
  });

  test("moves an item's hard-wrapped lines with its marker line", () => {
    const { state } = run(listIndent, makeMarked("- a\n- b one|\n  b two\n  b three"));
    expect(markedDoc(state)).toBe("- a\n  - b one|\n    b two\n    b three");
  });

  test("moves a loose item's later paragraph and a task's wrapped line", () => {
    const { state } = run(listIndent, makeMarked("- a\n- [ ] b|\n  b two\n\n  second\n  para"));
    expect(state.doc.toString()).toBe("- a\n  - [ ] b\n    b two\n\n    second\n    para");
  });

  test("indents a lazy unindented wrapped line along with its item", () => {
    const { state } = run(listIndent, makeMarked("- a\n- b one|\nb two"));
    expect(state.doc.toString()).toBe("- a\n  - b one\n  b two");
  });

  test("moves wrapped lines of a selected parent and its children", () => {
    const { state } = run(listIndent, makeMarked("- x\n|- a\n  a two\n  - b\n    b two|"));
    expect(state.doc.toString()).toBe("- x\n  - a\n    a two\n    - b\n      b two");
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

  test("lifts a bullet out from under an ordered parent", () => {
    expect(markedDoc(run(listOutdent, makeMarked("1. a\n   - b|")).state)).toBe("1. a\n- b|");
  });

  test("outdents a tab-indented item to its parent's whitespace", () => {
    expect(markedDoc(run(listOutdent, makeMarked("- a\n\t- b\n\t  - c|")).state)).toBe(
      "- a\n\t- b\n\t- c|",
    );
    expect(markedDoc(run(listOutdent, makeMarked("- a\n\t- b|")).state)).toBe("- a\n- b|");
  });

  test("lifts an oddly indented sibling to the parent level in one press", () => {
    const { state } = run(listOutdent, makeMarked("- a\n  - b\n   - c|\n  - d"));
    expect(markedDoc(state)).toBe("- a\n  - b\n- c|\n  - d");
  });

  test("outdents across a blank line in a loose list", () => {
    expect(markedDoc(run(listOutdent, makeMarked("- a\n\n  - b|")).state)).toBe("- a\n\n- b|");
  });

  test("moves a selected parent's children with it", () => {
    const { state } = run(listOutdent, makeMarked("- x\n|  - a\n    - b\n      - c|"));
    expect(state.doc.toString()).toBe("- x\n- a\n  - b\n    - c");
  });

  test("moves tab-indented children by the parent's whitespace, not by two chars", () => {
    const { state } = run(listOutdent, makeMarked("- x\n|\t- a\n\t  - b|"));
    expect(state.doc.toString()).toBe("- x\n- a\n  - b");
  });

  test("keeps a caret at the line start in place", () => {
    expect(markedDoc(run(listOutdent, makeMarked("- a\n|  - b")).state)).toBe("- a\n|- b");
  });

  test("moves an item's hard-wrapped lines with its marker line", () => {
    const { state } = run(listOutdent, makeMarked("- a\n  - b one|\n    b two"));
    expect(markedDoc(state)).toBe("- a\n- b one|\n  b two");
  });

  test("moves tab-indented wrapped lines by the parent's whitespace", () => {
    const { state } = run(listOutdent, makeMarked("- a\n\t- b one|\n\t  b two"));
    expect(state.doc.toString()).toBe("- a\n- b one\n  b two");
  });

  test("leaves a lazy wrapped line indented less than the marker alone", () => {
    const { state } = run(listOutdent, makeMarked("- a\n  - b one|\n b two"));
    expect(state.doc.toString()).toBe("- a\n- b one\n b two");
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

  // Line decorations (padding) and replaced ranges on continuation lines
  // of an item's own paragraph.
  function continuationDecos(state: EditorState) {
    const decos = state.field(__test.listDecorationsField);
    const lines: Array<{ line: number; style: string }> = [];
    const hidden: Array<[number, number]> = [];
    decos.all.between(0, state.doc.length, (from, to, deco) => {
      const spec = deco.spec as { attributes?: { style?: string }; class?: string };
      const isMarkerLine = /text-indent/.test(spec.attributes?.style ?? "");
      if (deco.spec.widget === undefined && from === to && !spec.class && !isMarkerLine) {
        lines.push({ line: state.doc.lineAt(from).number, style: spec.attributes?.style ?? "" });
      } else if (from < to && deco === __test.listContinuationIndentDecoration) {
        hidden.push([from, to]);
      }
    });
    return { lines, hidden };
  }

  test("pads a hard-wrapped item's continuation lines to the body column", () => {
    const s = makeState("- one two\n  three four\nfive");
    expect(continuationDecos(s)).toEqual({
      lines: [
        { line: 2, style: "padding-inline-start: 3ch;" },
        { line: 3, style: "padding-inline-start: 3ch;" },
      ],
      hidden: [[10, 12]],
    });
    // The collapsed indent is one atomic step.
    let atomic = 0;
    s.field(__test.listDecorationsField).atomic.between(10, 12, () => {
      atomic++;
    });
    expect(atomic).toBe(1);
  });

  test("pads nested, task, and ordered continuation lines by their own depth", () => {
    const s = makeState("- a\n  - [ ] b\n    c\n1. d\n   e");
    expect(continuationDecos(s)).toEqual({
      lines: [
        { line: 3, style: "padding-inline-start: 6ch;" },
        { line: 5, style: "padding-inline-start: 3ch;" },
      ],
      hidden: [
        [14, 18],
        [25, 28],
      ],
    });
  });

  test("leaves nested items and blank lines alone", () => {
    const s = makeState("- a\n  - b\n\npara");
    expect(continuationDecos(s).lines).toEqual([]);
  });

  test("pads every line of a loose item's later paragraphs, not just wrapped ones", () => {
    const s = makeState("- a\n\n  b one\n  b two\n- c");
    expect(continuationDecos(s)).toEqual({
      lines: [
        { line: 3, style: "padding-inline-start: 3ch;" },
        { line: 4, style: "padding-inline-start: 3ch;" },
      ],
      hidden: [
        [5, 7],
        [13, 15],
      ],
    });
  });

  test("pads a later paragraph of an item that holds a nested list", () => {
    const s = makeState("- a\n  - b\n\n  para");
    expect(continuationDecos(s)).toEqual({
      lines: [{ line: 4, style: "padding-inline-start: 3ch;" }],
      hidden: [[11, 13]],
    });
  });

  // Line numbers whose marker line carries the item-gap class.
  function gapLines(state: EditorState): number[] {
    const out: number[] = [];
    state.field(__test.listDecorationsField).all.between(0, state.doc.length, (from, to, deco) => {
      if (from === to && (deco.spec as { class?: string }).class === __test.LIST_ITEM_GAP_CLASS) {
        out.push(state.doc.lineAt(from).number);
      }
    });
    return out;
  }

  test("gaps items that follow another item, not the first of a list", () => {
    expect(gapLines(makeState("para\n- a\n- b\n- [ ] c"))).toEqual([3, 4]);
  });

  test("gaps at every depth, but not a nested list's first child", () => {
    expect(gapLines(makeState("- a\n  - b\n  - c\n- d\n  1. e\n  2. f"))).toEqual([3, 4, 6]);
  });

  test("gaps an item that opens a new list right after another list", () => {
    expect(gapLines(makeState("1. a\n- b\n* c"))).toEqual([2, 3]);
  });

  test("does not gap continuation lines or items after a blank line's paragraph", () => {
    expect(gapLines(makeState("- a\n  wrapped\n- b\n\npara\n\n- c"))).toEqual([3]);
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
