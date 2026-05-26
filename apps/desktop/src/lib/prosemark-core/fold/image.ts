import { Decoration, WidgetType } from "@codemirror/view";
import { normalizeMarkdownDestination } from "@/lib/paths";
import { foldableSyntaxFacet, selectAllDecorationsOnSelectExtension } from "./core";
import { iterChildren } from "../utils";

class ImageWidget extends WidgetType {
  constructor(
    public url: string,
    public block?: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return this.url === other.url && this.block === other.block;
  }

  toDOM() {
    const elem = document.createElement(this.block ? "div" : "span");
    elem.className = "cm-image";
    if (this.block) {
      elem.className += " cm-image-block";
    }
    const image = document.createElement("img");
    image.src = this.url;
    elem.appendChild(image);
    return elem;
  }

  // allows clicks to pass through to the editor
  ignoreEvent(_event: Event) {
    return false;
  }
}

export const imageExtension = [
  foldableSyntaxFacet.of({
    nodePath: "Image",
    keepDecorationOnUnfold: true,
    buildDecorations: (state, node, selectionTouchesRange) => {
      let imageUrl: string | undefined;
      iterChildren(node.node.cursor(), (node) => {
        if (node.name === "URL") {
          imageUrl = normalizeMarkdownDestination(state.doc.sliceString(node.from, node.to));
        }

        return undefined;
      });

      if (imageUrl) {
        const line = state.doc.lineAt(node.from);
        const block = node.from == line.from && node.to == line.to;
        const widget = new ImageWidget(imageUrl, block);

        if (selectionTouchesRange) {
          return Decoration.widget({
            widget,
            block,
          }).range(node.to, node.to);
        } else {
          return Decoration.replace({
            widget,
            block,
          }).range(node.from, node.to);
        }
      }
    },
  }),
  selectAllDecorationsOnSelectExtension("cm-image"),
];
