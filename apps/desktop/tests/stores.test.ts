import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

// Mock the tauri API before importing stores
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../src/stores/editor-store";
import { useSettingsStore } from "../src/stores/settings-store";
import { useUIStore } from "../src/stores/ui-store";
import { useWorkspaceStore } from "../src/stores/workspace-store";
import { toggleSidebar } from "../src/hooks/use-sidebar";
import { toggleTheme } from "../src/hooks/use-theme";
import { createPendingOpenDrainer, handleOpenPayload } from "../src/hooks/use-open-drop";
import { getEditorSessionSnapshot } from "../src/stores/editor-store";
// Side-effect: registers the subscription that re-points the standalone
// single-file watcher whenever the active file changes in a compact window.
import "../src/lib/standalone-watch";

const mockedInvoke = vi.mocked(invoke);

function tabPaths() {
  return useEditorStore
    .getState()
    .tabs.flatMap((tab) => (tab.location.kind === "file" ? [tab.location.path] : []));
}

function makeFileTab(id: string, currentPath: string) {
  return {
    id,
    location: { kind: "file" as const, path: currentPath },
    back: [],
    forward: [],
  };
}

function createDeferred<T>() {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      resolvePromise(value);
    },
  };
}

describe("workspace-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      root: null,
      workspaceEpoch: 0,
      chromeMode: "workspace",
      directoryCache: new Map(),
      expandedDirs: new Set(),
      pinnedFiles: [],
      sidebarMetadataVersion: 0,
      recentWorkspaces: [],
      fileCount: 0,
    });
  });

  test("openWorkspace sets root and loads entries", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "open_workspace") return { root: "/test", name: "test", file_count: 2 };
      if (cmd === "read_directory")
        return [{ name: "hello.md", path: "/test/hello.md", is_dir: false }];
      if (cmd === "get_recent_workspaces") return ["/test"];
      return null;
    });

    await useWorkspaceStore.getState().openWorkspace("/test");

    expect(useWorkspaceStore.getState().root).toBe("/test");
    expect(useWorkspaceStore.getState().fileCount).toBe(2);
    expect(useWorkspaceStore.getState().directoryCache.has("/test")).toBe(true);
    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual(["/test"]);
    expect(useEditorStore.getState().tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
  });

  test("toggleDirectory expands and collapses", async () => {
    mockedInvoke.mockResolvedValue([{ name: "file.md", path: "/test/dir/file.md", is_dir: false }]);

    useWorkspaceStore.setState({
      root: "/test",
      directoryCache: new Map(),
      expandedDirs: new Set(),
    });

    // Expand
    await useWorkspaceStore.getState().toggleDirectory("/test/dir");
    expect(useWorkspaceStore.getState().expandedDirs.has("/test/dir")).toBe(true);
    expect(useWorkspaceStore.getState().directoryCache.has("/test/dir")).toBe(true);

    // Collapse
    await useWorkspaceStore.getState().toggleDirectory("/test/dir");
    expect(useWorkspaceStore.getState().expandedDirs.has("/test/dir")).toBe(false);
  });

  test("refreshDirectory ignores a response after the workspace changes", async () => {
    const deferred = createDeferred<
      Array<{
        name: string;
        path: string;
        is_dir: boolean;
        is_markdown: boolean;
        modified_at: number;
      }>
    >();
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "read_directory" ? deferred.promise : Promise.resolve(null),
    );
    useWorkspaceStore.setState({ root: "/old", workspaceEpoch: 1, directoryCache: new Map() });

    const refresh = useWorkspaceStore.getState().refreshDirectory("/old");
    useWorkspaceStore.setState({
      root: "/new",
      workspaceEpoch: 2,
      directoryCache: new Map([["/new", []]]),
    });
    deferred.resolve([
      {
        name: "stale.md",
        path: "/old/stale.md",
        is_dir: false,
        is_markdown: true,
        modified_at: 0,
      },
    ]);
    await refresh;

    const cache = useWorkspaceStore.getState().directoryCache;
    expect(cache.has("/old")).toBe(false);
    expect(cache.has("/new")).toBe(true);
  });

  test("ensureDirectoryExpanded refreshes a directory without collapsing it", async () => {
    const freshEntry = {
      name: "fresh.md",
      path: "/test/dir/fresh.md",
      is_dir: false,
      is_markdown: true,
      modified_at: 0,
    };
    mockedInvoke.mockResolvedValue([freshEntry]);
    useWorkspaceStore.setState({
      root: "/test",
      workspaceEpoch: 1,
      directoryCache: new Map([["/test/dir", []]]),
      expandedDirs: new Set(["/test/dir"]),
    });

    await useWorkspaceStore.getState().ensureDirectoryExpanded("/test/dir");

    expect(useWorkspaceStore.getState().directoryCache.get("/test/dir")).toEqual([freshEntry]);
    expect(useWorkspaceStore.getState().expandedDirs).toEqual(new Set(["/test/dir"]));
  });

  test("ensureDirectoryExpanded ignores a response after the workspace changes", async () => {
    const deferred = createDeferred<
      Array<{
        name: string;
        path: string;
        is_dir: boolean;
        is_markdown: boolean;
        modified_at: number;
      }>
    >();
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "read_directory" ? deferred.promise : Promise.resolve(null),
    );
    useWorkspaceStore.setState({
      root: "/old",
      workspaceEpoch: 1,
      directoryCache: new Map(),
      expandedDirs: new Set(),
    });

    const ensureExpanded = useWorkspaceStore.getState().ensureDirectoryExpanded("/old/folder");
    useWorkspaceStore.setState({
      root: "/new",
      workspaceEpoch: 2,
      directoryCache: new Map([["/new", []]]),
      expandedDirs: new Set(["/new/kept"]),
    });
    deferred.resolve([
      {
        name: "stale.md",
        path: "/old/folder/stale.md",
        is_dir: false,
        is_markdown: true,
        modified_at: 0,
      },
    ]);
    await ensureExpanded;

    const state = useWorkspaceStore.getState();
    expect(state.directoryCache.has("/old/folder")).toBe(false);
    expect(state.directoryCache.has("/new")).toBe(true);
    expect(state.expandedDirs).toEqual(new Set(["/new/kept"]));
  });

  test("invalidatePath removes from cache", () => {
    useWorkspaceStore.setState({
      directoryCache: new Map([
        [
          "/test",
          [{ name: "a.md", path: "/test/a.md", is_dir: false, is_markdown: true, modified_at: 0 }],
        ],
      ]),
    });

    useWorkspaceStore.getState().invalidatePath("/test");
    expect(useWorkspaceStore.getState().directoryCache.has("/test")).toBe(false);
  });

  test("togglePinnedFile adds and removes workspace file paths", () => {
    useWorkspaceStore.setState({ root: "/test", pinnedFiles: [] });

    useWorkspaceStore.getState().togglePinnedFile("/test/a.md");
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual(["/test/a.md"]);

    useWorkspaceStore.getState().togglePinnedFile("/test/a.md");
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([]);
  });

  test("togglePinnedFile ignores paths outside the workspace", () => {
    useWorkspaceStore.setState({ root: "/test", pinnedFiles: [] });

    useWorkspaceStore.getState().togglePinnedFile("/elsewhere/a.md");

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([]);
  });

  test("rewritePinnedPath updates pinned files below renamed folders", () => {
    useWorkspaceStore.setState({
      root: "/test",
      pinnedFiles: ["/test/old/a.md", "/test/old/nested/b.md", "/test/keep.md"],
    });

    useWorkspaceStore.getState().rewritePinnedPath("/test/old", "/test/new");

    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([
      "/test/new/a.md",
      "/test/new/nested/b.md",
      "/test/keep.md",
    ]);
  });
});

