import { useRef } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import * as tauri from "@/lib/tauri";
import {
  showNativeContextMenu,
  type MenuItemSpec,
} from "@/components/editor-area/editor-context-menu";

function getFolderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function WorkspaceSwitcher() {
  const { root, recentWorkspaces, openWorkspace, closeWorkspace } = useWorkspace();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const workspaceName = root ? getFolderName(root) : "No Workspace";

  async function handleOpenFolder() {
    const picked = await tauri.pickWorkspace();
    if (picked) {
      await openWorkspace(picked);
    }
  }

  async function showMenu() {
    const others = recentWorkspaces.filter((p) => p !== root);
    const items: MenuItemSpec[] = [];

    for (const path of others) {
      items.push({
        kind: "item",
        id: `switch:${path}`,
        text: getFolderName(path),
        action: () => {
          void openWorkspace(path);
        },
      });
    }
    if (others.length > 0) {
      items.push({ kind: "separator" });
    }
    items.push({
      kind: "item",
      id: "open-folder",
      text: "Open Folder\u2026",
      action: () => {
        void handleOpenFolder();
      },
    });
    if (root) {
      items.push({
        kind: "item",
        id: "close-workspace",
        text: "Close Workspace",
        action: () => {
          closeWorkspace();
        },
      });
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    const itemRowHeight = 22;
    const separatorHeight = 12;
    const verticalPadding = 8;
    const itemCount = items.filter((i) => i.kind !== "separator").length;
    const separatorCount = items.filter((i) => i.kind === "separator").length;
    const estimatedMenuHeight =
      itemCount * itemRowHeight + separatorCount * separatorHeight + verticalPadding;

    const position = rect
      ? { x: Math.round(rect.left), y: Math.round(rect.top - estimatedMenuHeight) }
      : undefined;

    await showNativeContextMenu(items, position);
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => void showMenu()}
      aria-label="Switch workspace"
      className="flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pl-[10px] pr-2 text-left text-[13px] leading-[1.15] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--fg-base)]"
    >
      <span
        className="flex w-5 shrink-0 items-center justify-center text-current"
        aria-hidden="true"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeLinejoin="round">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M8.7071 2.39644C8.31658 2.00592 7.68341 2.00592 7.29289 2.39644L4.46966 5.21966L3.93933 5.74999L4.99999 6.81065L5.53032 6.28032L7.99999 3.81065L10.4697 6.28032L11 6.81065L12.0607 5.74999L11.5303 5.21966L8.7071 2.39644ZM5.53032 9.71966L4.99999 9.18933L3.93933 10.25L4.46966 10.7803L7.29289 13.6035C7.68341 13.9941 8.31658 13.9941 8.7071 13.6035L11.5303 10.7803L12.0607 10.25L11 9.18933L10.4697 9.71966L7.99999 12.1893L5.53032 9.71966Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {workspaceName}
      </span>
    </button>
  );
}
