import { describe, expect, test, vi, beforeEach } from "vite-plus/test";

// Mock beautiful-mermaid before importing the renderer
vi.mock("beautiful-mermaid", () => {
  const renderMermaidSVG = vi
    .fn()
    .mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  return { renderMermaidSVG };
});

// Import after mock setup
const { renderMermaid, clearMermaidCache } =
  await import("../src/components/editor-area/mermaid-renderer");

describe("renderMermaid", () => {
  beforeEach(() => {
    clearMermaidCache();
    vi.clearAllMocks();
  });

  test("renders valid mermaid source and returns SVG", () => {
    const result = renderMermaid("graph TD;\n  A-->B;");
    expect(result.svg).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain("<svg");
  });

  test("returns cached SVG on second call with same source", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");

    const result1 = renderMermaid("graph TD;\n  A-->B;");
    expect(result1.svg).toBeDefined();

    const result2 = renderMermaid("graph TD;\n  A-->B;");
    expect(result2.svg).toBe(result1.svg);

    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
  });

  test("returns error result when the renderer throws", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockImplementationOnce(() => {
      throw new Error("Parse error in mermaid");
    });

    const result = renderMermaid("not valid mermaid");
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Parse error in mermaid");
    expect(result.svg).toBeUndefined();
  });

  test("handles non-Error thrown values", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockImplementationOnce(() => {
      throw "string error";
    });

    const result = renderMermaid("bad source");
    expect(result.error).toBe("string error");
    expect(result.svg).toBeUndefined();
  });

  test("strips <script> blocks from the rendered SVG", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockReturnValueOnce(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>',
    );

    const result = renderMermaid("xss-script");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("alert(1)");
    expect(result.svg).toContain("<rect");
  });

  test("strips self-closing <script/> tags from the rendered SVG", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockReturnValueOnce(
      '<svg xmlns="http://www.w3.org/2000/svg"><script src="evil.js"/><rect/></svg>',
    );

    const result = renderMermaid("xss-script-selfclosing");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("evil.js");
  });

  test("strips on*= event handler attributes from the rendered SVG", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockReturnValueOnce(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" onmouseover=\'evil()\' onload=stealCookies() /></svg>',
    );

    const result = renderMermaid("xss-handlers");
    expect(result.svg).toBeDefined();
    expect(result.svg).not.toContain("onclick");
    expect(result.svg).not.toContain("onmouseover");
    expect(result.svg).not.toContain("onload");
    expect(result.svg).not.toContain("alert(1)");
    expect(result.svg).not.toContain("evil()");
    expect(result.svg).not.toContain("stealCookies");
    expect(result.svg).toContain("<rect");
  });
});

const { MERMAID_CANVAS_HEIGHT } = await import("../src/components/editor-area/mermaid-canvas");
const { computeToggleSelection } =
  await import("../src/components/editor-area/mermaid-decorations");

describe("mermaid canvas frame", () => {
  test("MERMAID_CANVAS_HEIGHT is a positive fixed integer height", () => {
    expect(MERMAID_CANVAS_HEIGHT).toBeGreaterThan(0);
    expect(Number.isInteger(MERMAID_CANVAS_HEIGHT)).toBe(true);
  });
});

describe("computeToggleSelection", () => {
  // Mock fence positions; only the relative ordering matters
  // (fenceFrom < fenceTo < docLength).
  const fenceFrom = 10;
  const fenceTo = 46;
  const docLength = 200;

  test("preview → edit returns a reverse range covering the whole fence", () => {
    expect(computeToggleSelection(false, fenceFrom, fenceTo, docLength)).toEqual({
      anchor: fenceTo,
      head: fenceFrom,
    });
  });

  test("edit → preview moves caret just past the closing fence", () => {
    expect(computeToggleSelection(true, fenceFrom, fenceTo, docLength)).toEqual({
      anchor: fenceTo + 1,
    });
  });

  test("edit → preview clamps to document length when fence is at EOF", () => {
    expect(computeToggleSelection(true, fenceFrom, 199, 199)).toEqual({ anchor: 199 });
  });
});