describe("editor-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });
    useWorkspaceStore.setState({ chromeMode: "workspace" });
  });

  test("openFile loads file and sets active", async () => {
    mockedInvoke.mockResolvedValue({
      path: "/test/file.md",
      content: "Hello",
      modified_at: 1000,
    });

    await useEditorStore.getState().openFile("/test/file.md");

    const state = useEditorStore.getState();
    expect(state.activeFilePath).toBe("/test/file.md");
    expect(tabPaths()).toEqual(["/test/file.md"]);
    expect(state.openFiles.get("/test/file.md")?.content).toBe("Hello");
  });

  test("openFile derives title from frontmatter and preserves the body verbatim", async () => {
    mockedInvoke.mockResolvedValue({
      path: "/test/file.md",
      content: "---\ntitle: Hello\n---\n\n# Hello\n\nBody",
      modified_at: 1000,
    });

    await useEditorStore.getState().openFile("/test/file.md");

    const file = useEditorStore.getState().openFiles.get("/test/file.md");
    expect(file?.title).toBe("Hello");
    expect(file?.titleSource).toBe("frontmatter");
    expect(file?.content).toBe("\n# Hello\n\nBody");
  });

  test("updateFrontmatter(path, null) unmounts the frontmatter panel, dirties the file, and re-infers title", async () => {
    mockedInvoke.mockResolvedValue({
      path: "/test/file.md",
      content: "---\ntitle: Hello\n---\n\n# From Body\n\nBody",
      modified_at: 1000,
    });
    await useEditorStore.getState().openFile("/test/file.md");

    useEditorStore.getState().updateFrontmatter("/test/file.md", null);

    const file = useEditorStore.getState().openFiles.get("/test/file.md");
    expect(file?.frontmatter).toBeNull();
    expect(file?.isDirty).toBe(true);
    // Title now falls back to the first H1 in the body since the frontmatter title is gone.
    expect(file?.title).toBe("From Body");
    expect(file?.titleSource).toBe("h1");
  });

  test("openNewTab appends and activates a launcher tab", () => {
    useEditorStore.getState().openNewTab();

    const state = useEditorStore.getState();
    expect(state.tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
    expect(state.activeFilePath).toBeNull();
  });

  test("ensureLauncherTab creates a launcher when no restored tabs exist", () => {
    useEditorStore.getState().ensureLauncherTab();

    const state = useEditorStore.getState();
    expect(state.tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
    expect(state.activeFilePath).toBeNull();
  });

  test("closeFile removes and activates previous tab", async () => {
    mockedInvoke
      .mockResolvedValueOnce({
        path: "/a.md",
        content: "a",
        modified_at: 1,
      })
      .mockResolvedValueOnce({
        path: "/b.md",
        content: "b",
        modified_at: 2,
      });

    await useEditorStore.getState().openFile("/a.md");
    await useEditorStore.getState().openFileInNewTab("/b.md");

    useEditorStore.getState().closeFile("/b.md");

    const state = useEditorStore.getState();
    expect(tabPaths()).toEqual(["/a.md"]);
    expect(state.activeFilePath).toBe("/a.md");
    expect(state.openFiles.has("/b.md")).toBe(false);
  });

  test("closing the last tab recreates a launcher tab", async () => {
    mockedInvoke.mockResolvedValue({ path: "/a.md", content: "a", modified_at: 1 });

    await useEditorStore.getState().openFile("/a.md");
    useEditorStore.getState().closeTab(useEditorStore.getState().activeTabId!);

    const state = useEditorStore.getState();
    expect(state.tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
    expect(state.activeFilePath).toBeNull();
    expect(state.openFiles.size).toBe(0);
  });

  test("navigateToFile updates active tab history", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/b.md", content: "b", modified_at: 2 });

    await useEditorStore.getState().openFile("/a.md");
    await useEditorStore.getState().navigateToFile("/b.md");

    const [tab] = useEditorStore.getState().tabs;
    expect(tab).toMatchObject({
      location: { kind: "file", path: "/b.md" },
      back: [{ kind: "file", path: "/a.md" }],
      forward: [],
    });
  });

  test("navigateBack and navigateForward use tab-local history", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/b.md", content: "b", modified_at: 2 });

    await useEditorStore.getState().openFile("/a.md");
    await useEditorStore.getState().navigateToFile("/b.md");
    await useEditorStore.getState().navigateBack();

    let [tab] = useEditorStore.getState().tabs;
    expect(tab).toMatchObject({
      location: { kind: "file", path: "/a.md" },
      forward: [{ kind: "file", path: "/b.md" }],
    });

    await useEditorStore.getState().navigateForward();

    [tab] = useEditorStore.getState().tabs;
    expect(tab).toMatchObject({
      location: { kind: "file", path: "/b.md" },
      back: [{ kind: "file", path: "/a.md" }],
    });
  });

  test("opening a file while a launcher tab is active reuses that tab id", async () => {
    mockedInvoke.mockResolvedValue({ path: "/a.md", content: "a", modified_at: 1 });

    useEditorStore.getState().openNewTab();
    const launcherTabId = useEditorStore.getState().activeTabId;

    await useEditorStore.getState().openFile("/a.md");

    const [tab] = useEditorStore.getState().tabs;
    expect(tab).toMatchObject({
      id: launcherTabId,
      location: { kind: "file", path: "/a.md" },
    });
    expect(useEditorStore.getState().activeTabId).toBe(launcherTabId);
  });

  test("opening an already-open file from a launcher tab creates a duplicate file tab", async () => {
    mockedInvoke.mockResolvedValue({ path: "/a.md", content: "a", modified_at: 1 });

    await useEditorStore.getState().openFile("/a.md");
    useEditorStore.getState().openNewTab();

    await useEditorStore.getState().openFile("/a.md");

    expect(tabPaths()).toEqual(["/a.md", "/a.md"]);
  });

  test("navigateToFile is a no-op on launcher tabs until a file is chosen", async () => {
    useEditorStore.getState().openNewTab();

    await useEditorStore.getState().navigateBack();
    await useEditorStore.getState().navigateForward();

    expect(useEditorStore.getState().tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
    expect(useEditorStore.getState().activeFilePath).toBeNull();
  });

  test("setActiveFile switches active file", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/b.md", content: "b", modified_at: 2 });

    await useEditorStore.getState().openFile("/a.md");
    await useEditorStore.getState().openFileInNewTab("/b.md");

    useEditorStore.getState().setActiveFile("/a.md");
    expect(useEditorStore.getState().activeFilePath).toBe("/a.md");
  });

  test("updateContent marks file as dirty", async () => {
    mockedInvoke.mockResolvedValue({
      path: "/test.md",
      content: "original",
      modified_at: 1,
    });

    await useEditorStore.getState().openFile("/test.md");
    useEditorStore.getState().updateContent("/test.md", "modified");

    const file = useEditorStore.getState().openFiles.get("/test.md");
    expect(file?.isDirty).toBe(true);
    expect(file?.content).toBe("modified");
  });

  test("markSaved clears dirty flag", async () => {
    mockedInvoke.mockResolvedValue({
      path: "/test.md",
      content: "original",
      modified_at: 1,
    });

    await useEditorStore.getState().openFile("/test.md");
    useEditorStore.getState().updateContent("/test.md", "modified");
    useEditorStore.getState().markSaved("/test.md", "modified");

    const file = useEditorStore.getState().openFiles.get("/test.md");
    expect(file?.isDirty).toBe(false);
    expect(file?.diskContent).toBe("modified");
  });

  test("markSaved with shorter content clamps cursorPos", async () => {
    mockedInvoke.mockResolvedValue({
      path: "/test.md",
      content: "a]".repeat(50), // 100 chars
      modified_at: 1,
    });

    await useEditorStore.getState().openFile("/test.md");
    // Simulate cursor at position 80
    useEditorStore.getState().updateCursorPos("/test.md", 80);

    // External modification makes file shorter (20 chars)
    useEditorStore.getState().markSaved("/test.md", "short content here!!");

    const file = useEditorStore.getState().openFiles.get("/test.md");
    // cursorPos must be clamped to new content length
    expect(file?.cursorPos).toBeLessThanOrEqual(file!.content.length);
  });

  test("stale cursorPos is clamped on tab switch", async () => {
    mockedInvoke.mockResolvedValue({
      path: "/test.md",
      content: "a".repeat(100),
      modified_at: 1,
    });

    await useEditorStore.getState().openFile("/test.md");
    useEditorStore.getState().updateCursorPos("/test.md", 80);

    // Simulate external modification making file much shorter
    useEditorStore.getState().markSaved("/test.md", "short");

    const file = useEditorStore.getState().openFiles.get("/test.md")!;
    expect(file.cursorPos).toBeLessThanOrEqual(file.content.length);
  });

  test("session snapshots omit launcher tabs", async () => {
    mockedInvoke.mockResolvedValue({ path: "/a.md", content: "a", modified_at: 1 });

    await useEditorStore.getState().openFile("/a.md");
    useEditorStore.getState().openNewTab();

    const snapshot = getEditorSessionSnapshot(useEditorStore.getState());
    expect(snapshot.tabs).toEqual([
      { location: { kind: "file", path: "/a.md" }, back: [], forward: [] },
    ]);
    expect(snapshot.activeIndex).toBeNull();
  });

  test("openFileInNewTab always creates a fresh tab even when the file is already open", async () => {
    mockedInvoke.mockResolvedValue({ path: "/a.md", content: "a", modified_at: 1 });

    await useEditorStore.getState().openFile("/a.md");
    expect(tabPaths()).toEqual(["/a.md"]);

    await useEditorStore.getState().openFileInNewTab("/a.md");

    expect(tabPaths()).toEqual(["/a.md", "/a.md"]);
    // The newly created tab should be active.
    const state = useEditorStore.getState();
    const lastTab = state.tabs[state.tabs.length - 1];
    expect(state.activeTabId).toBe(lastTab.id);
  });

  test("openFileInNewTab removes the temporary tab when loading fails", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("read failed"));

    await expect(useEditorStore.getState().openFileInNewTab("/missing.md")).rejects.toThrow();

    const state = useEditorStore.getState();
    // The failed open should not have left any file tab behind.
    expect(state.tabs.some((tab) => tab.location.kind === "file")).toBe(false);
  });

  test("openCompactFile replaces existing tabs with a single file tab", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/b.md", content: "b", modified_at: 2 })
      .mockResolvedValueOnce({ path: "/c.md", content: "c", modified_at: 3 });

    await useEditorStore.getState().openFile("/a.md");
    await useEditorStore.getState().openFileInNewTab("/b.md");
    await useEditorStore.getState().openCompactFile("/c.md");

    const state = useEditorStore.getState();
    expect(tabPaths()).toEqual(["/c.md"]);
    expect(state.activeFilePath).toBe("/c.md");
    expect(state.openFiles.has("/a.md")).toBe(false);
    expect(state.openFiles.has("/b.md")).toBe(false);
    expect(state.openFiles.get("/c.md")?.content).toBe("c");
  });

  test("removePathReferences closes every tab whose current location matches", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/b.md", content: "b", modified_at: 2 })
      .mockResolvedValueOnce({ path: "/a.md", content: "a", modified_at: 1 });

    await useEditorStore.getState().openFile("/a.md");
    await useEditorStore.getState().openFileInNewTab("/b.md");
    await useEditorStore.getState().openFileInNewTab("/a.md");

    expect(tabPaths()).toEqual(["/a.md", "/b.md", "/a.md"]);

    useEditorStore.getState().removePathReferences("/a.md");

    expect(tabPaths()).toEqual(["/b.md"]);
    expect(useEditorStore.getState().openFiles.has("/a.md")).toBe(false);
  });

  test("removePathReferences strips the path from all remaining histories", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/b.md", content: "b", modified_at: 2 })
      .mockResolvedValueOnce({ path: "/c.md", content: "c", modified_at: 3 });

    await useEditorStore.getState().openFile("/a.md");
    await useEditorStore.getState().navigateToFile("/b.md");
    await useEditorStore.getState().navigateToFile("/c.md");

    let [tab] = useEditorStore.getState().tabs;
    expect(tab).toMatchObject({
      location: { kind: "file", path: "/c.md" },
      back: [
        { kind: "file", path: "/a.md" },
        { kind: "file", path: "/b.md" },
      ],
    });

    useEditorStore.getState().removePathReferences("/b.md");

    [tab] = useEditorStore.getState().tabs;
    expect(tab).toMatchObject({
      location: { kind: "file", path: "/c.md" },
      back: [{ kind: "file", path: "/a.md" }],
      forward: [],
    });
  });

  test("removePathReferences ensures a launcher tab when the last file tab disappears", async () => {
    mockedInvoke.mockResolvedValue({ path: "/a.md", content: "a", modified_at: 1 });

    await useEditorStore.getState().openFile("/a.md");
    useEditorStore.getState().removePathReferences("/a.md");

    const state = useEditorStore.getState();
    expect(state.tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
    expect(state.activeFilePath).toBeNull();
    expect(state.openFiles.size).toBe(0);
  });

  test("removePathsWithPrefix closes all tabs whose path starts with prefix", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/ws/dir/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/ws/dir/b.md", content: "b", modified_at: 2 })
      .mockResolvedValueOnce({ path: "/ws/other.md", content: "c", modified_at: 3 });

    await useEditorStore.getState().openFile("/ws/dir/a.md");
    await useEditorStore.getState().openFileInNewTab("/ws/dir/b.md");
    await useEditorStore.getState().openFileInNewTab("/ws/other.md");

    expect(tabPaths()).toEqual(["/ws/dir/a.md", "/ws/dir/b.md", "/ws/other.md"]);

    useEditorStore.getState().removePathsWithPrefix("/ws/dir");

    expect(tabPaths()).toEqual(["/ws/other.md"]);
    expect(useEditorStore.getState().openFiles.has("/ws/dir/a.md")).toBe(false);
    expect(useEditorStore.getState().openFiles.has("/ws/dir/b.md")).toBe(false);
    expect(useEditorStore.getState().openFiles.has("/ws/other.md")).toBe(true);
  });

  test("removePathsWithPrefix strips matching paths from remaining histories", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/ws/dir/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/ws/dir/b.md", content: "b", modified_at: 2 })
      .mockResolvedValueOnce({ path: "/ws/other.md", content: "c", modified_at: 3 });

    await useEditorStore.getState().openFile("/ws/dir/a.md");
    await useEditorStore.getState().navigateToFile("/ws/dir/b.md");
    await useEditorStore.getState().navigateToFile("/ws/other.md");

    // Tab has back history: [/ws/dir/a.md, /ws/dir/b.md]
    useEditorStore.getState().removePathsWithPrefix("/ws/dir");

    const [tab] = useEditorStore.getState().tabs;
    expect(tab).toMatchObject({
      location: { kind: "file", path: "/ws/other.md" },
      back: [],
    });
  });

  test("removePathsWithPrefix does not match sibling prefixes", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/ws/notes/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({
        path: "/ws/notes-archive/b.md",
        content: "b",
        modified_at: 2,
      });

    await useEditorStore.getState().openFile("/ws/notes/a.md");
    await useEditorStore.getState().openFileInNewTab("/ws/notes-archive/b.md");

    useEditorStore.getState().removePathsWithPrefix("/ws/notes");

    expect(tabPaths()).toEqual(["/ws/notes-archive/b.md"]);
  });

  test("removePathsWithPrefix ensures launcher tab when all tabs removed", async () => {
    mockedInvoke.mockResolvedValue({ path: "/ws/dir/a.md", content: "a", modified_at: 1 });

    await useEditorStore.getState().openFile("/ws/dir/a.md");
    useEditorStore.getState().removePathsWithPrefix("/ws/dir");

    const state = useEditorStore.getState();
    expect(state.tabs).toEqual([
      { id: expect.any(String), location: { kind: "launcher" }, back: [], forward: [] },
    ]);
  });

  test("rewritePathPrefix rewrites location, history, and openFiles keys", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/ws/old/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({ path: "/ws/old/b.md", content: "b", modified_at: 2 })
      .mockResolvedValueOnce({ path: "/ws/other.md", content: "c", modified_at: 3 });

    await useEditorStore.getState().openFile("/ws/old/a.md");
    await useEditorStore.getState().navigateToFile("/ws/old/b.md");

    // Open a second tab for an unrelated file
    await useEditorStore.getState().openFileInNewTab("/ws/other.md");

    useEditorStore.getState().rewritePathPrefix("/ws/old", "/ws/new");

    const state = useEditorStore.getState();
    const fileTabs = state.tabs.filter((t) => t.location.kind === "file");

    // First tab should have rewritten paths
    expect(fileTabs[0]).toMatchObject({
      location: { kind: "file", path: "/ws/new/b.md" },
      back: [{ kind: "file", path: "/ws/new/a.md" }],
    });

    // Second tab is unchanged
    expect(fileTabs[1]).toMatchObject({
      location: { kind: "file", path: "/ws/other.md" },
    });

    // openFiles keys should be rewritten
    expect(state.openFiles.has("/ws/new/a.md")).toBe(true);
    expect(state.openFiles.has("/ws/new/b.md")).toBe(true);
    expect(state.openFiles.has("/ws/old/a.md")).toBe(false);
    expect(state.openFiles.has("/ws/old/b.md")).toBe(false);

    // Rewritten files should have updated path field
    expect(state.openFiles.get("/ws/new/a.md")?.path).toBe("/ws/new/a.md");
  });

  test("rewritePathPrefix does not match sibling prefixes", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ path: "/ws/notes/a.md", content: "a", modified_at: 1 })
      .mockResolvedValueOnce({
        path: "/ws/notes-archive/b.md",
        content: "b",
        modified_at: 2,
      });

    await useEditorStore.getState().openFile("/ws/notes/a.md");
    await useEditorStore.getState().openFileInNewTab("/ws/notes-archive/b.md");

    useEditorStore.getState().rewritePathPrefix("/ws/notes", "/ws/renamed");

    expect(tabPaths()).toEqual(["/ws/renamed/a.md", "/ws/notes-archive/b.md"]);
  });
});

