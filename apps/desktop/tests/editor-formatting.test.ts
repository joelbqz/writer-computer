import { describe, expect, test } from "vite-plus/test";
import { EditorState, EditorSelection } from "@codemirror/state";
import type { StateCommand } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  toggleBold,
  toggleItalic,
  toggleInlineCode,
  toggleStrikethrough,
  insertLink,
  setHeading,
  setParagraph,
  toggleBulletList,
  toggleNumberedList,
  toggleBlockquote,
  toggleTaskList,
  clearInlineFormatting,
  toggleFencedCodeBlock,
  insertTable,
  insertHorizontalRule,
  insertToday,
  insertNow,
} from "../src/components/editor-area/markdown-formatting";

function run(cmd: StateCommand, doc: string, anchor: number, head?: number): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] })],
    selection: EditorSelection.create([EditorSelection.range(anchor, head ?? anchor)]),
  });
  let next = state;
  cmd({
    state,
    dispatch: (tr) => {
      next = tr.state;
    },
  });
  return next;
}

function doc(state: EditorState) {
  return state.doc.toString();
}

function cursor(state: EditorState) {
  return state.selection.main.head;
}

function sel(state: EditorState) {
  const { from, to } = state.selection.main;
  return { from, to };
}

// ---------------------------------------------------------------------------
// toggleBold
// ---------------------------------------------------------------------------

