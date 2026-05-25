import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  Prec,
  type Range,
  StateField,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from "@codemirror/view";
import { eventHandlersWithClass } from "../utils";

// Single source of truth for the width of every list widget (bullet,
// checkbox wrapper, every indent spacer). Drives the hanging-indent
// formula too, so all geometry scales together — tweak this constant to
// resize the whole list-rendering column.
const LIST_UNIT_CH = 3;
const LIST_UNIT_WIDTH = `${LIST_UNIT_CH.toString()}ch`;

// Cap on how far `findPrevListItemIndent` walks backward looking for a
// parent. List nesting in practice is shallow; this avoids O(n) on giant
// docs with no blank-line breaks between items.
const PREV_LIST_LOOKBACK = 256;

class BulletMarkerWidget extends WidgetType {
  eq(_other: BulletMarkerWidget): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-list-bullet-marker";
    el.textContent = "•";
    el.style.width = LIST_UNIT_WIDTH;
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(): HTMLElement {
    // Wrapper width matches the bullet marker so tasks and bullets share
    // the same hanging-indent and spacer geometry. `display: inline-block`
    // is set inline because the existing `.cm-checkbox-wrapper` rule only
    // sets `position: relative`. The hidden single-char spacer is kept so
    // the inline-block has text-node line-height geometry; the visible
    // checkbox is absolutely positioned on top. The `cm-checkbox`-targeted
    // click handler below toggles state via `computeCheckboxToggle`.
    const wrapper = document.createElement("span");
    wrapper.className = "cm-checkbox-wrapper";
    wrapper.style.display = "inline-block";
    wrapper.style.width = LIST_UNIT_WIDTH;

    const spacer = document.createElement("span");
    spacer.className = "cm-checkbox-spacer";
    spacer.textContent = "•";
    wrapper.appendChild(spacer);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-checkbox";
    input.checked = this.checked;
    wrapper.appendChild(input);

    return wrapper;
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
    el.style.width = LIST_UNIT_WIDTH;
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

// Wraps the body text of a list item (everything after the bullet/checkbox
// widget through the end of the line) in a `<span class="cm-list-body">`,
// so consumers can style body content distinctly from the marker.
const listBodyDecoration = Decoration.mark({ class: "cm-list-body" });

const isBulletMarkChar = (ch: string): boolean => ch === "-" || ch === "+" || ch === "*";

// Ordered-list markers per CommonMark: a run of digits followed by `.` or `)`.
const ORDERED_MARKER_RE = /^\d+[.)]$/;
const isOrderedMarkText = (s: string): boolean => ORDERED_MARKER_RE.test(s);

// Line-level hanging indent applied to ordered-list lines: the marker hangs
// in the left gutter and wrapped continuation aligns with the body column.
// Ordered markers stay as source text (the digits matter) so this is the
// only decoration the list extension emits for them — no widgets, spacers,
// or body wrap.
const orderedLineDecoration = Decoration.line({
  attributes: { style: "padding-inline-start: 3ch; text-indent: -3.2ch;" },
});

// A list marker is followed by a space OR tab per CommonMark; accept both
// in the trailing-char gates so tab-separated markers render.
const isMarkerTrailingChar = (ch: string): boolean => ch === " " || ch === "\t";

interface ListDecorations {
  /** Marker + spacers + body wraps + per-line hanging-indent. Drives
   *  rendering. */
  all: DecorationSet;
  /** Drives atomic cursor motion — every list widget (bullet, task, every
   *  spacer) skips as a unit. */
  atomic: DecorationSet;
  /** Bullet + task ranges only. Backspace at one of these right edges
   *  extends the deletion to `line.from`, so wiping the marker also clears
   *  the leading indent that was carrying its nesting. */
  marker: DecorationSet;
}

function buildListDecorations(state: EditorState): ListDecorations {
  const allRanges: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  const markerRanges: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "ListMark") return;

      // Require a trailing space/tab so a bare marker the user just typed
      // (no whitespace yet) renders as plain text, not a list. Lezer's
      // incremental parse can emit `ListMark` for the bare marker before
      // the whitespace arrives.
      if (!isMarkerTrailingChar(state.doc.sliceString(node.to, node.to + 1))) return;

      // Ordered-list markers (`1.`, `2)`): only emit the hanging-indent
      // line decoration. The digits stay as source text (no widget), and
      // we intentionally skip spacers/body wrap to keep ordered rendering
      // minimal.
      const markText = state.doc.sliceString(node.from, node.to);
      if (isOrderedMarkText(markText)) {
        const line = state.doc.lineAt(node.from);
        allRanges.push(orderedLineDecoration.range(line.from));
        return;
      }

