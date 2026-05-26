import { describe, expect, test, vi } from "vite-plus/test";
import { formatMarkdownDestination, getParentDir, resolveImagePath } from "../src/lib/paths";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("resolveImagePath", () => {
  test("resolves relative path against markdown dir", () => {
    expect(resolveImagePath("note-assets/img.png", "/workspace/notes")).toBe(
      "/workspace/notes/note-assets/img.png",
    );
  });

  test("returns absolute paths unchanged", () => {
    expect(resolveImagePath("/absolute/path.png", "/workspace")).toBe("/absolute/path.png");
  });

  test("returns URLs unchanged", () => {
    expect(resolveImagePath("https://example.com/img.png", "/workspace")).toBe(
      "https://example.com/img.png",
    );
  });

  test("handles subdirectory paths", () => {
    expect(resolveImagePath("sub/dir/img.png", "/workspace/docs")).toBe(
      "/workspace/docs/sub/dir/img.png",
    );
  });

  test("handles angle-bracket image paths with spaces", () => {
    expect(resolveImagePath("<note assets/img file.png>", "/workspace/docs")).toBe(
      "/workspace/docs/note assets/img file.png",
    );
  });

  test("handles percent-encoded image paths with spaces", () => {
    expect(resolveImagePath("note%20assets/img%20file.png", "/workspace/docs")).toBe(
      "/workspace/docs/note assets/img file.png",
    );
  });

  test("formats generated image destinations with spaces", () => {
    expect(formatMarkdownDestination("My Note-assets/image.png")).toBe(
      "<My Note-assets/image.png>",
    );
  });
});

describe("getParentDir", () => {
  test("returns parent directory", () => {
    expect(getParentDir("/workspace/notes/file.md")).toBe("/workspace/notes");
  });

  test("handles root-level files", () => {
    expect(getParentDir("/file.md")).toBe("/");
  });

  test("handles backslashes", () => {
    expect(getParentDir("C:\\Users\\test\\file.md")).toBe("C:/Users/test");
  });
});

describe("saveClipboardImage IPC", () => {
  test("calls correct command", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockResolvedValue({
      relative_path: "note-assets/img.png",
      absolute_path: "/ws/note-assets/img.png",
    });

    const { saveClipboardImage } = await import("../src/lib/tauri");
    await saveClipboardImage("/ws/note.md", [1, 2, 3], "png");

    expect(mockedInvoke).toHaveBeenCalledWith("save_clipboard_image", {
      markdownFilePath: "/ws/note.md",
      imageData: [1, 2, 3],
      format: "png",
    });
  });
});