describe("toggleBold", () => {
  test("wraps word under caret", () => {
    const s = run(toggleBold, "hello world", 2);
    expect(doc(s)).toBe("**hello** world");
  });

  test("wraps selection", () => {
    const s = run(toggleBold, "hello world", 0, 5);
    expect(doc(s)).toBe("**hello** world");
    expect(sel(s)).toEqual({ from: 2, to: 7 });
  });

  test("inserts empty delimiters when no word at caret", () => {
    const s = run(toggleBold, "hello ", 6);
    expect(doc(s)).toBe("hello ****");
    expect(cursor(s)).toBe(8);
  });

  test("unwraps existing bold", () => {
    const s = run(toggleBold, "**hello** world", 4);
    expect(doc(s)).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// toggleItalic
// ---------------------------------------------------------------------------

describe("toggleItalic", () => {
  test("wraps word under caret", () => {
    const s = run(toggleItalic, "hello world", 2);
    expect(doc(s)).toBe("*hello* world");
  });

  test("wraps selection", () => {
    const s = run(toggleItalic, "hello world", 0, 5);
    expect(doc(s)).toBe("*hello* world");
    expect(sel(s)).toEqual({ from: 1, to: 6 });
  });

  test("inserts empty delimiters when no word at caret", () => {
    const s = run(toggleItalic, "hello ", 6);
    expect(doc(s)).toBe("hello **");
    expect(cursor(s)).toBe(7);
  });

  test("unwraps existing italic", () => {
    const s = run(toggleItalic, "*hello* world", 3);
    expect(doc(s)).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// toggleInlineCode
// ---------------------------------------------------------------------------

describe("toggleInlineCode", () => {
  test("wraps word under caret", () => {
    const s = run(toggleInlineCode, "hello world", 2);
    expect(doc(s)).toBe("`hello` world");
  });

  test("wraps selection", () => {
    const s = run(toggleInlineCode, "hello world", 0, 5);
    expect(doc(s)).toBe("`hello` world");
    expect(sel(s)).toEqual({ from: 1, to: 6 });
  });

  test("inserts empty delimiters when no word at caret", () => {
    const s = run(toggleInlineCode, "hello ", 6);
    expect(doc(s)).toBe("hello ``");
    expect(cursor(s)).toBe(7);
  });

  test("unwraps existing inline code", () => {
    const s = run(toggleInlineCode, "`hello` world", 3);
    expect(doc(s)).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// toggleStrikethrough
// ---------------------------------------------------------------------------

describe("toggleStrikethrough", () => {
  test("wraps word under caret", () => {
    const s = run(toggleStrikethrough, "hello world", 2);
    expect(doc(s)).toBe("~~hello~~ world");
  });

  test("wraps selection", () => {
    const s = run(toggleStrikethrough, "hello world", 0, 5);
    expect(doc(s)).toBe("~~hello~~ world");
    expect(sel(s)).toEqual({ from: 2, to: 7 });
  });

  test("inserts empty delimiters when no word at caret", () => {
    const s = run(toggleStrikethrough, "hello ", 6);
    expect(doc(s)).toBe("hello ~~~~");
    expect(cursor(s)).toBe(8);
  });

  test("unwraps existing strikethrough", () => {
    const s = run(toggleStrikethrough, "~~hello~~ world", 4);
    expect(doc(s)).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// insertLink
// ---------------------------------------------------------------------------

describe("insertLink", () => {
  test("inserts empty link at caret", () => {
    const s = run(insertLink, "hello ", 6);
    expect(doc(s)).toBe("hello [](url)");
    expect(sel(s)).toEqual({ from: 9, to: 12 });
  });

  test("wraps selection as link text", () => {
    const s = run(insertLink, "hello world", 0, 5);
    expect(doc(s)).toBe("[hello](url) world");
    expect(sel(s)).toEqual({ from: 8, to: 11 });
  });
});

// ---------------------------------------------------------------------------
// setHeading
// ---------------------------------------------------------------------------

describe("setHeading", () => {
  test("adds heading prefix to plain line", () => {
    const s = run(setHeading(2), "hello", 0);
    expect(doc(s)).toBe("## hello");
  });

  test("replaces existing heading level", () => {
    const s = run(setHeading(3), "## hello", 3);
    expect(doc(s)).toBe("### hello");
  });

  test("handles heading 1", () => {
    const s = run(setHeading(1), "hello", 0);
    expect(doc(s)).toBe("# hello");
  });
});

// ---------------------------------------------------------------------------
// setParagraph
// ---------------------------------------------------------------------------

describe("setParagraph", () => {
  test("strips heading prefix", () => {
    const s = run(setParagraph, "## hello", 3);
    expect(doc(s)).toBe("hello");
  });

  test("no-op on plain paragraph", () => {
    const s = run(setParagraph, "hello", 2);
    expect(doc(s)).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// toggleBulletList
// ---------------------------------------------------------------------------

describe("toggleBulletList", () => {
  test("adds bullet prefix", () => {
    const s = run(toggleBulletList, "hello", 0);
    expect(doc(s)).toBe("- hello");
  });

  test("removes bullet prefix when all lines have it", () => {
    const s = run(toggleBulletList, "- hello\n- world", 0, 15);
    expect(doc(s)).toBe("hello\nworld");
  });

  test("adds bullet prefix to lines that lack it", () => {
    const s = run(toggleBulletList, "hello\nworld", 0, 11);
    expect(doc(s)).toBe("- hello\n- world");
  });

  test("removes a nested bullet's marker in place, keeping its indent", () => {
    const s = run(toggleBulletList, "- a\n  - b", 8);
    expect(doc(s)).toBe("- a\n  b");
  });

  test("adds the marker after existing indent on a nested plain line", () => {
    const s = run(toggleBulletList, "- a\n  text", 8);
    expect(doc(s)).toBe("- a\n  - text");
  });

  test("treats a parent and its nested child as all-bulleted", () => {
    const s = run(toggleBulletList, "- a\n  - b", 0, 9);
    expect(doc(s)).toBe("a\n  b");
  });
});

// ---------------------------------------------------------------------------
// toggleNumberedList
// ---------------------------------------------------------------------------

describe("toggleNumberedList", () => {
  test("adds numbered prefix", () => {
    const s = run(toggleNumberedList, "hello\nworld", 0, 11);
    expect(doc(s)).toBe("1. hello\n2. world");
  });

  test("removes numbered prefix when all lines have it", () => {
    const s = run(toggleNumberedList, "1. hello\n2. world", 0, 17);
    expect(doc(s)).toBe("hello\nworld");
  });
});

// ---------------------------------------------------------------------------
// toggleBlockquote
// ---------------------------------------------------------------------------

describe("toggleBlockquote", () => {
  test("adds blockquote prefix", () => {
    const s = run(toggleBlockquote, "hello", 0);
    expect(doc(s)).toBe("> hello");
  });

  test("removes blockquote prefix when all lines have it", () => {
    const s = run(toggleBlockquote, "> hello\n> world", 0, 15);
    expect(doc(s)).toBe("hello\nworld");
  });
});

// ---------------------------------------------------------------------------
// toggleTaskList
// ---------------------------------------------------------------------------

describe("toggleTaskList", () => {
  test("adds task prefix", () => {
    const s = run(toggleTaskList, "hello", 0);
    expect(doc(s)).toBe("- [ ] hello");
  });

  test("removes task prefix when all lines have it", () => {
    const s = run(toggleTaskList, "- [ ] hello\n- [ ] world", 0, 23);
    expect(doc(s)).toBe("hello\nworld");
  });

  test("removes checked task prefix", () => {
    const s = run(toggleTaskList, "- [x] hello\n- [x] world", 0, 23);
    expect(doc(s)).toBe("hello\nworld");
  });

  test("turns a bullet into a task in place", () => {
    const s = run(toggleTaskList, "- hello", 0);
    expect(doc(s)).toBe("- [ ] hello");
  });

  test("turns a nested bullet into a nested task", () => {
    const s = run(toggleTaskList, "- a\n  - b", 8);
    expect(doc(s)).toBe("- a\n  - [ ] b");
  });

  test("adds the task prefix after existing indent", () => {
    const s = run(toggleTaskList, "- a\n  text", 8);
    expect(doc(s)).toBe("- a\n  - [ ] text");
  });

  test("removes a nested task's prefix, keeping its indent", () => {
    const s = run(toggleTaskList, "- a\n  - [ ] b", 10);
    expect(doc(s)).toBe("- a\n  b");
  });
});

// ---------------------------------------------------------------------------
// clearInlineFormatting
// ---------------------------------------------------------------------------

describe("clearInlineFormatting", () => {
  test("strips bold markers", () => {
    const s = run(clearInlineFormatting, "**bold**", 0, 8);
    expect(doc(s)).toBe("bold");
  });

  test("strips italic markers", () => {
    const s = run(clearInlineFormatting, "*italic*", 0, 8);
    expect(doc(s)).toBe("italic");
  });

  test("strips strikethrough markers", () => {
    const s = run(clearInlineFormatting, "~~struck~~", 0, 10);
    expect(doc(s)).toBe("struck");
  });

  test("strips inline code markers", () => {
    const s = run(clearInlineFormatting, "`code`", 0, 6);
    expect(doc(s)).toBe("code");
  });

  test("strips nested formatting", () => {
    const s = run(clearInlineFormatting, "**bold *and italic***", 0, 21);
    expect(doc(s)).toBe("bold and italic");
  });

  test("returns false for empty selection", () => {
    const state = EditorState.create({
      doc: "hello",
      extensions: [markdown({ extensions: [GFM] })],
      selection: EditorSelection.create([EditorSelection.cursor(2)]),
    });
    let changed = false;
    clearInlineFormatting({
      state,
      dispatch: () => {
        changed = true;
      },
    });
    expect(changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggleFencedCodeBlock
// ---------------------------------------------------------------------------

describe("toggleFencedCodeBlock", () => {
  test("wraps selected lines in code fences", () => {
    const s = run(toggleFencedCodeBlock, "hello\nworld", 0, 11);
    expect(doc(s)).toBe("```\nhello\nworld\n```");
  });

  test("unwraps when already fenced", () => {
    const s = run(toggleFencedCodeBlock, "```\nhello\nworld\n```", 0, 19);
    expect(doc(s)).toBe("hello\nworld");
  });

  test("wraps a single line", () => {
    const s = run(toggleFencedCodeBlock, "hello", 0, 5);
    expect(doc(s)).toBe("```\nhello\n```");
  });
});

// ---------------------------------------------------------------------------
// insertTable
// ---------------------------------------------------------------------------

describe("insertTable", () => {
  test("inserts a 3-column table at caret", () => {
    const s = run(insertTable, "", 0);
    expect(doc(s)).toContain("| Column 1 | Column 2 | Column 3 |");
    expect(doc(s)).toContain("| --- | --- | --- |");
    expect(doc(s)).toContain("|  |  |  |");
  });
});

// ---------------------------------------------------------------------------
// insertHorizontalRule
// ---------------------------------------------------------------------------

describe("insertHorizontalRule", () => {
  test("inserts --- on empty line", () => {
    const s = run(insertHorizontalRule, "", 0);
    expect(doc(s)).toBe("---\n");
  });

  test("inserts newline + --- on non-empty line", () => {
    const s = run(insertHorizontalRule, "hello", 5);
    expect(doc(s)).toBe("hello\n---\n");
  });
});

// ---------------------------------------------------------------------------
// insertToday
// ---------------------------------------------------------------------------

describe("insertToday", () => {
  test("inserts date in YYYY-MM-DD format", () => {
    const s = run(insertToday, "", 0);
    expect(doc(s)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// insertNow
// ---------------------------------------------------------------------------

describe("insertNow", () => {
  test("inserts time in HH:mm format", () => {
    const s = run(insertNow, "", 0);
    expect(doc(s)).toMatch(/^\d{2}:\d{2}$/);
  });
});
