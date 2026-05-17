import { Decoration, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "./core";

class BulletPoint extends WidgetType {
  eq(other: BulletPoint): boolean {
    return other instanceof BulletPoint;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-rendered-list-mark";
    span.innerHTML = "•";
    return span;
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