describe("workspace-store rewriteExpandedDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      root: "/ws",
      directoryCache: new Map([
        ["/ws", []],
        ["/ws/dir", []],
        ["/ws/dir/sub", []],
      ]),
      expandedDirs: new Set(["/ws/dir", "/ws/dir/sub"]),
    });
  });

  test("rewrites the folder and its expanded children", () => {
    useWorkspaceStore.getState().rewriteExpandedDir("/ws/dir", "/ws/renamed");

    const expanded = useWorkspaceStore.getState().expandedDirs;
    expect(expanded.has("/ws/dir")).toBe(false);
    expect(expanded.has("/ws/dir/sub")).toBe(false);
    expect(expanded.has("/ws/renamed")).toBe(true);
    expect(expanded.has("/ws/renamed/sub")).toBe(true);
  });

  test("rekeys directory cache entries", () => {
    useWorkspaceStore.getState().rewriteExpandedDir("/ws/dir", "/ws/renamed");

    const cache = useWorkspaceStore.getState().directoryCache;
    expect(cache.has("/ws/dir")).toBe(false);
    expect(cache.has("/ws/dir/sub")).toBe(false);
    expect(cache.has("/ws/renamed")).toBe(true);
    expect(cache.has("/ws/renamed/sub")).toBe(true);
    // Root entry should be unchanged
    expect(cache.has("/ws")).toBe(true);
  });

  test("is a no-op when the folder is not expanded", () => {
    useWorkspaceStore.setState({
      expandedDirs: new Set(["/ws/other"]),
    });

    useWorkspaceStore.getState().rewriteExpandedDir("/ws/dir", "/ws/renamed");

    expect(useWorkspaceStore.getState().expandedDirs.has("/ws/other")).toBe(true);
    expect(useWorkspaceStore.getState().expandedDirs.size).toBe(1);
  });
});

