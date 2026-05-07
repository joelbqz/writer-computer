import { renderMermaidSVG } from "beautiful-mermaid";

const SVG_CACHE_LIMIT = 50;
const svgCache = new Map<string, string>();

export interface RenderResult {
  svg: string;
  error?: undefined;
}

export interface RenderError {
  svg?: undefined;
  error: string;
}

// beautiful-mermaid resolves colours from CSS custom properties at paint time,
// so passing the app's `--bg-base` / `--fg-base` lets a single cached SVG work
// in both light and dark themes. `transparent: true` skips the explicit
// background fill on the SVG root — the canvas frame already shows through.
const RENDER_OPTIONS = {
  bg: "var(--bg-base)",
  fg: "var(--fg-base)",
  transparent: true,
} as const;

// Defense-in-depth: strip <script> blocks and on*= event-handler attributes
// before the SVG reaches innerHTML. beautiful-mermaid escapes label text, but
// documents come from external sources (Obsidian vaults, repos) and the
// third-party renderer is young — a belt-and-suspenders pass on the output
// protects against future regressions in either the library or its inputs.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");
}

function cacheGet(key: string): string | undefined {
  const cached = svgCache.get(key);
  if (cached === undefined) return undefined;
  // Refresh recency: re-insert at the end so least-recently-used stays at the
  // front for eviction.
  svgCache.delete(key);
  svgCache.set(key, cached);
  return cached;
}

function cacheSet(key: string, value: string): void {
  if (svgCache.has(key)) svgCache.delete(key);
  svgCache.set(key, value);
  while (svgCache.size > SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value;
    if (oldest === undefined) break;
    svgCache.delete(oldest);
  }
}

// Synchronous on purpose: beautiful-mermaid is itself synchronous and the
// cache makes repeat renders O(map lookup). Calling this from `toDOM` lets the
// widget paint with its rendered SVG in the same frame the wrapper enters the
// DOM — there's no async gap that can leave the user stuck on a placeholder.
export function renderMermaid(source: string): RenderResult | RenderError {
  const cached = cacheGet(source);
  if (cached !== undefined) return { svg: cached };

  try {
    const svg = sanitizeSvg(renderMermaidSVG(source, RENDER_OPTIONS));
    cacheSet(source, svg);
    return { svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export function clearMermaidCache() {
  svgCache.clear();
}
