import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type Range,
  type SelectionRange,
  StateField,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import { eventHandlersWithClass } from "../utils";

// Visual list geometry. Keep indent steps and marker column aligned to the
// source prefix width; caret boundary tuning happens on the inner source mark.
const LIST_UNIT_CH = 3;
const LIST_INDENT_SPACES = 2;

// Cap on how far `findPrevListItemIndent` walks backward looking for a
// parent. List nesting in practice is shallow; this avoids O(n) on giant
// docs with no blank-line breaks between items.
const PREV_LIST_LOOKBACK = 256;

// Measurable source-backed rendering of bullet/task prefixes. The full source
// prefix (leading whitespace + `- ` or `- [ ] `) remains in normal inline flow
// as a fixed-width mark. CSS hides the source text and draws the visible marker
// on the same span, so hit-testing and drawn selection geometry see stable text
// boxes rather than collapsed prefix spans plus widget tiles.
const listPrefixDecoration = (depth: number, kind: "bullet" | "task", checked = false) => {
  const prefixCh = (depth + 1) * LIST_UNIT_CH;
  const markerOffsetCh = depth * LIST_UNIT_CH;
  const classes = ["cm-list-prefix", `cm-list-prefix-${kind}`];
  if (checked) classes.push("cm-list-prefix-task-checked");
  return Decoration.mark({
    class: classes.join(" "),
    attributes: {
      style: [
        `width: ${prefixCh.toString()}ch`,
        `--cm-list-marker-offset: ${markerOffsetCh.toString()}ch`,
        `--cm-list-marker-width: ${LIST_UNIT_CH.toString()}ch`,
      ].join("; "),
    },
  });
};

const listIndentVisualDecoration = (depth: number) =>
  Decoration.mark({
    class: "cm-list-indent-visual",
    attributes: { style: `width: ${(depth * LIST_UNIT_CH).toString()}ch` },
  });

// Internal marker decoration (no visible class) — used purely to populate
// marker / atomic range sets. Rendering and interaction decisions are handled
// separately from these tracking ranges.
const listPrefixMarkerDecoration = Decoration.mark({});

// Wraps the body text of a list item (everything after the prefix through
// end of line) in a `<span class="cm-list-body">`, so consumers can style
// body content distinctly from the marker.
const listBodyDecoration = Decoration.mark({ class: "cm-list-body" });

const isBulletMarkChar = (ch: string): boolean => ch === "-" || ch === "+" || ch === "*";

// Ordered-list markers per CommonMark: a run of digits followed by `.` or `)`.
const ORDERED_MARKER_RE = /^\d+[.)]$/;
const isOrderedMarkText = (s: string): boolean => ORDERED_MARKER_RE.test(s);

// Line-level hanging indent applied to ordered-list lines: the marker hangs
// in the left gutter and wrapped continuation aligns with the body column.
// Ordered markers stay as source text (the digits matter), but the marker span
// has a minimum width so one- and two-digit numbers share the same visual
// column while longer markers can still grow.
const orderedLineDecoration = Decoration.line({
  attributes: {
    style: `padding-inline-start: ${LIST_UNIT_CH.toString()}ch; text-indent: -3.4ch;`,
  },
});
const orderedMarkerDecoration = Decoration.mark({
  class: "cm-list-ordered-marker",
  attributes: { style: `min-width: ${LIST_UNIT_CH.toString()}ch;` },
});

// A list marker is followed by a space OR tab per CommonMark; accept both
// in the trailing-char gates so tab-separated markers render.
const isMarkerTrailingChar = (ch: string): boolean => ch === " " || ch === "\t";

interface ParsedBulletTaskLine {
  lineFrom: number;
  markerFrom: number;
  bodyFrom: number;
  indentLen: number;
  markerLen: number;
  isTask: boolean;
}

// The one grammar for a bullet/task source prefix: indent, marker, one space
// or tab (CommonMark allows either; the decoration builder accepts both via
// `isMarkerTrailingChar`, so the commands must too), optional task box.
// Ordered lists keep their native CodeMirror/markdown behavior. Every command,
// the caret guard, and the checkbox toggle go through `parseBulletTaskLine`;
// don't add a second regex for "is this a list line".
const BULLET_TASK_LINE_RE = /^([ \t]*)[-+*][ \t](\[[ xX]\][ \t])?/;