describe("ui-store", () => {
  beforeEach(() => {
    useUIStore.setState({
      isCommandPaletteOpen: false,
      commandPaletteIntent: "search",
      commandPaletteSearch: "",
      commandPaletteSession: 0,
    });

    useSettingsStore.setState({
      settings: {
        "appearance.sidebar-visible": true,
        "appearance.theme": "system",
      },
      isLoaded: true,
    });
  });

  test("toggleSidebar toggles collapsed state", () => {
    mockedInvoke.mockResolvedValue(undefined);

    toggleSidebar();
    expect(useSettingsStore.getState().settings["appearance.sidebar-visible"]).toBe(false);

    toggleSidebar();
    expect(useSettingsStore.getState().settings["appearance.sidebar-visible"]).toBe(true);
  });

  test("openCommandPalette and closeCommandPalette", () => {
    useUIStore.getState().openCommandPalette();
    expect(useUIStore.getState().isCommandPaletteOpen).toBe(true);
    expect(useUIStore.getState().commandPaletteIntent).toBe("search");
    expect(useUIStore.getState().commandPaletteSession).toBe(1);

    useUIStore.getState().openCommandPalette("create-file");
    expect(useUIStore.getState().commandPaletteIntent).toBe("create-file");
    expect(useUIStore.getState().commandPaletteSession).toBe(2);

    useUIStore.getState().closeCommandPalette();
    expect(useUIStore.getState().isCommandPaletteOpen).toBe(false);
    expect(useUIStore.getState().commandPaletteIntent).toBe("search");
  });

  test("closeCommandPalette resets commandPaletteSearch", () => {
    useUIStore.getState().setCommandPaletteSearch("hello");
    expect(useUIStore.getState().commandPaletteSearch).toBe("hello");

    useUIStore.getState().closeCommandPalette();
    expect(useUIStore.getState().commandPaletteSearch).toBe("");
  });

  test("toggleTheme cycles system→light→dark→system", () => {
    mockedInvoke.mockResolvedValue(undefined);

    toggleTheme();
    expect(useSettingsStore.getState().settings["appearance.theme"]).toBe("light");

    toggleTheme();
    expect(useSettingsStore.getState().settings["appearance.theme"]).toBe("dark");

    toggleTheme();
    expect(useSettingsStore.getState().settings["appearance.theme"]).toBe("system");
  });
});

