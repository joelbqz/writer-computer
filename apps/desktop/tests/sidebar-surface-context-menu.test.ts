import { describe, expect, test, vi } from "vite-plus/test";

// The Tauri menu modules pull in `@tauri-apps/api/core` at import time, so we
// stub them up front. The pure helper under test
// (`buildSidebarSurfaceMenuItemsSpec`) never touches these stubs.
const nativeMenuMocks = vi.hoisted(() => ({
  menuNew: vi.fn(),
  checkItemNew: vi.fn(),
  itemNew: vi.fn(),
  predefinedItemNew: vi.fn(),
}));
vi.mock("@tauri-apps/api/menu/menu", () => ({ Menu: { new: nativeMenuMocks.menuNew } }));
vi.mock("@tauri-apps/api/menu/checkMenuItem", () => ({
  CheckMenuItem: { new: nativeMenuMocks.checkItemNew },
}));
vi.mock("@tauri-apps/api/menu/menuItem", () => ({
  MenuItem: { new: nativeMenuMocks.itemNew },
}));
vi.mock("@tauri-apps/api/menu/predefinedMenuItem", () => ({
  PredefinedMenuItem: { new: nativeMenuMocks.predefinedItemNew },
}));

import {
  buildSidebarSurfaceMenuItemsSpec,
  showSidebarSurfaceContextMenu,
  type SidebarSurfaceMenuState,
} from "../src/components/sidebar/sidebar-surface-context-menu";

function makeState(
  showSearch: boolean,
  showRecents: boolean,
): SidebarSurfaceMenuState & { actions: string[]; toggles: Array<[string, boolean]> } {
  const toggles: Array<[string, boolean]> = [];
  const actions: string[] = [];
  return {
    actions,
    toggles,
    showSearch,
    showRecents,
    onNewFile: () => actions.push("new-file"),
    onNewFolder: () => actions.push("new-folder"),
    onToggleSearch: (visible) => toggles.push(["search", visible]),
    onToggleRecents: (visible) => toggles.push(["recents", visible]),
  };
}

describe("buildSidebarSurfaceMenuItemsSpec", () => {
  test("lists root actions before both visibility toggles", () => {
    const spec = buildSidebarSurfaceMenuItemsSpec(makeState(true, false));

    expect(
      spec.map((entry) =>
        entry.kind === "separator"
          ? "---"
          : `${entry.kind}:${entry.id}:${entry.text}${entry.kind === "check" ? `:${entry.checked}` : ""}`,
      ),
    ).toEqual([
      "item:new-file:New File",
      "item:new-folder:New Folder",
      "---",
      "check:toggle-search:Search:true",
      "check:toggle-recents:Recents:false",
    ]);
  });

  test("actions dispatch and toggles flip the current visibility", () => {
    const state = makeState(true, false);

    const spec = buildSidebarSurfaceMenuItemsSpec(state);
    for (const entry of spec) {
      if (entry.kind !== "separator") entry.action();
    }

    expect(state.actions).toEqual(["new-file", "new-folder"]);
    expect(state.toggles).toEqual([
      ["search", false],
      ["recents", true],
    ]);
  });

  test("renders each native item kind in order and opens the menu", async () => {
    const nativeItems = {
      file: { type: "file" },
      folder: { type: "folder" },
      separator: { type: "separator" },
      search: { type: "search" },
      recents: { type: "recents" },
    };
    nativeMenuMocks.itemNew
      .mockResolvedValueOnce(nativeItems.file as never)
      .mockResolvedValueOnce(nativeItems.folder as never);
    nativeMenuMocks.predefinedItemNew.mockResolvedValue(nativeItems.separator as never);
    nativeMenuMocks.checkItemNew
      .mockResolvedValueOnce(nativeItems.search as never)
      .mockResolvedValueOnce(nativeItems.recents as never);
    const popup = vi.fn().mockResolvedValue(undefined);
    nativeMenuMocks.menuNew.mockResolvedValue({ popup } as never);

    const state = makeState(true, false);
    await showSidebarSurfaceContextMenu(state);

    expect(nativeMenuMocks.itemNew).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "new-file", text: "New File", action: expect.any(Function) }),
    );
    expect(nativeMenuMocks.itemNew).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "new-folder",
        text: "New Folder",
        action: expect.any(Function),
      }),
    );
    expect(nativeMenuMocks.predefinedItemNew).toHaveBeenCalledWith({ item: "Separator" });
    expect(nativeMenuMocks.checkItemNew).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "toggle-search", checked: true }),
    );
    expect(nativeMenuMocks.checkItemNew).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "toggle-recents", checked: false }),
    );
    expect(nativeMenuMocks.menuNew).toHaveBeenCalledWith({
      items: [
        nativeItems.file,
        nativeItems.folder,
        nativeItems.separator,
        nativeItems.search,
        nativeItems.recents,
      ],
    });
    expect(popup).toHaveBeenCalledOnce();
  });
});
