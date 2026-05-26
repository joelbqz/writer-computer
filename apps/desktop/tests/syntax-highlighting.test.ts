import { describe, expect, test } from "vite-plus/test";
import { __testSyntaxHighlighting } from "../src/lib/prosemark-core/syntaxHighlighting";

describe("baseTheme", () => {
  test("inline code follows the editor font size while keeping the code font", () => {
    const inlineCode = __testSyntaxHighlighting.baseThemeSpec[".cm-inline-code"];

    expect(inlineCode.fontSize).toBe("var(--writer-editor-font-size, 16px)");
    expect(inlineCode.fontFamily).toContain("--pm-code-font");
  });
});
