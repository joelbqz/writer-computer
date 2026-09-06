import { EditorView, keymap } from "@codemirror/view";
import { foldExtension } from "./fold";
import { EditorSelection, type Text } from "@codemirror/state";
import { decorationHasReplaceWidget } from "./utils";

const isBlankLine = (text: string) => /^[\t ]*$/.test(text);

// Start of the whitespace run (trailing blanks on the previous non-blank line
// plus any blank lines) that ends at `pos`, which must be a line start.
function whitespaceRunStart(doc: Text, pos: number): number {
  let line = doc.lineAt(pos);
  while (line.number > 1) {
    const prev = doc.line(line.number - 1);
    if (!isBlankLine(prev.text)) {
      const trailing = /[\t ]*$/.exec(prev.text)?.[0].length ?? 0;
      return prev.to - trailing;
    }
    line = prev;
  }
  return line.from;
}

// End of the whitespace run (blank lines plus leading blanks on the next
// non-blank line) that starts at `pos`, which must be a line end.
function whitespaceRunEnd(doc: Text, pos: number): number {
  let line = doc.lineAt(pos);
  while (line.number < doc.lines) {
    const next = doc.line(line.number + 1);
    if (!isBlankLine(next.text)) {
      const leading = /^[\t ]*/.exec(next.text)?.[0].length ?? 0;
      return next.from + leading;
    }
    line = next;
  }
  return line.to;
}

/**
 * When the caret sits immediately outside a block-replace *widget*, jump
 * inside so the hidden source can be edited. (Hide-only `Decoration.replace`
 * ranges are ignored — they share spans with visible text and would steal
 * arrow keys from neighboring lines.)
 */
const maybeRevealAtWidgetBoundary = (view: EditorView, direction: "up" | "down"): boolean => {
  const decorations = view.state.field(foldExtension);
  const cursorAt = view.state.selection.main.head;
  let target: number | null = null;

  decorations.between(cursorAt - 1, cursorAt + 1, (from, to, deco) => {
    if (!decorationHasReplaceWidget(deco)) return;
    if (direction === "down" && cursorAt == from - 1) target = from;
    if (direction === "up" && cursorAt == to + 1) target = to;
    if (target !== null) return false;
  });

  if (target === null) return false;
  view.dispatch({ selection: EditorSelection.single(target) });
  return true;
};

// Nearest replace-widget boundary separated from the caret's line by only
// whitespace, in `direction`. Scans just that whitespace window instead of
// every fold decoration in the document.
const revealWidgetOnAdjacentLine = (view: EditorView, direction: "up" | "down"): number | null => {
  const decorations = view.state.field(foldExtension);
  const doc = view.state.doc;
  const line = doc.lineAt(view.state.selection.main.head);
  let candidate: number | null = null;

  const consider = (
    from: number,
    to: number,
    deco: Parameters<typeof decorationHasReplaceWidget>[0],
  ) => {
    if (!decorationHasReplaceWidget(deco)) return;
    const spec = deco.spec as { proseMarkSkipAdjacentArrowReveal?: boolean };
    if (spec.proseMarkSkipAdjacentArrowReveal) return;
    if (direction === "up" && to < line.from) {
      candidate = candidate == null || to > candidate ? to : candidate;
    } else if (direction === "down" && from > line.to) {
      candidate = candidate == null || from < candidate ? from : candidate;
    }
  };

  if (direction === "up") {
    const windowStart = whitespaceRunStart(doc, line.from);
    if (windowStart === line.from) return null;
    decorations.between(windowStart, line.from, consider);
  } else {
    const windowEnd = whitespaceRunEnd(doc, line.to);
    if (windowEnd === line.to) return null;
    decorations.between(line.to, windowEnd, consider);
  }

  return candidate;
};

const arrowUp = (view: EditorView): boolean => {
  if (maybeRevealAtWidgetBoundary(view, "up")) return true;
  const adjacentWidgetBoundary = revealWidgetOnAdjacentLine(view, "up");
  if (adjacentWidgetBoundary == null) return false;
  view.dispatch({ selection: EditorSelection.single(adjacentWidgetBoundary) });
  return true;
};

const arrowDown = (view: EditorView): boolean => {
  if (maybeRevealAtWidgetBoundary(view, "down")) return true;
  const adjacentWidgetBoundary = revealWidgetOnAdjacentLine(view, "down");
  if (adjacentWidgetBoundary == null) return false;
  view.dispatch({ selection: EditorSelection.single(adjacentWidgetBoundary) });
  return true;
};

export const revealBlockOnArrowExtension = [
  keymap.of([
    { key: "ArrowUp", run: arrowUp },
    { key: "ArrowDown", run: arrowDown },
  ]),
];
