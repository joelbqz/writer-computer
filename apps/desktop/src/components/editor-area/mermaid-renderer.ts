import { renderMermaidSVG } from "beautiful-mermaid";

// SVG cache keyed by source. beautiful-mermaid emits a single SVG string per
// source and we hand it the app's CSS variables — colour resolution happens at
// CSS time, so the same SVG works for both light and dark themes.
const svgCache = new Map<string, string>();

// Kept for callers that still pass a theme argument; unused at render time.
export type MermaidTheme = "light" | "dark";

export interface RenderResult {
  svg: string;
  error?: undefined;
}

export interface RenderError {
  svg?: undefined;
  error: string;
}

// Map app design tokens onto beautiful-mermaid's colour roles. The library
// derives everything else (text-secondary, line, surface tints, edge labels,
// …) from `bg` + `fg` via `color-mix()` inside its own <style> block, so
// passing those two is enough to make diagrams adapt with the app theme.
// `transparent: true` skips the explicit `background:var(--bg)` style on the
// SVG root — the canvas frame already shows through to the editor.
const RENDER_OPTIONS = {
  bg: "var(--bg-base)",
  fg: "var(--fg-base)",
  transparent: true,
} as const;

export async function renderMermaid(
  source: string,
  _theme: MermaidTheme,
  _id: string,
): Promise<RenderResult | RenderError> {
  const cached = svgCache.get(source);
  if (cached) return { svg: cached };

  try {
    const svg = renderMermaidSVG(source, RENDER_OPTIONS);
    svgCache.set(source, svg);
    return { svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export function clearMermaidCache() {
  svgCache.clear();
}