function parseBulletTaskLine(line: { from: number; text: string }): ParsedBulletTaskLine | null {
  const match = BULLET_TASK_LINE_RE.exec(line.text);
  if (!match) return null;
  const indentLen = match[1]?.length ?? 0;
  const markerLen = match[0].length - indentLen;
  return {
    lineFrom: line.from,
    markerFrom: line.from + indentLen,
    bodyFrom: line.from + match[0].length,
    indentLen,
    markerLen,
    isTask: match[2] !== undefined,
  };
}

// Offset of the checkbox's inner char (` ` / `x`) from the marker: `- [x]`.
const TASK_INNER_OFFSET = 3;

interface ListDecorations {
  /** Marker + spacers + body wraps + per-line hanging-indent. Drives
   *  rendering. */
  all: DecorationSet;
  /** Drives atomic cursor motion — every source prefix/indent step skips as a
   *  unit. */
  atomic: DecorationSet;
  /** Bullet + task marker ranges only. */
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

      // Ordered-list markers (`1.`, `2)`): keep the marker as source text
      // (no widget), but fix its visual column before applying the line's
      // hanging indent. We intentionally skip spacers to keep ordered
      // rendering minimal.
      const markText = state.doc.sliceString(node.from, node.to);
      if (isOrderedMarkText(markText)) {
        const line = state.doc.lineAt(node.from);
        const prefixEnd = node.to + 1;
        allRanges.push(orderedMarkerDecoration.range(node.from, node.to));
        if (prefixEnd < line.to) {
          allRanges.push(listBodyDecoration.range(prefixEnd, line.to));
        }
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

      // Indent-step atomic markers — one zero-DOM mark per nesting level,
      // tracking the source char ranges so arrow keys and Backspace treat
      // each indent step as a unit (Backspace removes the whole step's
      // chars via `listBackspace`'s `decos.atomic` lookup). Previously
      // rendered as `IndentSpacerWidget` Decoration.replace tiles, but
      // those caused `posAtCoords` to snap body-text hit-tests to their
      // widgetTo boundary — switched to mark-only tracking + line padding
      // for the visual indent.
      const line = state.doc.lineAt(node.from);
      const leadingFrom = line.from;
      const leadingTo = node.from;
      const leadingLen = leadingTo - leadingFrom;
      if (depth >= 1 && leadingLen >= depth) {
        allRanges.push(listIndentVisualDecoration(depth).range(leadingFrom, leadingTo));
        const step = Math.floor(leadingLen / depth);
        for (let i = 0; i < depth; i++) {
          const subFrom = leadingFrom + i * step;
          const subTo = i === depth - 1 ? leadingTo : leadingFrom + (i + 1) * step;
          if (subTo <= subFrom) break;
          atomicRanges.push(listPrefixMarkerDecoration.range(subFrom, subTo));
        }
      }

      // Task vs plain bullet: both render one measurable source-backed prefix
      // mark over the full source prefix. Avoid widgets here: horizontal drag
      // selection should hit normal inline boxes, not widget boundaries.
      const cursor = node.node.cursor();
      let prefixEnd = -1;
      let prefixKind: "bullet" | "task" = "bullet";
      let checked = false;
      if (cursor.nextSibling() && cursor.name === "Task") {
        const taskCursor = cursor.node.cursor();
        if (
          taskCursor.firstChild() &&
          taskCursor.name === "TaskMarker" &&
          isMarkerTrailingChar(state.doc.sliceString(taskCursor.to, taskCursor.to + 1))
        ) {
          checked =
            state.doc.sliceString(taskCursor.from + 1, taskCursor.to - 1).toLowerCase() === "x";
          prefixEnd = taskCursor.to + 1;
          prefixKind = "task";
        }
      }
      if (prefixEnd < 0) {
        prefixEnd = node.to + 1;
      }
      allRanges.push(listPrefixDecoration(depth, prefixKind, checked).range(line.from, prefixEnd));
      markerRanges.push(listPrefixMarkerDecoration.range(node.from, prefixEnd));
      atomicRanges.push(listPrefixMarkerDecoration.range(node.from, prefixEnd));

      // Wrap the body text (everything after the prefix through end of
      // line) so consumers can style it via `.cm-list-body`. Skipped when
      // the item is empty (no body content).
      if (prefixEnd < line.to) {
        allRanges.push(listBodyDecoration.range(prefixEnd, line.to));
      }

      // Hanging-indent on every list line: pad the line by the rendered
      // prefix width and pull the first visual line back by the same amount.
      // The prefix mark occupies that pulled-back slot, while wrapped
      // continuation lines keep the padding so body text stays aligned.
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
    if (prev.text.trim() === "") return -1;
    const parsed = parseBulletTaskLine(prev);
    if (parsed && predicate(parsed.indentLen)) return parsed.indentLen;
  }
  return -1;
};

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

