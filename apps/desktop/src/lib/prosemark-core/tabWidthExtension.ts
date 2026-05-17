import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// Issue #96 ("Text Vibrating like crazy"):
// Native tab rendering can vary enough to throw off softIndentExtension's pixel
// measurements. Replacing each visible tab with a fixed-width widget keeps
// indentation width deterministic and prevents jitter.

const TAB_CHARACTER = "\t";
const TAB_WIDTH_CH = 4;

class FixedTabWidthWidget extends WidgetType {
  eq(other: FixedTabWidthWidget): boolean {
    return other instanceof FixedTabWidthWidget;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "cm-fixed-tab-width-widget";
    element.setAttribute("aria-hidden", "true");
    return element;
  }
}

const fixedTabDecoration = Decoration.replace({
  widget: new FixedTabWidthWidget(),
});

const buildTabWidthDecorations = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const visitedTabPositions = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    // Scan the whole visible range directly rather than iterating line-by-line.
    // Visible ranges can overlap, so dedupe by absolute tab position.
    const visibleText = view.state.doc.sliceString(from, to);
    let tabOffset = visibleText.indexOf(TAB_CHARACTER);
    while (tabOffset !== -1) {
      const tabPos = from + tabOffset;
      if (!visitedTabPositions.has(tabPos)) {
        builder.add(tabPos, tabPos + 1, fixedTabDecoration);
        visitedTabPositions.add(tabPos);
      }
      tabOffset = visibleText.indexOf(TAB_CHARACTER, tabOffset + 1);
    }
  }

  return builder.finish();
};

const fixedTabWidthDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildTabWidthDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildTabWidthDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);

const fixedTabWidthTheme = EditorView.baseTheme({
  ".cm-fixed-tab-width-widget": {
    display: "inline-block",
    width: `${TAB_WIDTH_CH.toString()}ch`,
    pointerEvents: "none",
  },
});

export const fixedTabWidthExtension: Extension = [fixedTabWidthDecorations, fixedTabWidthTheme];
