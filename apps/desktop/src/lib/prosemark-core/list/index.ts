import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Prec, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

class BulletMarkerWidget extends WidgetType {
  eq(_other: BulletMarkerWidget): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-list-bullet-marker";
    el.textContent = "•";
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class IndentSpacerWidget extends WidgetType {
  eq(_other: IndentSpacerWidget): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-list-indent-spacer";
    // ZWSP gives the inline-block text-node geometry so the caret rendered
    // at a spacer boundary has measurable height. Without it, a line whose
    // entire prefix is empty inline-blocks leaves the browser's Range API
    // with no text to anchor on, and the caret collapses to height 0.
    el.textContent = "​";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

const bulletMarkerDecoration = Decoration.replace({
  widget: new BulletMarkerWidget(),
});

const indentSpacerDecoration = Decoration.replace({
  widget: new IndentSpacerWidget(),
});

// Atomic-only sentinel for the task widget's range. The visual checkbox is
// owned by `taskExtension`; this decoration is added solely so the cursor
// motion / Backspace logic here treats `- [ ] ` as one atomic unit. The
// class name is incidental (no CSS attached).
const taskAtomicDecoration = Decoration.mark({ class: "cm-list-task-atomic" });

const isBulletMarkChar = (ch: string): boolean => ch === "-" || ch === "+" || ch === "*";

interface ListDecorations {
  /** Marker + spacers. Drives rendering. */
  all: DecorationSet;
  /** Same replace decorations — drives atomic cursor motion and the
   *  Backspace handler that deletes the full underlying range in one
   *  keystroke. */
  atomic: DecorationSet;
}

function buildListDecorations(state: EditorState): ListDecorations {
  const allRanges: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "TaskMarker") {
        // Task widget (rendered by `taskExtension`) spans `- [ ] ` — treat
        // the whole range as atomic so cursor motion skips it and Backspace
        // at its right edge removes all 6 chars. Require the trailing
        // space; without it, this isn't a real task marker yet.
        if (state.doc.sliceString(node.to, node.to + 1) !== " ") return;
        atomicRanges.push(taskAtomicDecoration.range(node.from - 2, node.to + 1));
        return;
      }
      if (node.name !== "ListMark") return;

      // Bullet lists only — skip ordered-list markers like `1.` or `2)`.
      const markText = state.doc.sliceString(node.from, node.to);
      if (markText.length !== 1 || !isBulletMarkChar(markText)) return;

      // Require a trailing space so a bare `-`/`+`/`*` the user just typed
      // (no space yet) renders as plain text, not a bullet. Lezer's
      // incremental parse can emit `ListMark` for the bare marker before
      // the space arrives.
      if (state.doc.sliceString(node.to, node.to + 1) !== " ") return;

      // Depth = number of ancestor `ListItem` nodes above the item this
      // mark belongs to. Top-level items have depth 0; one level of nesting
      // has depth 1; etc.
      let depth = -1;
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === "ListItem") depth++;
      }
      if (depth < 0) depth = 0;

      // Leading-whitespace spacers — one inline widget per nesting level,
      // evenly splitting the line's leading whitespace. Whatever the source
      // uses (2 spaces, 4 spaces, a tab), each indent step collapses to one
      // 1ch widget. Spacers are atomic so arrow keys and Backspace treat
      // each step as a unit (Backspace removes the whole step's chars).
      const line = state.doc.lineAt(node.from);
      const leadingFrom = line.from;
      const leadingTo = node.from;
      const leadingLen = leadingTo - leadingFrom;
      if (depth >= 1 && leadingLen >= depth) {
        const step = Math.floor(leadingLen / depth);
        for (let i = 0; i < depth; i++) {
          const subFrom = leadingFrom + i * step;
          const subTo = i === depth - 1 ? leadingTo : leadingFrom + (i + 1) * step;
          if (subTo <= subFrom) break;
          const spacerDeco = indentSpacerDecoration.range(subFrom, subTo);
          allRanges.push(spacerDeco);
          atomicRanges.push(spacerDeco);
        }
      }

      // Task items already get the checkbox widget from `taskExtension`;
      // don't double-replace the leading `-`.
      const cursor = node.node.cursor();
      if (cursor.nextSibling() && cursor.name === "Task") return;

      // Replace `<mark> ` (marker plus trailing space) with one bullet glyph.
      const markerDeco = bulletMarkerDecoration.range(node.from, node.to + 1);
      allRanges.push(markerDeco);
      atomicRanges.push(markerDeco);
    },
  });

  return {
    all: Decoration.set(allRanges, true),
    atomic: Decoration.set(atomicRanges, true),
  };
}