function parseBulletTaskLineAt(state: EditorState, pos: number): ParsedBulletTaskLine | null {
  return parseBulletTaskLine(state.doc.lineAt(pos));
}

// The bullet/task list line containing `pos`, or null. Combines the prefix
// grammar with the syntax tree so a `- item` line inside a fenced code block
// or HTML block (which the regex alone would accept) is not treated as a list:
// otherwise the caret guard clamps carets and Backspace eats "- " there.
function listLineAt(state: EditorState, pos: number): ParsedBulletTaskLine | null {
  const parsed = parseBulletTaskLineAt(state, pos);
  if (!parsed) return null;
  return isOnListLine(state, pos) ? parsed : null;
}

function clampCollapsedListPrefixRange(state: EditorState, range: SelectionRange): SelectionRange {
  if (!range.empty) return range;
  const parsed = listLineAt(state, range.head);
  if (!parsed) return range;

  let pos = range.head;
  if (pos > parsed.lineFrom && pos < parsed.markerFrom) {
    pos = parsed.markerFrom;
  } else if (pos > parsed.markerFrom && pos < parsed.bodyFrom) {
    pos = parsed.bodyFrom;
  } else {
    return range;
  }
  return EditorSelection.cursor(pos);
}

const listPrefixSelectionGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  let changed = false;
  const ranges = tr.newSelection.ranges.map((range) => {
    const clamped = clampCollapsedListPrefixRange(tr.state, range);
    if (clamped !== range) changed = true;
    return clamped;
  });
  if (!changed) return tr;
  return [tr, { selection: EditorSelection.create(ranges, tr.newSelection.mainIndex) }];
});

function selectedLineNumbers(state: EditorState): number[] {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const endPos = range.empty ? range.to : Math.max(range.from, range.to - 1);
    const toLine = state.doc.lineAt(endPos);
    for (let line = fromLine.number; line <= toLine.number; line++) {
      numbers.add(line);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

const listIndentSelection: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  let sawListLine = false;

  for (const lineNumber of selectedLineNumbers(state)) {
    const line = state.doc.line(lineNumber);
    const parsed = listLineAt(state, line.from);
    if (!parsed) continue;
    sawListLine = true;

    const prevIndent = findPrevListItemIndent(
      state,
      line.number,
      (indent) => indent <= parsed.indentLen,
    );
    if (prevIndent < 0) continue;

    const targetIndent = prevIndent + LIST_INDENT_SPACES;
    if (parsed.indentLen >= targetIndent) continue;

    changes.push({ from: line.from, insert: " ".repeat(targetIndent - parsed.indentLen) });
  }

  if (!sawListLine) return false;
  if (changes.length > 0) {
    dispatch(state.update({ changes, userEvent: "input.indent" }));
  }
  return true;
};

const listOutdentSelection: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  let sawListLine = false;

  for (const lineNumber of selectedLineNumbers(state)) {
    const line = state.doc.line(lineNumber);
    const parsed = listLineAt(state, line.from);
    if (!parsed) continue;
    sawListLine = true;
    if (parsed.indentLen === 0) continue;

    const removeLen = Math.min(LIST_INDENT_SPACES, parsed.indentLen);
    changes.push({ from: line.from, to: line.from + removeLen });
  }

  if (!sawListLine) return false;
  if (changes.length > 0) {
    dispatch(state.update({ changes, userEvent: "delete.outdent" }));
  }
  return true;
};

function listPrefixBoundaryMove(state: EditorState, direction: "left" | "right"): number | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const parsed = listLineAt(state, sel.head);
  if (!parsed) return null;
  if (direction === "left") {
    if (sel.head === parsed.bodyFrom) return parsed.markerFrom;
    if (parsed.markerFrom > parsed.lineFrom && sel.head === parsed.markerFrom) {
      return parsed.lineFrom;
    }
  } else {
    if (sel.head === parsed.lineFrom) {
      return parsed.markerFrom > parsed.lineFrom ? parsed.markerFrom : parsed.bodyFrom;
    }
    if (parsed.markerFrom > parsed.lineFrom && sel.head === parsed.markerFrom) {
      return parsed.bodyFrom;
    }
  }
  return null;
}

