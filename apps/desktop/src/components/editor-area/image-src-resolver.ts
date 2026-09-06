import { convertFileSrc } from "@tauri-apps/api/core";
import { imageSrcResolverFacet } from "@/lib/prosemark-core/imageSrc";
import { decodeLinkPath, getParentDir, normalizeMarkdownDestination } from "@/lib/paths";

const PASSTHROUGH_PREFIXES = ["http://", "https://", "asset:", "data:", "blob:"];

/** Map a markdown image destination to a loadable URL. Remote, asset, data,
 *  and blob URLs pass through; everything else is a local path resolved
 *  against `markdownDir` and converted to a Tauri asset URL. */
export function resolveLocalImageSrc(rawSrc: string, markdownDir: string | null): string {
  const src = normalizeMarkdownDestination(rawSrc);
  if (!src || !markdownDir) return rawSrc;
  if (PASSTHROUGH_PREFIXES.some((prefix) => src.startsWith(prefix))) return src;
  const localSrc = decodeLinkPath(src);
  const absolute = localSrc.startsWith("/") ? localSrc : `${markdownDir}/${localSrc}`;
  return convertFileSrc(absolute);
}

export function imageSrcResolver(getActivePath: () => string | null) {
  return imageSrcResolverFacet.of((src) => {
    const path = getActivePath();
    return resolveLocalImageSrc(src, path ? getParentDir(path) : null);
  });
}