const listDecorationsField = StateField.define<ListDecorations>({
  create(state) {
    return buildListDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildListDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.all),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

// One indent step's worth of source text. Two spaces matches the common
// markdown convention and is the narrowest indent Lezer recognizes as a
// nested list (4 spaces from the very left flips a top-level line into an
// indented code block).
const INDENT_STEP_TEXT = "  ";

const isOnListLine = (state: EditorState, pos: number): boolean => {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0); n; n = n.parent) {
    if (n.name === "ListItem") return true;
  }
  return false;
};

const listIndent = (view: EditorView): boolean => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  view.dispatch({
    changes: { from: line.from, insert: INDENT_STEP_TEXT },
    selection: { anchor: sel.head + INDENT_STEP_TEXT.length },
    userEvent: "input.indent",
  });
  return true;
};

const listOutdent = (view: EditorView): boolean => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  const text = line.text;
  let removeLen = 0;
  if (text.startsWith("\t")) removeLen = 1;
  else if (text.startsWith("  ")) removeLen = 2;
  else if (text.startsWith(" ")) removeLen = 1;
  if (removeLen === 0) return false;

  const cursorOffsetInLine = sel.head - line.from;
  const newHead = line.from + Math.max(0, cursorOffsetInLine - removeLen);
  view.dispatch({
    changes: { from: line.from, to: line.from + removeLen },
    selection: { anchor: newHead },
    userEvent: "delete.outdent",
  });
  return true;
};

// Matches a line whose content is only a list marker (bullet or task) and
// the required trailing space — i.e. an empty list item the user typed
// `Enter` on. Captures optional leading whitespace for nested empties.
const EMPTY_LIST_LINE_RE = /^[ \t]*[-+*] (\[.\] )?$/;

// Captures the indent + marker + optional task-marker prefix of any list
// line. Used to mirror the prefix onto the next line on `Enter`.
const LIST_LINE_PREFIX_RE = /^([ \t]*)([-+*]) (\[.\] )?/;

const listEnter = (view: EditorView): boolean => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1) return false;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);

  // Empty list item → wipe and break out of the list.
  if (EMPTY_LIST_LINE_RE.test(line.text)) {
    view.dispatch({
      changes: { from: line.from, to: line.to },
      selection: { anchor: line.from },
      userEvent: "delete.empty-list-marker",
    });
    return true;
  }

  // Smart continuation: mirror the line's `<indent><marker> ` (with `[ ] `
  // for tasks, always unchecked) onto the new line so a new item exists
  // immediately after the marker + space, as soon as the user hits Enter.
  const match = LIST_LINE_PREFIX_RE.exec(line.text);
  if (!match) return false;
  const indent = match[1] ?? "";
  const marker = match[2] ?? "-";
  const isTask = match[3] !== undefined;

  // Defer to the default Enter when the cursor sits at/before the prefix's
  // end — splitting before the marker shouldn't duplicate it.
  const cursorOffsetInLine = sel.head - line.from;
  const prefixLen = match[0].length;
  if (cursorOffsetInLine < prefixLen) return false;

  const continuation = isTask ? `${indent}${marker} [ ] ` : `${indent}${marker} `;
  view.dispatch({
    changes: { from: sel.head, insert: `\n${continuation}` },
    selection: { anchor: sel.head + 1 + continuation.length },
    userEvent: "input.list-continue",
  });
  return true;
};

// `deleteCharBackward` from @codemirror/commands ignores `atomicRanges` — it
// uses `findClusterBreak` / code-point math, not `view.moveByChar`. So we
// install an explicit Backspace handler that removes the full atomic range
// when the cursor sits at its right edge. Ordinary text falls through to
// the default handler (one underlying char per keystroke).
const listBackspace = (view: EditorView): boolean => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const head = range.head;
  const atomic = state.field(listDecorationsField).atomic;
  const lineStart = state.doc.lineAt(head).from;

  let from = -1;
  atomic.between(lineStart, head, (rangeFrom, rangeTo) => {
    if (rangeTo === head) {
      from = rangeFrom;
      return false;
    }
    return undefined;
  });

  if (from < 0) return false;

  view.dispatch({
    changes: { from, to: head },
    selection: { anchor: from },
    userEvent: "delete.list",
  });
  return true;
};

export const listExtension: Extension = [
  listDecorationsField,
  Prec.high(
    keymap.of([
      { key: "Backspace", run: listBackspace },
      { key: "Enter", run: listEnter },
      { key: "Tab", run: listIndent },
      { key: "Shift-Tab", run: listOutdent },
    ]),
  ),
];