describe("workspace-store removeRecentWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      root: null,
      chromeMode: "workspace",
      directoryCache: new Map(),
      expandedDirs: new Set(),
      recentWorkspaces: ["/a", "/b", "/c"],
    });
  });

  test("removeRecentWorkspace removes entry", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await useWorkspaceStore.getState().removeRecentWorkspace("/b");
    expect(useWorkspaceStore.getState().recentWorkspaces).toEqual(["/a", "/c"]);
  });
});

describe("workspace-store isStartupResolved", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ isStartupResolved: false });
  });

  test("isStartupResolved starts as false", () => {
    expect(useWorkspaceStore.getState().isStartupResolved).toBe(false);
  });

  test("setStartupResolved sets it to true", () => {
    useWorkspaceStore.getState().setStartupResolved();
    expect(useWorkspaceStore.getState().isStartupResolved).toBe(true);
  });
});

describe("workspace-store restoreFromBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      root: null,
      chromeMode: "workspace",
      directoryCache: new Map(),
      expandedDirs: new Set(),
      pinnedFiles: [],
      sidebarMetadataVersion: 0,
      recentWorkspaces: [],
      fileCount: 0,
    });
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });
  });

  test("workspace+file restore stays in workspace chrome and opens the file as a tab", async () => {
    mockedInvoke.mockResolvedValue({ path: "/ws/a.md", content: "a", modified_at: 1 });

    await useWorkspaceStore.getState().restoreFromBundle({
      workspace: { root: "/ws", name: "ws", file_count: 1 },
      entries: [],
      recent_workspaces: ["/ws"],
      session: null,
      active_file: null,
      open_file: "/ws/a.md",
    });

    expect(useWorkspaceStore.getState().chromeMode).toBe("workspace");
    expect(useWorkspaceStore.getState().root).toBe("/ws");
    await vi.waitFor(() => {
      expect(tabPaths()).toEqual(["/ws/a.md"]);
    });
  });
});