      // Bullet lists only beyond this point — skip anything else.
      if (markText.length !== 1 || !isBulletMarkChar(markText)) return;

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
      // uses (2 spaces, 4 spaces, a tab), each indent step collapses to
      // one `LIST_UNIT_CH` widget. Spacers are atomic so arrow keys and
      // Backspace treat each step as a unit (Backspace removes the whole
      // step's chars).
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

      // Task vs plain bullet: tasks become one Checkbox widget over
      // `- [ ] ` (marker + task marker + trailing whitespace); plain
      // bullets become one Bullet widget over `- ` (marker + trailing
      // whitespace). Same `Decoration.replace` shape either way — atomic,
      // in the marker set, in the rendered set.
      const cursor = node.node.cursor();
      let widgetDeco: Range<Decoration> | null = null;
      let widgetTo = -1;
      if (cursor.nextSibling() && cursor.name === "Task") {
        const taskCursor = cursor.node.cursor();
        if (
          taskCursor.firstChild() &&
          taskCursor.name === "TaskMarker" &&
          isMarkerTrailingChar(state.doc.sliceString(taskCursor.to, taskCursor.to + 1))
        ) {
          const checked =
            state.doc.sliceString(taskCursor.from + 1, taskCursor.to - 1).toLowerCase() === "x";
          widgetTo = taskCursor.to + 1;
          widgetDeco = Decoration.replace({ widget: new CheckboxWidget(checked) }).range(
            node.from,
            widgetTo,
          );
        }
      }
      if (!widgetDeco) {
        widgetTo = node.to + 1;
        widgetDeco = bulletMarkerDecoration.range(node.from, widgetTo);
      }
      allRanges.push(widgetDeco);
      atomicRanges.push(widgetDeco);
      markerRanges.push(widgetDeco);

      // Wrap the body text (everything after the widget through end of
      // line) so consumers can style it via `.cm-list-body`. Skipped when
      // the item is empty (no body content).
      if (widgetTo < line.to) {
        allRanges.push(listBodyDecoration.range(widgetTo, line.to));
      }

      // Hanging-indent on every list line (including top level): pad the
      // whole line by the rendered prefix width (`(depth + 1) ×
      // LIST_UNIT_CH` — every list widget is `LIST_UNIT_CH` wide) and pull
      // the first line back with a matching negative `text-indent`, so the
      // marker sits in the gutter on line 1 and wrapped continuation text
      // aligns with the body column.
      const prefixCh = (depth + 1) * LIST_UNIT_CH;
      const lineStyle = `padding-inline-start: ${prefixCh.toString()}ch; text-indent: -${prefixCh.toString()}ch;`;
      allRanges.push(Decoration.line({ attributes: { style: lineStyle } }).range(line.from));
    },
  });

  return {
    all: Decoration.set(allRanges, true),
    atomic: Decoration.set(atomicRanges, true),
    marker: Decoration.set(markerRanges, true),
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

// Find the indent of the nearest list-item line above `lineNumber` whose
// own indent matches the predicate. Used by indent / outdent to align the
// current line to a valid CommonMark parent. Returns -1 if none found
// before a blank line breaks the list context, or after PREV_LIST_LOOKBACK
// lines (defensive cap so giant docs don't pay an O(n) scan per keystroke).
const findPrevListItemIndent = (
  state: EditorState,
  lineNumber: number,
  predicate: (indent: number) => boolean,
): number => {
  const stop = Math.max(1, lineNumber - PREV_LIST_LOOKBACK);
  for (let i = lineNumber - 1; i >= stop; i--) {
    const prev = state.doc.line(i);
    const text = prev.text;
    if (text.trim() === "") return -1;
    const m = /^([ \t]*)[-+*] /.exec(text);
    if (m && predicate(m[1].length)) return m[1].length;
  }
  return -1;
};

const currentLineIndentLen = (lineText: string): number =>
  /^[ \t]*/.exec(lineText)?.[0].length ?? 0;

// Walk the syntax tree across the entire line range looking for a list
// marker. The previous `resolveInner(pos)` ancestor-walk approach worked
// for bullets but missed empty tasks: with the cursor at the end of
// `- [ ] ` the resolved node sits outside the `ListItem` and the walk
// never reaches it. Iterating the line range catches `ListMark` /
// `TaskMarker` regardless of where the caret sits on the line.
const isOnListLine = (state: EditorState, pos: number): boolean => {
  const line = state.doc.lineAt(pos);
  let found = false;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name === "ListMark" || node.name === "TaskMarker") {
        found = true;
        return false;
      }
      return undefined;
    },
  });
  return found;
};

