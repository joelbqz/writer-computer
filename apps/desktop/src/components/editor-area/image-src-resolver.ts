import { EditorView, ViewPlugin } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { decodeLinkPath, getParentDir, normalizeMarkdownDestination } from "@/lib/paths";

function resolveImgSrc(img: HTMLImageElement, markdownDir: string) {
  const rawSrc = img.getAttribute("src");
  const src = rawSrc ? normalizeMarkdownDestination(rawSrc) : rawSrc;
  if (!src) return;
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("asset:") ||
    src.startsWith("data:") ||
    src.startsWith("blob:")
  )
    return;
  const localSrc = decodeLinkPath(src);
  const absolute = localSrc.startsWith("/") ? localSrc : `${markdownDir}/${localSrc}`;
  img.src = convertFileSrc(absolute);
}

export function imageSrcResolver(getActivePath: () => string | null) {
  return ViewPlugin.fromClass(
    class {
      observer: MutationObserver;

      constructor(view: EditorView) {
        const dir = this.getDir(getActivePath());
        if (dir) this.fixAll(view.dom, dir);

        this.observer = new MutationObserver((mutations) => {
          const d = this.getDir(getActivePath());
          if (!d) return;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node instanceof HTMLImageElement) resolveImgSrc(node, d);
              else if (node instanceof HTMLElement) {
                for (const img of node.querySelectorAll("img"))
                  resolveImgSrc(img as HTMLImageElement, d);
              }
            }
          }
        });
        this.observer.observe(view.dom, { childList: true, subtree: true });
      }

      getDir(path: string | null): string | null {
        return path ? getParentDir(path) : null;
      }

      fixAll(root: HTMLElement, dir: string) {
        for (const img of root.querySelectorAll("img")) resolveImgSrc(img as HTMLImageElement, dir);
      }

      destroy() {
        this.observer.disconnect();
      }
    },
  );
}
