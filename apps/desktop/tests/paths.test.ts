import { describe, expect, test } from "vite-plus/test";
import {
  getFileExtension,
  getFileName,
  getFileStem,
  getRelativePath,
  normalizePath,
  resolveLinkTarget,
} from "../src/lib/paths";

describe("getFileExtension", () => {
  test("returns extension for normal files", async () => {
    expect(getFileExtension("/path/to/file.md")).toBe("md");
    expect(getFileExtension("test.txt")).toBe("txt");
  });

  test("returns empty string for no extension", () => {
    expect(getFileExtension("Makefile")).toBe("");
    expect(getFileExtension("/path/to/file")).toBe("");
  });

  test("returns last extension for multiple dots", () => {
    expect(getFileExtension("file.test.ts")).toBe("ts");
  });

  test("handles dotfiles", () => {
    expect(getFileExtension(".gitignore")).toBe("");
    expect(getFileExtension("/path/.env")).toBe("");
  });
});

describe("getFileStem", () => {
  test("returns name without extension", () => {
    expect(getFileStem("/path/to/file.md")).toBe("file");
    expect(getFileStem("test.txt")).toBe("test");
  });

  test("returns full name when no extension", () => {
    expect(getFileStem("Makefile")).toBe("Makefile");
  });

  test("handles multiple dots", () => {
    expect(getFileStem("file.test.ts")).toBe("file.test");
  });
});

describe("getFileName", () => {
  test("returns filename from path", () => {
    expect(getFileName("/path/to/file.md")).toBe("file.md");
    expect(getFileName("file.md")).toBe("file.md");
  });

  test("handles backslashes", () => {
    expect(getFileName("C:\\Users\\test\\file.md")).toBe("file.md");
  });
});

describe("getRelativePath", () => {
  test("strips root from path", () => {
    expect(getRelativePath("/home/user/docs/file.md", "/home/user")).toBe("docs/file.md");
  });

  test("returns full path if root does not match", () => {
    expect(getRelativePath("/other/file.md", "/home/user")).toBe("/other/file.md");
  });

  test("handles trailing slash on root", () => {
    expect(getRelativePath("/home/user/file.md", "/home/user/")).toBe("file.md");
  });
});

describe("normalizePath", () => {
  test("normalizes dot segments", () => {
    expect(normalizePath("/notes/a/../b/./c.md")).toBe("/notes/b/c.md");
  });

  test("normalizes windows separators", () => {
    expect(normalizePath("C:\\notes\\a\\..\\b.md")).toBe("C:/notes/b.md");
  });

  test("preserves relative parent traversal", () => {
    expect(normalizePath("../notes/./a.md")).toBe("../notes/a.md");
  });
});

