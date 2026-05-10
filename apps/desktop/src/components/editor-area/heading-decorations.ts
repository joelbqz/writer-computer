import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

const ATX_HEADING_RE = /^ATXHeading([1-6])$/;

const hashMark = Decoration.mark({ class: "cm-heading-hash" });

const lineDecos: Record<number, Decoration> = {};
for (let level = 1; level <= 6; level++) {
  lineDecos[level] = Decoration.line({
    attributes: { class: `cm-heading-line cm-heading-line-${level}` },
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const m = ATX_HEADING_RE.exec(node.name);
        if (!m) return undefined;

        const level = Number(m[1]);
        const lineFrom = view.state.doc.lineAt(node.from).from;
        decos.push({ from: lineFrom, to: lineFrom, deco: lineDecos[level]! });

        const cursor = node.node.cursor();
        if (cursor.firstChild() && cursor.name === "HeaderMark") {
          // Match prosemark's default hide range so the resulting span carries
          // both `.cm-hidden-token` and `.cm-heading-hash` and CodeMirror merges
          // them into a single element. Covers hash chars + the trailing space
          // so heading text starts at line-start in both modes.
          const hashFrom = cursor.from;
          const hashEnd = Math.min(cursor.to + 1, node.to);
          decos.push({ from: hashFrom, to: hashEnd, deco: hashMark });
        }
        return false;
      },
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    decos.map(({ from, to, deco }) => deco.range(from, to)),
    true,
  );
}

export const headingDecorations: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