// `StateCommand` signature instead of `(view) => boolean` keeps the
// handlers testable: tests can call them with `{state, dispatch}` directly
// (no `EditorView`/DOM needed). EditorView satisfies the same shape, so
// they still bind to the keymap without changes.

// Tab on a list line: nest one level deeper by aligning to the previous
// list item's content column (= prev indent + 2 for `- ` markers). That
// matches CommonMark's rule that a nested item's indent must be ≥ the
// parent's content column, while staying within the parent's `+3` window
// (which is what blanket "insert 2 spaces" violates once the chain of
// parents above isn't deep enough — Lezer reclassifies the line as a code
// continuation and the bullet vanishes). Always consumes Tab on a list
// line (even when nesting is a no-op) so `indentWithTab` doesn't fall
// through and insert a literal `\t` — that would break the list parse.
const listIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  // Multi-cursor / non-empty selection: consume so the fall-through
  // `indentWithTab` doesn't insert `\t` characters that break list parsing
  // on any of the selected lines. Multi-line list indent is a TODO.
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return isOnListLineAtAnyRange(state);
  }
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  const currentIndent = currentLineIndentLen(line.text);

  const prevIndent = findPrevListItemIndent(state, line.number, (i) => i <= currentIndent);
  if (prevIndent < 0) return true;
  const targetIndent = prevIndent + 2;
  if (currentIndent >= targetIndent) return true;

  const insertLen = targetIndent - currentIndent;
  dispatch(
    state.update({
      changes: { from: line.from, insert: " ".repeat(insertLen) },
      selection: { anchor: sel.head + insertLen },
      userEvent: "input.indent",
    }),
  );
  return true;
};

// Shift-Tab on a list line: align to the nearest previous list item with
// a strictly shallower indent — i.e. step up one nesting level. Same
// multi-cursor-consume policy as `listIndent`.
const listOutdent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return isOnListLineAtAnyRange(state);
  }
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  const currentIndent = currentLineIndentLen(line.text);
  if (currentIndent === 0) return true;

  const prevIndent = findPrevListItemIndent(state, line.number, (i) => i < currentIndent);
  const targetIndent = Math.max(0, prevIndent);

  const removeLen = currentIndent - targetIndent;
  if (removeLen <= 0) return true;

  const cursorOffsetInLine = sel.head - line.from;
  const newHead = line.from + Math.max(targetIndent, cursorOffsetInLine - removeLen);
  dispatch(
    state.update({
      changes: { from: line.from, to: line.from + removeLen },
      selection: { anchor: newHead },
      userEvent: "delete.outdent",
    }),
  );
  return true;
};

// Matches a line whose content is only a list marker (bullet or task) and
// the required trailing space — i.e. an empty list item the user typed
// `Enter` on. Captures optional leading whitespace for nested empties.
const EMPTY_LIST_LINE_RE = /^[ \t]*[-+*] (\[.\] )?$/;

// Captures the indent + marker + optional task-marker prefix of any list
// line. Used to mirror the prefix onto the next line on `Enter`.
const LIST_LINE_PREFIX_RE = /^([ \t]*)([-+*]) (\[.\] )?/;

const listEnter: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  // Multi-cursor / non-empty selection: fall through to default Enter
  // (insert newline) — list-aware splitting on multi-line selections is
  // out of scope for now.
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);

  // Empty list item → wipe and break out of the list.
  if (EMPTY_LIST_LINE_RE.test(line.text)) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to },
        selection: { anchor: line.from },
        userEvent: "delete.empty-list-marker",
      }),
    );
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
  dispatch(
    state.update({
      changes: { from: sel.head, insert: `\n${continuation}` },
      selection: { anchor: sel.head + 1 + continuation.length },
      userEvent: "input.list-continue",
    }),
  );
  return true;
};