describe("resolveLinkTarget", () => {
  test("resolves relative markdown links inside the workspace", async () => {
    expect(await resolveLinkTarget("../ideas/next.md", "/vault/daily/today.md", "/vault")).toEqual({
      kind: "internal",
      path: "/vault/ideas/next.md",
    });
  });

  test("strips query from markdown links but preserves anchor", async () => {
    expect(
      await resolveLinkTarget("./guide.md?view=1#intro", "/vault/docs/start.md", "/vault"),
    ).toEqual({
      kind: "internal",
      path: "/vault/docs/guide.md",
      anchor: "intro",
    });
  });

  test("decodes encoded local markdown paths", async () => {
    expect(await resolveLinkTarget("./My%20Guide.md", "/vault/docs/start.md", "/vault")).toEqual({
      kind: "internal",
      path: "/vault/docs/My Guide.md",
    });
  });

  test("classifies hash-only links as same-doc-anchor", async () => {
    expect(await resolveLinkTarget("#intro", "/vault/docs/start.md", "/vault")).toEqual({
      kind: "same-doc-anchor",
      anchor: "intro",
    });
  });

  test("returns null for a bare hash", async () => {
    expect(await resolveLinkTarget("#", "/vault/docs/start.md", "/vault")).toBeNull();
  });

  test("decodes percent-encoded same-doc anchors", async () => {
    expect(await resolveLinkTarget("#hello%20world", "/vault/docs/start.md", "/vault")).toEqual({
      kind: "same-doc-anchor",
      anchor: "hello world",
    });
  });

  test("attaches anchor to internal cross-doc markdown links", async () => {
    expect(await resolveLinkTarget("./guide.md#setup", "/vault/docs/start.md", "/vault")).toEqual({
      kind: "internal",
      path: "/vault/docs/guide.md",
      anchor: "setup",
    });
  });

  test("omits anchor field when cross-doc link has no fragment", async () => {
    expect(await resolveLinkTarget("./guide.md", "/vault/docs/start.md", "/vault")).toEqual({
      kind: "internal",
      path: "/vault/docs/guide.md",
    });
  });

  test("classifies explicit URLs as external", async () => {
    expect(
      await resolveLinkTarget("https://example.com/docs", "/vault/docs/start.md", "/vault"),
    ).toEqual({
      kind: "external-url",
      url: "https://example.com/docs",
    });
  });

  test("keeps non-markdown files external", async () => {
    expect(await resolveLinkTarget("./guide.pdf", "/vault/docs/start.md", "/vault")).toEqual({
      kind: "external-path",
      path: "/vault/docs/guide.pdf",
    });
  });

  test("treats markdown outside the workspace as external", async () => {
    expect(await resolveLinkTarget("../outside.md", "/vault/docs/start.md", "/vault/docs")).toEqual(
      {
        kind: "external-path",
        path: "/vault/outside.md",
      },
    );
  });

  test("supports windows absolute markdown paths", async () => {
    expect(
      await resolveLinkTarget(
        "C:\\vault\\notes\\other.md",
        "C:\\vault\\notes\\start.md",
        "C:/vault",
      ),
    ).toEqual({
      kind: "internal",
      path: "C:/vault/notes/other.md",
    });
  });

  test("absolute markdown path outside workspace stays filesystem-absolute", async () => {
    expect(
      await resolveLinkTarget("/tmp/scratch/note.md", "/vault/docs/start.md", "/vault"),
    ).toEqual({
      kind: "external-path",
      path: "/tmp/scratch/note.md",
    });
  });

  describe("extensionless link resolution", () => {
    const fileExists = (path: string) => {
      const existing = new Set([
        "/vault/docs/guide.md",
        "/vault/docs/foo/index.md",
        "/vault/docs/bar.md",
        "/vault/docs/bar/index.md",
        "/vault/docs/readme-only/README.md",
      ]);
      return existing.has(path);
    };

    test("resolves extensionless path to .md file", async () => {
      expect(
        await resolveLinkTarget("./guide", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/guide.md",
      });
    });

    test("resolves trailing-slash path to .md file", async () => {
      expect(
        await resolveLinkTarget("./bar/", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/bar.md",
      });
    });

    test("resolves to index.md when .md does not exist", async () => {
      expect(
        await resolveLinkTarget("./foo", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/foo/index.md",
      });
    });

    test("resolves trailing-slash to index.md when .md does not exist", async () => {
      expect(
        await resolveLinkTarget("./foo/", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/foo/index.md",
      });
    });

    test("resolves to README.md as last resort", async () => {
      expect(
        await resolveLinkTarget("./readme-only", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/readme-only/README.md",
      });
    });

    test(".md wins over index.md when both exist", async () => {
      expect(
        await resolveLinkTarget("./bar", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/bar.md",
      });
    });

    test("falls back to external-path when no candidate exists", async () => {
      expect(
        await resolveLinkTarget("./missing", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "external-path",
        path: "/vault/docs/missing",
      });
    });

    test("does not probe when extension is non-markdown", async () => {
      expect(
        await resolveLinkTarget("./image.png", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "external-path",
        path: "/vault/docs/image.png",
      });
    });

    test("attaches anchor when probing extensionless paths", async () => {
      expect(
        await resolveLinkTarget("./guide#heading", "/vault/docs/start.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/guide.md",
        anchor: "heading",
      });
    });

    test("absolute extensionless path resolves inside workspace", async () => {
      expect(
        await resolveLinkTarget("/docs/guide", "/vault/daily/today.md", "/vault", fileExists),
      ).toEqual({
        kind: "internal",
        path: "/vault/docs/guide.md",
      });
    });

    test("candidate outside workspace returns external-path", async () => {
      const limitedExists = (p: string) => p === "/outside/doc.md";
      expect(
        await resolveLinkTarget(
          "../../outside/doc",
          "/vault/docs/start.md",
          "/vault",
          limitedExists,
        ),
      ).toEqual({
        kind: "external-path",
        path: "/outside/doc",
      });
    });

    test("works without fileExists (backward compat)", async () => {
      expect(await resolveLinkTarget("./guide", "/vault/docs/start.md", "/vault")).toEqual({
        kind: "external-path",
        path: "/vault/docs/guide",
      });
    });
  });
});