function markerColumnWidthPx(target: HTMLElement): number {
  const style = getComputedStyle(target);
  const raw = style.getPropertyValue("--cm-list-marker-width").trim();
  if (!raw.endsWith("ch")) return 0;
  const ch = Number(raw.slice(0, -2));
  if (!Number.isFinite(ch) || ch <= 0) return 0;

  const probe = document.createElement("span");
  probe.textContent = "0";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.font = style.font;
  target.appendChild(probe);
  const chWidth = probe.getBoundingClientRect().width;
  probe.remove();
  return ch * chWidth;
}

function listPrefixClickPosition(view: EditorView, event: MouseEvent): number | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return null;
  const prefix = target.closest<HTMLElement>(".cm-list-prefix");
  if (!prefix) return null;

  const pos = view.posAtDOM(prefix);
  const parsed = parseBulletTaskLineAt(view.state, pos);
  if (!parsed) return null;

  const rect = prefix.getBoundingClientRect();
  if (rect.width <= 0) return parsed.bodyFrom;

  const markerWidth = markerColumnWidthPx(prefix) || rect.width;
  const markerStartX = Math.max(rect.left, rect.right - markerWidth);
  const x = event.clientX;

  if (x < markerStartX) {
    return x - rect.left < markerStartX - x ? parsed.lineFrom : parsed.markerFrom;
  }
  return x - markerStartX < rect.right - x ? parsed.markerFrom : parsed.bodyFrom;
}

const listPrefixMouseHandler = Prec.highest(
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const pos = listPrefixClickPosition(view, event);
      if (pos === null) return false;
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, userEvent: "select" });
      view.focus();
      return true;
    },
  }),
);

const listPrefixArrowKeymap = Prec.highest(
  keymap.of([
    {
      key: "ArrowLeft",
      run: (view) => {
        const pos = listPrefixBoundaryMove(view.state, "left");
        if (pos === null) return false;
        view.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
          userEvent: "select",
        });
        return true;
      },
    },
    {
      key: "ArrowRight",
      run: (view) => {
        const pos = listPrefixBoundaryMove(view.state, "right");
        if (pos === null) return false;
        view.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
          userEvent: "select",
        });
        return true;
      },
    },
    {
      key: "Shift-ArrowLeft",
      run: (view) => {
        const pos = listPrefixBoundaryMove(view.state, "left");
        if (pos === null) return false;
        const sel = view.state.selection.main;
        view.dispatch({
          selection: EditorSelection.range(sel.anchor, pos),
          scrollIntoView: true,
          userEvent: "select.extend",
        });
        return true;
      },
    },
    {
      key: "Shift-ArrowRight",
      run: (view) => {
        const pos = listPrefixBoundaryMove(view.state, "right");
        if (pos === null) return false;
        const sel = view.state.selection.main;
        view.dispatch({
          selection: EditorSelection.range(sel.anchor, pos),
          scrollIntoView: true,
          userEvent: "select.extend",
        });
        return true;
      },
    },
  ]),
);

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
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return listIndentSelection({ state, dispatch });
  }
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  // Ordered-list lines: nothing to nest, but still consume Tab (see above).
  const parsed = parseBulletTaskLine(line);
  if (!parsed) return true;
  const currentIndent = parsed.indentLen;

  const prevIndent = findPrevListItemIndent(state, line.number, (i) => i <= currentIndent);
  if (prevIndent < 0) return true;
  const targetIndent = prevIndent + LIST_INDENT_SPACES;
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
// a strictly shallower indent — i.e. step up one nesting level.
const listOutdent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return listOutdentSelection({ state, dispatch });
  }
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  const parsed = parseBulletTaskLine(line);
  if (!parsed) return true;
  const currentIndent = parsed.indentLen;
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

