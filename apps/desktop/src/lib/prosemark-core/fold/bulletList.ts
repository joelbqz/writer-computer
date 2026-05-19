import { Decoration, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "./core";

class BulletPoint extends WidgetType {
  eq(other: BulletPoint): boolean {
    return other instanceof BulletPoint;
  }

  toDOM() {
    // The wrapper carries an invisible copy of the raw char (`-`) so its inline
    // width matches the raw text exactly. The dot is layered on top via
    // absolute positioning so the column doesn't shift when the caret toggles
    // between rendered and raw.
    const wrapper = document.createElement("span");
    wrapper.className = "cm-rendered-list-mark";

    const spacer = document.createElement("span");
    spacer.className = "cm-rendered-list-mark-spacer";
    spacer.textContent = "-";
    wrapper.appendChild(spacer);

    const dot = document.createElement("span");
    dot.className = "cm-rendered-list-mark-dot";
    dot.textContent = "•";
    wrapper.appendChild(dot);

    return wrapper;
  }

  ignoreEvent(_event: Event) {
    return false;
  }
}

export const bulletListExtension = foldableSyntaxFacet.of({
  nodePath: "BulletList/ListItem/ListMark",
  buildDecorations: (_state, node) => {
    const cursor = node.node.cursor();
    if (cursor.nextSibling() && cursor.name === "Task") return;

    return Decoration.replace({ widget: new BulletPoint() }).range(node.from, node.to);
  },
});
