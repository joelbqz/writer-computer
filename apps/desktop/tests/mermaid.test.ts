import { describe, expect, test, vi, beforeEach } from "vite-plus/test";

// DOMPurify needs a DOM (provided by the browser at runtime) — mock it as a
// passthrough so the renderer's other behavior (caching, error handling)
// can be exercised in node.
vi.mock("dompurify", () => ({
  default: { sanitize: (svg: string) => svg },
}));

// Mock mermaid module before importing the renderer
vi.mock("mermaid", () => {
  const renderMock = vi.fn().mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    diagramType: "flowchart-v2",
  });
  const initializeMock = vi.fn();
  return {
    default: {
      initialize: initializeMock,
      render: renderMock,
    },
    initialize: initializeMock,
    render: renderMock,
  };
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

  test("returns cached SVG on second call with same source and theme", async () => {
    const mermaid = (await import("mermaid")).default;

    const result1 = await renderMermaid("graph TD;\n  A-->B;", "light", "test-2a");
    expect(result1.svg).toBeDefined();

    const result2 = await renderMermaid("graph TD;\n  A-->B;", "light", "test-2b");
    expect(result2.svg).toBe(result1.svg);

    // render should only have been called once for this source+theme combo
    // (once for this test, but also once from the previous test with the same input)
    // The cache was cleared in beforeEach, so render is called once for result1,
    // and result2 should come from cache.
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  test("different themes produce different cache keys", async () => {
    const mermaid = (await import("mermaid")).default;

    await renderMermaid("graph TD;\n  A-->B;", "light", "test-3a");
    await renderMermaid("graph TD;\n  A-->B;", "dark", "test-3b");

    // render should have been called twice (different themes = different cache keys)
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  test("returns error result for invalid mermaid source", async () => {
    const mermaid = (await import("mermaid")).default;
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse error in mermaid"));

    const result = await renderMermaid("not valid mermaid", "light", "test-4");
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Parse error in mermaid");
    expect(result.svg).toBeUndefined();
  });

  test("handles non-Error thrown values", async () => {
    const mermaid = (await import("mermaid")).default;
    vi.mocked(mermaid.render).mockRejectedValueOnce("string error");

    const result = await renderMermaid("bad source", "light", "test-7");
    expect(result.error).toBe("string error");
    expect(result.svg).toBeUndefined();
  });
});
