import { Menu } from "@tauri-apps/api/menu/menu";
import { CheckMenuItem } from "@tauri-apps/api/menu/checkMenuItem";
import { MenuItem } from "@tauri-apps/api/menu/menuItem";
import { PredefinedMenuItem } from "@tauri-apps/api/menu/predefinedMenuItem";

export type SidebarSurfaceToggleId = "toggle-search" | "toggle-recents";
export type SidebarSurfaceActionId = "new-file" | "new-folder";

export type SidebarSurfaceMenuItemSpec =
  | { kind: "item"; id: SidebarSurfaceActionId; text: string; action: () => void }
  | {
      kind: "check";
      id: SidebarSurfaceToggleId;
      text: string;
      checked: boolean;
      action: () => void;
    }
  | { kind: "separator" };

export interface SidebarSurfaceMenuState {
  showSearch: boolean;
  showRecents: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onToggleSearch: (visible: boolean) => void;
  onToggleRecents: (visible: boolean) => void;
}

/**
 * Build the check-item entries for the sidebar surface context menu (shown on
 * right-clicking empty sidebar space or section headers). Root creation comes
 * first, then both toggles are always listed (checked = currently visible) so
 * a hidden item can be re-shown from the same menu. Pulled out from
 * `showSidebarSurfaceContextMenu` so it can be unit-tested without the Tauri
 * runtime.
 */
export function buildSidebarSurfaceMenuItemsSpec(
  state: SidebarSurfaceMenuState,
): SidebarSurfaceMenuItemSpec[] {
  return [
    { kind: "item", id: "new-file", text: "New File", action: state.onNewFile },
    { kind: "item", id: "new-folder", text: "New Folder", action: state.onNewFolder },
    { kind: "separator" },
    {
      kind: "check",
      id: "toggle-search",
      text: "Search",
      checked: state.showSearch,
      action: () => state.onToggleSearch(!state.showSearch),
    },
    {
      kind: "check",
      id: "toggle-recents",
      text: "Recents",
      checked: state.showRecents,
      action: () => state.onToggleRecents(!state.showRecents),
    },
  ];
}

/**
 * Build a Tauri native menu of check items and pop it up at the cursor.
 * The menu dismisses through the OS, not via JS.
 */
export async function showSidebarSurfaceContextMenu(state: SidebarSurfaceMenuState): Promise<void> {
  const spec = buildSidebarSurfaceMenuItemsSpec(state);

  const items = await Promise.all(
    spec.map((entry) => {
      if (entry.kind === "separator") {
        return PredefinedMenuItem.new({ item: "Separator" });
      }
      if (entry.kind === "check") {
        return CheckMenuItem.new({
          id: entry.id,
          text: entry.text,
          checked: entry.checked,
          action: entry.action,
        });
      }
      return MenuItem.new({ id: entry.id, text: entry.text, action: entry.action });
    }),
  );

  const menu = await Menu.new({ items });
  await menu.popup();
}
