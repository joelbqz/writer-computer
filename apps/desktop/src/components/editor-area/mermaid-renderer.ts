import DOMPurify from "dompurify";
import type { Mermaid } from "mermaid";

// Lazy-loaded mermaid instance
let mermaidPromise: Promise<Mermaid> | null = null;

function getMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

// SVG cache keyed by hash(source + theme).
const svgCache = new Map<string, string>();
// Rendered height cache keyed the same way, used to reserve space in the
// CodeMirror heightmap so widgets don't start tall → collapse → render tall
// again when they scroll in and out of the viewport.
const heightCache = new Map<string, number>();

function hashKey(source: string, theme: string): string {
  // Simple string hash for cache key
  const data = source + "|" + theme;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function getCachedHeight(source: string, theme: MermaidTheme): number | undefined {
  return heightCache.get(hashKey(source, theme));
}

export function cacheHeight(source: string, theme: MermaidTheme, height: number): void {
  if (height <= 0) return;
  heightCache.set(hashKey(source, theme), height);
}

export type MermaidTheme = "light" | "dark";

// Monochrome palettes. We drive Mermaid via the `base` theme so every color
// slot is under our control — the default palette is otherwise vivid.
const monochromeVariables: Record<MermaidTheme, Record<string, string>> = {
  light: {
    background: "transparent",
    primaryColor: "transparent",
    primaryTextColor: "#1a1a1a",
    primaryBorderColor: "#1a1a1a",
    secondaryColor: "transparent",
    secondaryTextColor: "#1a1a1a",
    secondaryBorderColor: "#1a1a1a",
    tertiaryColor: "transparent",
    tertiaryTextColor: "#1a1a1a",
    tertiaryBorderColor: "#1a1a1a",
    lineColor: "#1a1a1a",
    textColor: "#1a1a1a",
    mainBkg: "transparent",
    secondBkg: "transparent",
    noteBkgColor: "transparent",
    noteTextColor: "#1a1a1a",
    noteBorderColor: "#1a1a1a",
    edgeLabelBackground: "#ffffff",
    labelBackground: "#ffffff",
    labelTextColor: "#1a1a1a",
    labelBoxBkgColor: "transparent",
    labelBoxBorderColor: "#1a1a1a",
    clusterBkg: "transparent",
    clusterBorder: "#1a1a1a",
    altBackground: "transparent",
    activationBkgColor: "transparent",
    activationBorderColor: "#1a1a1a",
    titleColor: "#1a1a1a",
    // gitGraph: shades of gray so branches remain distinguishable without color.
    git0: "#2a2a2a",
    git1: "#555555",
    git2: "#777777",
    git3: "#999999",
    git4: "#444444",
    git5: "#666666",
    git6: "#888888",
    git7: "#aaaaaa",
    gitInv0: "#ffffff",
    gitInv1: "#ffffff",
    gitInv2: "#ffffff",
    gitInv3: "#ffffff",
    gitInv4: "#ffffff",
    gitInv5: "#ffffff",
    gitInv6: "#ffffff",
    gitInv7: "#ffffff",
    gitBranchLabel0: "#ffffff",
    gitBranchLabel1: "#ffffff",
    gitBranchLabel2: "#ffffff",
    gitBranchLabel3: "#1a1a1a",
    gitBranchLabel4: "#ffffff",
    gitBranchLabel5: "#ffffff",
    gitBranchLabel6: "#ffffff",
    gitBranchLabel7: "#1a1a1a",
    commitLabelColor: "#1a1a1a",
    commitLabelBackground: "#ffffff",
    commitLabelBorder: "#1a1a1a",
    tagLabelColor: "#1a1a1a",
    tagLabelBackground: "#e0e0e0",
    tagLabelBorder: "#1a1a1a",
  },
  dark: {
    background: "transparent",
    primaryColor: "transparent",
    primaryTextColor: "#f0f0f0",
    primaryBorderColor: "#f0f0f0",
    secondaryColor: "transparent",
    secondaryTextColor: "#f0f0f0",
    secondaryBorderColor: "#f0f0f0",
    tertiaryColor: "transparent",
    tertiaryTextColor: "#f0f0f0",
    tertiaryBorderColor: "#f0f0f0",
    lineColor: "#f0f0f0",
    textColor: "#f0f0f0",
    mainBkg: "transparent",
    secondBkg: "transparent",
    noteBkgColor: "transparent",
    noteTextColor: "#f0f0f0",
    noteBorderColor: "#f0f0f0",
    edgeLabelBackground: "#111111",
    labelBackground: "#111111",
    labelTextColor: "#f0f0f0",
    labelBoxBkgColor: "transparent",
    labelBoxBorderColor: "#f0f0f0",
    clusterBkg: "transparent",
    clusterBorder: "#f0f0f0",
    altBackground: "transparent",
    activationBkgColor: "transparent",
    activationBorderColor: "#f0f0f0",
    titleColor: "#f0f0f0",
    // gitGraph: shades of gray so branches remain distinguishable without color.
    git0: "#e0e0e0",
    git1: "#b0b0b0",
    git2: "#909090",
    git3: "#707070",
    git4: "#c8c8c8",
    git5: "#a0a0a0",
    git6: "#808080",
    git7: "#606060",
    gitInv0: "#111111",
    gitInv1: "#111111",
    gitInv2: "#111111",
    gitInv3: "#111111",
    gitInv4: "#111111",
    gitInv5: "#111111",
    gitInv6: "#111111",
    gitInv7: "#111111",
    gitBranchLabel0: "#111111",
    gitBranchLabel1: "#111111",
    gitBranchLabel2: "#111111",
    gitBranchLabel3: "#f0f0f0",
    gitBranchLabel4: "#111111",
    gitBranchLabel5: "#111111",
    gitBranchLabel6: "#f0f0f0",
    gitBranchLabel7: "#f0f0f0",
    commitLabelColor: "#f0f0f0",
    commitLabelBackground: "#111111",
    commitLabelBorder: "#f0f0f0",
    tagLabelColor: "#f0f0f0",
    tagLabelBackground: "#333333",
    tagLabelBorder: "#f0f0f0",
  },
};

export interface RenderResult {
  svg: string;
  error?: undefined;
}

export interface RenderError {
  svg?: undefined;
  error: string;
}

export async function renderMermaid(
  source: string,
  theme: MermaidTheme,
  id: string,
): Promise<RenderResult | RenderError> {
  const key = hashKey(source, theme);
  const cached = svgCache.get(key);
  if (cached) return { svg: cached };

  try {
    const mermaid = await getMermaid();

    const config = {
      startOnLoad: false,
      securityLevel: "strict" as const,
      theme: "base" as const,
      themeVariables: monochromeVariables[theme],
      fontFamily: "inherit",
    };
    mermaid.initialize(config);

    const { svg } = await mermaid.render(id, source.trim());

    // Defense in depth on top of mermaid's `securityLevel: "strict"`:
    // DOMPurify's SVG profile keeps the full diagram element set while
    // stripping <script>, event handlers, and javascript: URLs.
    const sanitized = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });

    svgCache.set(key, sanitized);
    return { svg: sanitized };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export function clearMermaidCache() {
  svgCache.clear();
  heightCache.clear();
}
