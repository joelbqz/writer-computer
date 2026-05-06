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

  test("renders valid mermaid source and returns SVG", async () => {
    const result = await renderMermaid("graph TD;\n  A-->B;", "light", "test-1");
    expect(result.svg).toBeDefined();
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain("<svg");
  });

  test("returns cached SVG on second call with same source", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");

    const result1 = await renderMermaid("graph TD;\n  A-->B;", "light", "test-2a");
    expect(result1.svg).toBeDefined();

    const result2 = await renderMermaid("graph TD;\n  A-->B;", "light", "test-2b");
    expect(result2.svg).toBe(result1.svg);

    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
  });

  test("theme parameter is ignored — same source hits cache regardless of theme", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");

    await renderMermaid("graph TD;\n  A-->B;", "light", "test-3a");
    await renderMermaid("graph TD;\n  A-->B;", "dark", "test-3b");

    // beautiful-mermaid has a single visual style; theme doesn't affect the
    // cache key, so the second call hits the cache.
    expect(renderMermaidSVG).toHaveBeenCalledTimes(1);
  });

  test("returns error result when the renderer throws", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockImplementationOnce(() => {
      throw new Error("Parse error in mermaid");
    });

    const result = await renderMermaid("not valid mermaid", "light", "test-4");
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Parse error in mermaid");
    expect(result.svg).toBeUndefined();
  });

  test("handles non-Error thrown values", async () => {
    const { renderMermaidSVG } = await import("beautiful-mermaid");
    vi.mocked(renderMermaidSVG).mockImplementationOnce(() => {
      throw "string error";
    });

    const result = await renderMermaid("bad source", "light", "test-5");
    expect(result.error).toBe("string error");
    expect(result.svg).toBeUndefined();
  });
});

const { MERMAID_CANVAS_HEIGHT } = await import("../src/components/editor-area/mermaid-canvas");
const { computeEditToggleTarget } =
  await import("../src/components/editor-area/mermaid-decorations");

describe("mermaid canvas frame", () => {
  test("MERMAID_CANVAS_HEIGHT is a positive fixed height", () => {
    expect(MERMAID_CANVAS_HEIGHT).toBeGreaterThan(0);
    expect(Number.isInteger(MERMAID_CANVAS_HEIGHT)).toBe(true);
  });
});

describe("computeEditToggleTarget", () => {
  // For a fence: ```mermaid\ngraph TD;\n  A-->B;\n```
  // Suppose: fenceFrom=10, codeFrom=20, codeTo=42, fenceTo=46, docLength=200
  const fence = { fenceFrom: 10, codeFrom: 20, codeTo: 42, fenceTo: 46, docLength: 200 };

  test("preview → edit: jumps to start of code text", () => {
    expect(computeEditToggleTarget({ ...fence, editMode: false })).toBe(20);
  });

  test("edit → preview: jumps just past closing fence", () => {
    expect(computeEditToggleTarget({ ...fence, editMode: true })).toBe(47);
  });

  test("edit → preview clamps to document length when fence is at EOF", () => {
    expect(
      computeEditToggleTarget({ ...fence, editMode: true, fenceTo: 199, docLength: 199 }),
    ).toBe(199);
  });

  test("preview → edit falls back to fenceFrom+1 when CodeText is empty", () => {
    expect(computeEditToggleTarget({ ...fence, editMode: false, codeFrom: 20, codeTo: 20 })).toBe(
      11,
    );
  });

  test("preview → edit fallback never overshoots fenceTo on degenerate fences", () => {
    expect(
      computeEditToggleTarget({
        editMode: false,
        fenceFrom: 5,
        fenceTo: 6,
        codeFrom: 6,
        codeTo: 6,
        docLength: 100,
      }),
    ).toBe(6);
  });
});
