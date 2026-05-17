import { EditorView, keymap } from "@codemirror/view";
import { foldExtension } from "./fold";
import { EditorSelection } from "@codemirror/state";
import { decorationHasReplaceWidget } from "./utils";

/**
 * When the caret sits immediately outside a block-replace *widget*, jump
 * inside so the hidden source can be edited. (Hide-only `Decoration.replace`
 * ranges are ignored — they share spans with visible text and would steal
 * arrow keys from neighboring lines.)
 */
const maybeRevealAtWidgetBoundary = (view: EditorView, direction: "up" | "down"): boolean => {
  const decorations = view.state.field(foldExtension);
  const cursorAt = view.state.selection.main.head;

  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
  for (let iter = decorations.iter(); iter.value; iter.next()) {
    if (!decorationHasReplaceWidget(iter.value)) continue;
    if (direction === "down" && cursorAt == iter.from - 1) {
      view.dispatch({
        selection: EditorSelection.single(iter.from),
      });
      return true;
    }
    if (direction === "up" && cursorAt == iter.to + 1) {
      view.dispatch({
        selection: EditorSelection.single(iter.to),
      });
      return true;
    }
  }

  return false;
};

const revealWidgetOnAdjacentLine = (view: EditorView, direction: "up" | "down"): number | null => {
  const decorations = view.state.field(foldExtension);
  const cursorAt = view.state.selection.main.head;
  const line = view.state.doc.lineAt(cursorAt);
  const docText = view.state.doc;
  let candidate: number | null = null;

  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
  for (let iter = decorations.iter(); iter.value; iter.next()) {
    if (!decorationHasReplaceWidget(iter.value)) continue;
    const spec = iter.value.spec as {
      proseMarkSkipAdjacentArrowReveal?: boolean;
    };
    if (spec.proseMarkSkipAdjacentArrowReveal) continue;

    if (
      direction === "up" &&
      iter.to < line.from &&
      /^[\t \n\r]+$/.test(docText.sliceString(iter.to, line.from))
    ) {
      candidate = candidate == null || iter.to > candidate ? iter.to : candidate;
      continue;
    }

    if (
      direction === "down" &&
      iter.from > line.to &&
      /^[\t \n\r]+$/.test(docText.sliceString(line.to, iter.from))
    ) {
      candidate = candidate == null || iter.from < candidate ? iter.from : candidate;
    }
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
