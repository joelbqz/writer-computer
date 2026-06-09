import { Decoration, WidgetType } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { normalizeMarkdownDestination } from "@/lib/paths";
import { foldableSyntaxFacet, selectAllDecorationsOnSelectExtension } from "./core";
import { iterChildren } from "../utils";

/* Without `estimatedHeight`, CodeMirror heightmaps an unmeasured image
   widget at ~0, so the document height jumps once when the widget first
   renders and again when the async <img> finishes loading (see
   SPECs/scrollbar-stability-spec.md). Remember the rendered height per
   URL so later encounters estimate exactly; unseen images use a fixed
   default. Keyed by the markdown destination, so two docs referencing the
   same relative path share an entry — close enough for an estimate, and
   the real measure corrects any collision. */
const DEFAULT_IMAGE_HEIGHT_PX = 200;
const IMAGE_HEIGHT_CACHE_MAX = 500;
const imageHeightCache = new Map<string, number>();

function recordImageHeight(url: string, height: number) {
  if (height <= 0) return;
  if (!imageHeightCache.has(url) && imageHeightCache.size >= IMAGE_HEIGHT_CACHE_MAX) {
    const oldest = imageHeightCache.keys().next().value;
    if (oldest !== undefined) imageHeightCache.delete(oldest);
  }
  imageHeightCache.set(url, height);
}

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

  get estimatedHeight(): number {
    return imageHeightCache.get(this.url) ?? DEFAULT_IMAGE_HEIGHT_PX;
  }

  toDOM(view: EditorView) {
    const elem = document.createElement(this.block ? "div" : "span");
    elem.className = "cm-image";
    if (this.block) {
      elem.className += " cm-image-block";
    }
    const image = document.createElement("img");
    image.src = this.url;
    image.addEventListener("load", () => {
      recordImageHeight(this.url, elem.getBoundingClientRect().height);
      // CodeMirror doesn't observe async <img> growth; request a measure
      // pass so the height correction lands now, not on the next scroll.
      view.requestMeasure();
    });
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

export const __testImageWidget = {
  imageHeightCache,
  recordImageHeight,
  DEFAULT_IMAGE_HEIGHT_PX,
  IMAGE_HEIGHT_CACHE_MAX,
};