// CodeMirror 6's `deleteCharBackward` from `@codemirror/commands` DOES
// respect `atomicRanges` via `skipAtomic` — but it deletes exactly the
// atomic range, not more. This handler is what gives the user-visible
// "Backspace at a bullet wipes the leading indent too" behavior: at a
// marker's right edge, deletion is extended to `line.from`. At a spacer's
// right edge, just the spacer's source chars go (one indent step). The
// handler is also what makes lang-markdown's `deleteMarkupBackward` skip
// list-line backspacing (we return true and stop the chain).
const findEndsAt = (set: DecorationSet, lineStart: number, head: number): number => {
  let from = -1;
  set.between(lineStart, head, (rangeFrom, rangeTo) => {
    if (rangeTo === head) {
      from = rangeFrom;
      return false;
    }
    return undefined;
  });
  return from;
};

const listBackspace: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const head = range.head;
  const decos = state.field(listDecorationsField);
  const lineStart = state.doc.lineAt(head).from;

  // Bullet/task first: extend to line.from so leading indent goes with it.
  if (findEndsAt(decos.marker, lineStart, head) >= 0) {
    dispatch(
      state.update({
        changes: { from: lineStart, to: head },
        selection: { anchor: lineStart },
        userEvent: "delete.list",
      }),
    );
    return true;
  }

  // Spacer: delete just the one indent step's chars.
  const spacerFrom = findEndsAt(decos.atomic, lineStart, head);
  if (spacerFrom < 0) return false;
  dispatch(
    state.update({
      changes: { from: spacerFrom, to: head },
      selection: { anchor: spacerFrom },
      userEvent: "delete.list",
    }),
  );
  return true;
};

// Returns true if any selection range's `head` sits on a list line. Used
// by the Tab/Shift-Tab multi-cursor short-circuit so we still consume the
// keystroke (suppressing `indentWithTab`) even when we won't act on it.
const isOnListLineAtAnyRange = (state: EditorState): boolean =>
  state.selection.ranges.some((r) => isOnListLine(state, r.head));

// Click-toggle for the checkbox `<input>`. The widget DOM is rendered by
// `CheckboxWidget` above; this handler is wired via `EditorView`'s
// mousedown facet. The toggle position is derived from the source slice
// (regex on `<mark> [X] `) rather than hardcoded offsets so future widget-
// range tweaks don't silently desync. `posAtDOM` on a node inside a
// `Decoration.replace` returns the replace range's `from`, which is the
// ListMark's `from` here — exactly the anchor the regex needs.
export const computeCheckboxToggle = (
  state: EditorState,
  widgetStartPos: number,
): TransactionSpec | null => {
  const slice = state.doc.sliceString(widgetStartPos, widgetStartPos + 8);
  const m = /^[-+*] \[([ xX])\][ \t]/.exec(slice);
  if (!m) return null;
  const innerCharPos = widgetStartPos + 3; // position of the ` ` or `x` inside `[ ]`
  const currentlyChecked = m[1]?.toLowerCase() === "x";
  return {
    changes: {
      from: innerCharPos,
      to: innerCharPos + 1,
      insert: currentlyChecked ? " " : "x",
    },
    userEvent: "input.toggle-checkbox",
  };
};

const checkboxClickHandler = EditorView.domEventHandlers(
  eventHandlersWithClass({
    mousedown: {
      "cm-checkbox": (ev, view) => {
        const pos = view.posAtDOM(ev.target as HTMLElement);
        const spec = computeCheckboxToggle(view.state, pos);
        if (!spec) return false;
        view.dispatch(spec);
        return true; // prevent default
      },
    },
  }),
);

export const listExtension: Extension = [
  listDecorationsField,
  // `Prec.highest` wins over `@codemirror/lang-markdown`'s `Prec.high`
  // keymap (which also binds Enter and Backspace via
  // `insertNewlineContinueMarkup` / `deleteMarkupBackward`). On non-list
  // contexts (ordered lists, blockquotes, ATX headings) our handlers
  // return false and lang-markdown's still runs — that's how blockquote
  // `> ` deletion and ordered-list `1. ` continuation are preserved.
  Prec.highest(
    keymap.of([
      { key: "Backspace", run: listBackspace },
      { key: "Enter", run: listEnter },
      { key: "Tab", run: listIndent },
      { key: "Shift-Tab", run: listOutdent },
    ]),
  ),
  checkboxClickHandler,
];

// Internals exposed only for tests. Not part of the public API.
export const __test = {
  buildListDecorations,
  isOnListLine,
  findPrevListItemIndent,
  currentLineIndentLen,
  listEnter,
  listBackspace,
  listIndent,
  listOutdent,
  EMPTY_LIST_LINE_RE,
  LIST_LINE_PREFIX_RE,
  LIST_UNIT_CH,
  listDecorationsField,
};