describe("handleOpenPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      root: "/ws",
      chromeMode: "workspace",
      directoryCache: new Map(),
      expandedDirs: new Set(),
      pinnedFiles: [],
      sidebarMetadataVersion: 0,
      recentWorkspaces: [],
      fileCount: 0,
    });
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });
  });

  test("same-workspace file payload keeps normal workspace chrome", async () => {
    mockedInvoke.mockResolvedValue({ path: "/ws/a.md", content: "a", modified_at: 1 });

    await handleOpenPayload({ workspace: "/ws", file: "/ws/a.md" });

    expect(useWorkspaceStore.getState().chromeMode).toBe("workspace");
    expect(tabPaths()).toEqual(["/ws/a.md"]);
  });

  test("file-only payload on a workspace window opens a standalone window", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await handleOpenPayload({ workspace: null, file: "/anywhere/note.md" });

    expect(mockedInvoke).toHaveBeenCalledWith("open_file_in_standalone_window", {
      path: "/anywhere/note.md",
    });
    expect(useWorkspaceStore.getState().chromeMode).toBe("workspace");
    expect(tabPaths()).toEqual([]);
  });

  test("file-only payload on a rootless window enters compact mode and watches the file", async () => {
    mockedInvoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === "read_file"
          ? { path: "/anywhere/note.md", content: "n", modified_at: 1 }
          : undefined,
      ),
    );
    useWorkspaceStore.setState({ root: null });

    await handleOpenPayload({ workspace: null, file: "/anywhere/note.md" });

    expect(useWorkspaceStore.getState().chromeMode).toBe("compact-file");
    expect(tabPaths()).toEqual(["/anywhere/note.md"]);
    expect(mockedInvoke).toHaveBeenCalledWith("watch_standalone_file", {
      path: "/anywhere/note.md",
    });
  });

  test("navigating to a linked file in a compact window re-points the watcher", async () => {
    mockedInvoke.mockImplementation((command, args) =>
      Promise.resolve(
        command === "read_file"
          ? { path: (args as { path?: string })?.path, content: "n", modified_at: 1 }
          : undefined,
      ),
    );
    useWorkspaceStore.setState({ root: null });

    // Open the first standalone file, then follow an internal link to another.
    await handleOpenPayload({ workspace: null, file: "/anywhere/a.md" });
    await useEditorStore.getState().navigateToFile("/anywhere/b.md");

    expect(useWorkspaceStore.getState().chromeMode).toBe("compact-file");
    expect(tabPaths()).toEqual(["/anywhere/b.md"]);
    expect(mockedInvoke).toHaveBeenCalledWith("watch_standalone_file", {
      path: "/anywhere/b.md",
    });
  });

  test("folder payload on a standalone compact window opens a new workspace window", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    useWorkspaceStore.setState({ root: null, chromeMode: "compact-file" });

    await handleOpenPayload({ workspace: "/other", file: null });

    expect(mockedInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      path: "/other",
      file: null,
    });
    expect(useWorkspaceStore.getState().chromeMode).toBe("compact-file");
    expect(useWorkspaceStore.getState().root).toBeNull();
  });

  test("different workspace payload delegates to a new window", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await handleOpenPayload({ workspace: "/other", file: "/other/a.md" });

    expect(mockedInvoke).toHaveBeenCalledWith("open_workspace_in_new_window", {
      path: "/other",
      file: "/other/a.md",
    });
    expect(useWorkspaceStore.getState().root).toBe("/ws");
  });
});

