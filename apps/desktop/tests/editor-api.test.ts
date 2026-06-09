import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Mock the tauri API before importing stores
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { useEditorStore } from "../src/stores/editor-store";
import * as editorApi from "../src/hooks/editor-api";

function makeFileTab(id: string, currentPath: string) {
  return {
    id,
    location: { kind: "file" as const, path: currentPath },
    back: [],
    forward: [],
  };
}

describe("editorApi", () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });
  });

  test("getOpenFiles returns current open files map", () => {
    const files = new Map([
      [
        "/test.md",
        {
          path: "/test.md",
          frontmatter: "",
          content: "hello",
          title: "",
          titleSource: "none",
          diskContent: "hello",
          isDirty: false,
          isLoading: false,
          saveError: null,
          reloadVersion: 0,
          scrollPos: 0,
          scrollAnchor: null,
          cursorPos: 0,
          displayDate: null,
          stats: { words: 0, characters: 0, paragraphs: 0 },
        },
      ],
    ]);
    useEditorStore.setState({ openFiles: files });
    expect(editorApi.getOpenFiles()).toBe(files);
  });

  test("getActiveFilePath returns current active file", () => {
    expect(editorApi.getActiveFilePath()).toBeNull();
    useEditorStore.setState({ activeFilePath: "/test.md" });
    expect(editorApi.getActiveFilePath()).toBe("/test.md");
  });

  test("closeFile delegates to store", () => {
    const files = new Map([
      [
        "/a.md",
        {
          path: "/a.md",
          frontmatter: "",
          content: "",
          title: "",
          titleSource: "none",
          diskContent: "",
          isDirty: false,
          isLoading: false,
          saveError: null,
          reloadVersion: 0,
          scrollPos: 0,
          scrollAnchor: null,
          cursorPos: 0,
          displayDate: null,
          stats: { words: 0, characters: 0, paragraphs: 0 },
        },
      ],
    ]);
    useEditorStore.setState({
      openFiles: files,
      tabs: [makeFileTab("tab-a", "/a.md")],
      activeTabId: "tab-a",
      activeFilePath: "/a.md",
    });

    editorApi.closeFile("/a.md");

    expect(useEditorStore.getState().openFiles.has("/a.md")).toBe(false);
    expect(useEditorStore.getState().tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
  });

  test("markSaved delegates to store", () => {
    const files = new Map([
      [
        "/a.md",
        {
          path: "/a.md",
          frontmatter: null,
          content: "modified",
          title: "",
          titleSource: "none",
          diskContent: "original",
          isDirty: true,
          isLoading: false,
          saveError: null,
          reloadVersion: 0,
          scrollPos: 0,
          scrollAnchor: null,
          cursorPos: 0,
          displayDate: null,
          stats: { words: 0, characters: 0, paragraphs: 0 },
        },
      ],
    ]);
    useEditorStore.setState({ openFiles: files });

    editorApi.markSaved("/a.md", "modified");

    const file = useEditorStore.getState().openFiles.get("/a.md");
    expect(file?.isDirty).toBe(false);
    expect(file?.diskContent).toBe("modified");
  });
});
