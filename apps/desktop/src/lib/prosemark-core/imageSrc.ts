import { type EditorState, Facet } from "@codemirror/state";

export type ImageSrcResolver = (src: string) => string;

/** Host-provided mapping from a markdown image destination to the URL the
 *  `<img>` should actually load (Writer maps workspace-relative paths to Tauri
 *  asset URLs). Widgets call `resolveImageSrc` in `toDOM`, so images are
 *  inserted already resolved; no DOM observer is needed. */
export const imageSrcResolverFacet = Facet.define<ImageSrcResolver, ImageSrcResolver | null>({
  combine: (values) => values[0] ?? null,
});

export function resolveImageSrc(state: EditorState, src: string): string {
  return state.facet(imageSrcResolverFacet)?.(src) ?? src;
}