const listEnter: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  // Multi-cursor / non-empty selection: fall through to default Enter
  // (insert newline) — list-aware splitting on multi-line selections is
  // out of scope for now.
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const sel = state.selection.main;
  // Ordered lists and blockquotes fall through to lang-markdown's own
  // continuation.
  const parsed = listLineAt(state, sel.head);
  if (!parsed) return false;

  const line = state.doc.lineAt(sel.head);

  // Empty list item → wipe and break out of the list.
  if (parsed.bodyFrom === line.to) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to },
        selection: { anchor: line.from },
        userEvent: "delete.empty-list-marker",
      }),
    );
    return true;
  }

  // Smart continuation: mirror the line's `<indent><marker><sep>` (with
  // `[ ]<sep>` for tasks, always unchecked) onto the new line so a new item
  // exists immediately after the marker, as soon as the user hits Enter.
  // Defer to the default Enter when the cursor sits before the prefix's end —
  // splitting before the marker shouldn't duplicate it.
  if (sel.head < parsed.bodyFrom) return false;

  const indent = line.text.slice(0, parsed.indentLen);
  const marker = line.text[parsed.indentLen];
  const sep = line.text[parsed.indentLen + 1];
  const continuation = parsed.isTask
    ? `${indent}${marker}${sep}[ ]${sep}`
    : `${indent}${marker}${sep}`;
  dispatch(
    state.update({
      changes: { from: sel.head, insert: `\n${continuation}` },
      selection: { anchor: sel.head + 1 + continuation.length },
      userEvent: "input.list-continue",
    }),
  );
  return true;
};

const listBackspace: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const head = range.head;
  const parsed = listLineAt(state, head);
  if (!parsed) return false;

  let effectiveHead = head;
  if (head > parsed.lineFrom && head < parsed.markerFrom) {
    effectiveHead = parsed.markerFrom;
  } else if (head > parsed.markerFrom && head < parsed.bodyFrom) {
    effectiveHead = parsed.bodyFrom;
  }

  if (effectiveHead === parsed.lineFrom) return false;

  if (effectiveHead === parsed.markerFrom) {
    if (parsed.indentLen === 0) return false;
    const from = parsed.markerFrom - Math.min(LIST_INDENT_SPACES, parsed.indentLen);
    dispatch(
      state.update({
        changes: { from, to: parsed.markerFrom },
        selection: { anchor: from },
        userEvent: "delete.list",
      }),
    );
    return true;
  }

  if (effectiveHead === parsed.bodyFrom) {
    const from =
      parsed.indentLen > 0
        ? parsed.markerFrom - Math.min(LIST_INDENT_SPACES, parsed.indentLen)
        : parsed.markerFrom;
    dispatch(
      state.update({
        changes: { from, to: parsed.bodyFrom },
        selection: { anchor: from },
        userEvent: "delete.list",
      }),
    );
    return true;
  }

  return false;
};

// Click-toggle for the checkbox prefix. Keep this on `click`, not `mousedown`:
// mousedown is CodeMirror's drag-selection start gesture, and consuming it makes
// TODO lines feel broken when the user drags across the checkbox. A drag won't
// fire click, so selection and toggle stay distinct.
export const computeCheckboxToggle = (
  state: EditorState,
  widgetStartPos: number,
): TransactionSpec | null => {
  const parsed = parseBulletTaskLineAt(state, widgetStartPos);
  if (!parsed || !parsed.isTask || parsed.markerFrom !== widgetStartPos) return null;
  const innerCharPos = parsed.markerFrom + TASK_INNER_OFFSET;
  const currentlyChecked =
    state.doc.sliceString(innerCharPos, innerCharPos + 1).toLowerCase() === "x";
  return {
    changes: {
      from: innerCharPos,
      to: innerCharPos + 1,
      insert: currentlyChecked ? " " : "x",
    },
    userEvent: "input.toggle-checkbox",
  };
};

const computeCheckboxToggleFromLine = (state: EditorState, pos: number): TransactionSpec | null => {
  const parsed = parseBulletTaskLineAt(state, pos);
  if (!parsed || !parsed.isTask) return null;
  return computeCheckboxToggle(state, parsed.markerFrom);
};

const checkboxClickHandler = EditorView.domEventHandlers(
  eventHandlersWithClass({
    click: {
      "cm-list-prefix-task": (ev, view) => {
        const pos = view.posAtDOM(ev.target as HTMLElement);
        const spec =
          computeCheckboxToggleFromLine(view.state, pos) ?? computeCheckboxToggle(view.state, pos);
        if (!spec) return false;
        view.dispatch(spec);
        return true; // prevent default
      },
    },
  }),
);

export const listExtension: Extension = [
  listDecorationsField,
  listPrefixSelectionGuard,
  listPrefixMouseHandler,
  listPrefixArrowKeymap,
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
  LIST_UNIT_CH,
  listDecorationsField,
};