describe("createPendingOpenDrainer", () => {
  test("drains queued payloads in order", async () => {
    const queue = [
      { workspace: "/a", file: null },
      { workspace: "/b", file: "/b/note.md" },
    ];
    const handled: Array<{ workspace: string; file: string | null }> = [];
    const drainPendingOpens = createPendingOpenDrainer(
      async () => queue.shift() ?? null,
      async (payload) => {
        handled.push(payload);
      },
    );

    await drainPendingOpens();

    expect(handled).toEqual([
      { workspace: "/a", file: null },
      { workspace: "/b", file: "/b/note.md" },
    ]);
  });

  test("re-runs when another drain is requested mid-flight", async () => {
    type TestPayload = { workspace: string; file: null };

    const queue = [{ workspace: "/a", file: null }];
    const handled: string[] = [];
    let nextPollStarted: (() => void) | null = null;
    let blockOnEmpty = true;
    const nextPollResponse = createDeferred<TestPayload | null>();

    const takePendingOpen = vi.fn(async () => {
      if (queue.length > 0) {
        return queue.shift() ?? null;
      }

      if (!blockOnEmpty) {
        return null;
      }

      blockOnEmpty = false;

      nextPollStarted?.();

      return await nextPollResponse.promise;
    });

    const nextPoll = new Promise<void>((resolve) => {
      nextPollStarted = resolve;
    });

    let drainPendingOpens!: () => Promise<void>;
    drainPendingOpens = createPendingOpenDrainer(takePendingOpen, async (payload) => {
      handled.push(payload.workspace);
    });

    const firstDrain = drainPendingOpens();
    await nextPoll;

    queue.push({ workspace: "/b", file: null });
    const secondDrain = drainPendingOpens();
    nextPollResponse.resolve(null);

    await firstDrain;
    await secondDrain;

    expect(handled).toEqual(["/a", "/b"]);
    expect(takePendingOpen).toHaveBeenCalledTimes(4);
  });

  test("continues draining after a failed payload", async () => {
    const queue = [
      { workspace: "/broken", file: null },
      { workspace: "/ok", file: null },
    ];
    const handled: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const drainPendingOpens = createPendingOpenDrainer(
      async () => queue.shift() ?? null,
      async (payload) => {
        if (payload.workspace === "/broken") {
          throw new Error("boom");
        }
        handled.push(payload.workspace);
      },
    );

    await drainPendingOpens();

    expect(handled).toEqual(["/ok"]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("workspace-store closeWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedInvoke.mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      root: "/test",
      chromeMode: "workspace",
      isIndexing: true,
      directoryCache: new Map([["/test", []]]),
      expandedDirs: new Set(["/test/dir"]),
      recentWorkspaces: ["/test"],
    });
    useEditorStore.setState({
      openFiles: new Map([
        [
          "/test/a.md",
          {
            path: "/test/a.md",
            frontmatter: null,
            content: "a",
            title: "",
            titleSource: "none",
            diskContent: "a",
            isDirty: false,
            isLoading: false,
            saveError: null,
            reloadVersion: 0,
            scrollPos: 0,
            cursorPos: 0,
            displayDate: null,
            stats: { words: 0, characters: 0, paragraphs: 0 },
          },
        ],
      ]),
      tabs: [makeFileTab("tab-a", "/test/a.md")],
      activeTabId: "tab-a",
      activeFilePath: "/test/a.md",
    });
  });

  test("closeWorkspace resets workspace and editor state", () => {
    useWorkspaceStore.getState().closeWorkspace();

    const ws = useWorkspaceStore.getState();
    expect(ws.root).toBeNull();
    expect(ws.directoryCache.size).toBe(0);
    expect(ws.expandedDirs.size).toBe(0);
    expect(ws.isIndexing).toBe(false);

    const ed = useEditorStore.getState();
    expect(ed.openFiles.size).toBe(0);
    expect(ed.activeFilePath).toBeNull();
    expect(ed.tabs).toEqual([]);
  });

  test("closeWorkspace is no-op when no workspace is open", () => {
    useWorkspaceStore.setState({ root: null });
    useWorkspaceStore.getState().closeWorkspace();
    expect(useWorkspaceStore.getState().root).toBeNull();
  });
});
