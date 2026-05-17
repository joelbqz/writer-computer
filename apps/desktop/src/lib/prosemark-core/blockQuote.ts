import { syntaxTree } from "@codemirror/language";
import { RangeSet, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

class NestedBlockQuoteBorder extends WidgetType {
  constructor(public offset: number) {
    super();
  }

  eq(other: NestedBlockQuoteBorder): boolean {
    return this.offset === other.offset;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-nested-blockquote-border";
    span.style = `--blockquote-border-offset: ${this.offset.toString()}px`;
    return span;
  }

  ignoreEvent(_event: Event) {
    return false;
  }
}

interface MeasureData {
  lineFroms: number[];
  nestedBorders: { pos: number; offset: number }[];
}

function measureBlockQuotes(view: EditorView): MeasureData {
  const lineFroms: number[] = [];
  const nestedBorders: { pos: number; offset: number }[] = [];

  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.type.name != "Blockquote") return;

      // Add a line decoration for each line in the blockquote
      const startLine = view.state.doc.lineAt(node.from).number;
      const endLine = view.state.doc.lineAt(node.to).number;
      for (let i = startLine; i <= endLine; i++) {
        const line = view.state.doc.line(i);
        lineFroms.push(line.from);
      }

      // Find any nested blockquotes and measure their visual offset
      const cursor = node.node.cursor();
      cursor.iterate((child) => {
        if (child.type.name !== "QuoteMark") return;
        const line = view.state.doc.lineAt(child.from);
        if (child.from == line.from) return;
        const offset =
          (view.coordsAtPos(child.from)?.left ?? 0) - (view.coordsAtPos(line.from)?.left ?? 0);

        nestedBorders.push({ pos: child.from, offset });
      });

      return false;
    },
  });

  return { lineFroms, nestedBorders };
}

function buildDecorationsFromMeasure(_view: EditorView, data: MeasureData) {
  const decos: Range<Decoration>[] = [];

  for (const from of data.lineFroms) {
    decos.push(Decoration.line({ attributes: { class: "cm-blockquote-line" } }).range(from));
  }

  for (const { pos, offset } of data.nestedBorders) {
    decos.push(
      Decoration.widget({
        widget: new NestedBlockQuoteBorder(offset),
      }).range(pos),
    );
  }

  return RangeSet.of(decos, true);
}

export const blockQuoteExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;

    constructor(view: EditorView) {
      this.requestMeasure(view);
    }

    update(u: ViewUpdate) {
      if (u.docChanged) {
        this.decorations = this.decorations.map(u.changes);
      }

      if (u.docChanged || u.viewportChanged) {
        this.requestMeasure(u.view);
      }
    }

    requestMeasure(view: EditorView) {
      // Measuring (coordsAtPos) must be done through requestMeasure
      view.requestMeasure({
        read: (v) => measureBlockQuotes(v),
        write: (data, v) => {
          this.applyMeasure(data, v);
        },
      });
    }

    applyMeasure(data: MeasureData, view: EditorView) {
      const newDecos = buildDecorationsFromMeasure(view, data);
      this.decorations = newDecos;
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
