import { beforeEach, describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { foldExtension } from "../src/lib/prosemark-core/main";
import { imageExtension, __testImageWidget } from "../src/lib/prosemark-core/fold/image";

const { imageHeightCache, recordImageHeight, DEFAULT_IMAGE_HEIGHT_PX, IMAGE_HEIGHT_CACHE_MAX } =
  __testImageWidget;

const doc = "before\n\n![alt](./pic.png)\n\nafter";

type ImageFold = { from: number; to: number; url: string; estimatedHeight: number };

function makeState(content = doc): EditorState {
  let state = EditorState.create({
    doc: content,
    extensions: [markdown({ extensions: [GFM] }), imageExtension],
    selection: EditorSelection.single(0),
  });
  ensureSyntaxTree(state, content.length, 1000);
  state = state.update({ selection: state.selection }).state;
  return state;
}

function collectImageFolds(state: EditorState): ImageFold[] {
  const folds: ImageFold[] = [];
  state.field(foldExtension).between(0, state.doc.length, (from, to, decoration) => {
    const widget = (decoration.spec as { widget?: unknown }).widget as
      | { url?: unknown; estimatedHeight?: unknown }
      | undefined;
    if (typeof widget?.url !== "string") return;
    folds.push({
      from,
      to,
      url: widget.url,
      estimatedHeight: typeof widget.estimatedHeight === "number" ? widget.estimatedHeight : -1,
    });
  });
  return folds;
}

describe("image widget height estimates", () => {
  beforeEach(() => {
    imageHeightCache.clear();
  });

  test("unseen image uses the positive default estimate", () => {
    const folds = collectImageFolds(makeState());
    expect(folds).toHaveLength(1);
    expect(folds[0]!.estimatedHeight).toBe(DEFAULT_IMAGE_HEIGHT_PX);
  });

  test("cached rendered height wins over the default", () => {
    const [fold] = collectImageFolds(makeState());
    recordImageHeight(fold!.url, 333);
    const folds = collectImageFolds(makeState());
    expect(folds[0]!.estimatedHeight).toBe(333);
  });

  test("zero or negative heights are not recorded", () => {
    recordImageHeight("x.png", 0);
    recordImageHeight("y.png", -5);
    expect(imageHeightCache.size).toBe(0);
  });

  test("cache evicts oldest entry at capacity", () => {
    for (let i = 0; i < IMAGE_HEIGHT_CACHE_MAX; i++) {
      recordImageHeight(`img-${i}.png`, 100 + i);
    }
    expect(imageHeightCache.size).toBe(IMAGE_HEIGHT_CACHE_MAX);

    recordImageHeight("one-more.png", 42);
    expect(imageHeightCache.size).toBe(IMAGE_HEIGHT_CACHE_MAX);
    expect(imageHeightCache.has("img-0.png")).toBe(false);
    expect(imageHeightCache.get("one-more.png")).toBe(42);

    // updating an existing key must not evict
    recordImageHeight("img-1.png", 7);
    expect(imageHeightCache.get("img-1.png")).toBe(7);
    expect(imageHeightCache.size).toBe(IMAGE_HEIGHT_CACHE_MAX);
  });
});
