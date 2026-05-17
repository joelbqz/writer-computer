import { Annotation, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  type DecorationSet,
} from "@codemirror/view";

interface IndentData {
  lineNumber: number;
  indentWidth: number;
}

const softIndentPattern = /^(> )*(\s*)?(([-*+]?|\d[.)])\s)?(\[.\]\s)?/;

const softIndentRefresh = Annotation.define<number>();
const MAX_REFRESH_ROUNDS = 1;

interface ChangedLine {
  lineNumber: number;
  lineText: string;
  oldStyle?: string;
  newStyle?: string;
}

function getDifferences(
  view: EditorView,
  oldStyles: Map<number, string>,
  newStyles: Map<number, string>,
): ChangedLine[] {
  const changedLines: ChangedLine[] = [];

  // Compare decorations line by line
  for (const { from, to } of view.visibleRanges) {
    const start = view.state.doc.lineAt(from);
    const end = view.state.doc.lineAt(to);
    for (let i = start.number; i <= end.number; i++) {
      const line = view.state.doc.line(i);
      const oldStyle = oldStyles.get(i);
      const newStyle = newStyles.get(i);

      if (oldStyle !== newStyle) {
        const lineText = view.state.sliceDoc(line.from, line.to);
        changedLines.push({
          lineNumber: i,
          lineText,
          ...(oldStyle !== undefined && { oldStyle }),
          ...(newStyle !== undefined && { newStyle }),
        });
      }
    }
  }

  return changedLines;
}

export const softIndentExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    lineStyles = new Map<number, string>();

    constructor(view: EditorView) {
      this.requestMeasure(view);
    }

    update(u: ViewUpdate) {
      if (u.docChanged) {
        this.decorations = this.decorations.map(u.changes);
      }

      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.requestMeasure(u.view, 0);
      }

      const refreshCount = u.transactions
        .find((tr) => tr.annotation(softIndentRefresh) !== undefined)
        ?.annotation(softIndentRefresh);
      if (refreshCount !== undefined) {
        this.requestMeasure(u.view, refreshCount);
      }
    }

    requestMeasure(view: EditorView, refreshCount = 0) {
      // Needs to run via requestMeasure since it measures and updates the DOM
      view.requestMeasure({
        read: (view) => this.measureIndents(view),
        write: (indents, view) => {
          this.applyIndents(indents, view, refreshCount);
        },
      });
    }

    // Use view.coordAtPos to measure the indent required
    measureIndents(view: EditorView): IndentData[] {
      const indents: IndentData[] = [];
      // Loop through all visible lines
      for (const { from, to } of view.visibleRanges) {
        const start = view.state.doc.lineAt(from);
        const end = view.state.doc.lineAt(to);
        for (let i = start.number; i <= end.number; i++) {
          // Get current line object
          const line = view.state.doc.line(i);

          // Match the line's text with the indent pattern
          const text = view.state.sliceDoc(line.from, line.to);
          const matches = softIndentPattern.exec(text);
          if (!matches) continue;
          const nonContent = matches[0];

          // Get indent width
          const indentWidth =
            (view.coordsAtPos(line.from + nonContent.length)?.left ?? 0) -
            (view.coordsAtPos(line.from)?.left ?? 0);
          if (!indentWidth) continue;

          indents.push({
            lineNumber: i,
            indentWidth,
          });
        }
      }
      return indents;
    }

    buildDecorations(indents: IndentData[], view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      const styles = new Map<number, string>();

      for (const { lineNumber, indentWidth } of indents) {
        const line = view.state.doc.line(lineNumber);
        const style = `padding-inline-start: ${(indentWidth + 6).toString()}px; text-indent: -${indentWidth.toString()}px;`;
        styles.set(lineNumber, style);

        const deco = Decoration.line({
          attributes: {
            style,
          },
        });

        builder.add(line.from, line.from, deco);
      }

      return { decorations: builder.finish(), styles };
    }

    // This applies new decorations and will dispatch another transaction
    // until the dom layout settles
    applyIndents(indents: IndentData[], view: EditorView, refreshCount = 0) {
      const { decorations: newDecos, styles: newStyles } = this.buildDecorations(indents, view);
      const changedLines = getDifferences(view, this.lineStyles, newStyles);

      if (changedLines.length > 0) {
        if (refreshCount < MAX_REFRESH_ROUNDS) {
          queueMicrotask(() => {
            view.dispatch({
              annotations: [softIndentRefresh.of(refreshCount + 1)],
            });
          });
        } else {
          const roundNumber = String(refreshCount);
          console.warn(
            `Soft indent: indents still changing after ${roundNumber} refresh rounds. Affected lines:`,
            changedLines,
          );
        }
      }
      this.decorations = newDecos;
      this.lineStyles = newStyles;
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
