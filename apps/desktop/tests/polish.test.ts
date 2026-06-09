import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { useEditorStore } from "../src/stores/editor-store";

function makeTab(id: string, currentPath: string) {
  return {
    id,
    location: { kind: "file" as const, path: currentPath },
    back: [],
    forward: [],
  };
}

describe("keyboard shortcuts - tab navigation", () => {
  beforeEach(() => {
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [makeTab("tab-a", "/a.md"), makeTab("tab-b", "/b.md"), makeTab("tab-c", "/c.md")],
      activeTabId: "tab-a",
      activeFilePath: null,
    });
  });

  test("next tab cycles forward", () => {
    useEditorStore.setState({ activeFilePath: "/a.md", activeTabId: "tab-a" });
    const { tabs, activeTabId } = useEditorStore.getState();
    const idx = tabs.findIndex((tab) => tab.id === activeTabId);
    const next = (idx + 1) % tabs.length;
    useEditorStore.getState().setActiveTab(tabs[next]!.id);
    expect(useEditorStore.getState().activeFilePath).toBe("/b.md");
  });

  test("previous tab cycles backward", () => {
    useEditorStore.setState({ activeFilePath: "/a.md", activeTabId: "tab-a" });
    const { tabs, activeTabId } = useEditorStore.getState();
    const idx = tabs.findIndex((tab) => tab.id === activeTabId);
    const prev = (idx - 1 + tabs.length) % tabs.length;
    useEditorStore.getState().setActiveTab(tabs[prev]!.id);
    expect(useEditorStore.getState().activeFilePath).toBe("/c.md");
  });

  test("jump to Nth tab", () => {
    useEditorStore.setState({ activeFilePath: "/a.md", activeTabId: "tab-a" });
    const { tabs } = useEditorStore.getState();
    useEditorStore.getState().setActiveTab(tabs[1]!.id);
    expect(useEditorStore.getState().activeFilePath).toBe("/b.md");
  });

  test("Cmd+W closes current tab", async () => {
    const { invoke } = vi.mocked(await import("@tauri-apps/api/core"));
    invoke.mockResolvedValue({ path: "/a.md", content: "a", modified_at: 1 });

    useEditorStore.setState({
      tabs: [makeTab("tab-a", "/a.md"), makeTab("tab-b", "/b.md")],
      activeTabId: "tab-a",
      activeFilePath: "/a.md",
      openFiles: new Map([
        [
          "/a.md",
          {
            path: "/a.md",
            frontmatter: "",
            content: "a",
            title: "",
            titleSource: "none",
            diskContent: "a",
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
        [
          "/b.md",
          {
            path: "/b.md",
            frontmatter: "",
            content: "b",
            title: "",
            titleSource: "none",
            diskContent: "b",
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
      ]),
    });

    useEditorStore.getState().closeFile("/a.md");

    expect(
      useEditorStore
        .getState()
        .tabs.flatMap((tab) => (tab.location.kind === "file" ? [tab.location.path] : [])),
    ).toEqual(["/b.md"]);
    expect(useEditorStore.getState().activeFilePath).toBe("/b.md");
  });
});
