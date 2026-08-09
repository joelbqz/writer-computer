import { useCallback, useState, type MouseEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useWorkspace } from "@/hooks/use-workspace";
import { useBooleanSetting, useSetting } from "@/hooks/use-settings";
import {
  usePinnedFiles,
  useRefreshDirectory,
  useRemovePinnedFile,
  useTogglePinnedFile,
} from "@/hooks/use-file-tree";
import { useOpenFile } from "@/hooks/use-tabs";
import {
  getOpenFile,
  openFileInNewTab as openFileInNewTabAction,
  removePathReferences,
} from "@/hooks/editor-api";
import {
  SIDEBAR_SECTION_PAGE_SIZE,
  RECENTS_SECTION_PAGE_SIZE,
  usePinnedSidebarFiles,
  useRecentSidebarFiles,
} from "@/hooks/use-sidebar-files";
import * as tauri from "@/lib/tauri";
import { getFileStem, getParentDir, getRelativePath } from "@/lib/paths";
import { duplicateFile } from "./duplicate-file";
import { useMoveEntry } from "./use-move-entry";
import { FileTree } from "./file-tree";
import { FileTreeNode } from "./file-tree-node";
import { showFileContextMenu } from "./file-context-menu";
import { ShowMoreButton, SidebarSection } from "./sidebar-section";
import type { DirEntry } from "@/types/fs";

interface SidebarNavigatorProps {
  openFile?: (path: string) => Promise<void>;
  enableContextMenus?: boolean;
  onOpenFileComplete?: () => void;
  className?: string;
  renamingPath: string | null;
  setRenamingPath: (path: string | null) => void;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot);
}

export function SidebarNavigator({
  openFile: openFileOverride,
  enableContextMenus = true,
  onOpenFileComplete,
  className = "flex flex-col gap-4 py-2",
  renamingPath,
  setRenamingPath,
}: SidebarNavigatorProps) {
  const { root } = useWorkspace();
  const defaultOpenFile = useOpenFile();
  const openFile = openFileOverride ?? defaultOpenFile;
  const refreshDirectory = useRefreshDirectory();
  const fileLabelMode = useSetting("appearance.sidebar-file-label");
  const showRecents = useBooleanSetting("appearance.sidebar-show-recents");
  const pinnedPaths = usePinnedFiles();
  const togglePinnedFile = useTogglePinnedFile();
  const removePinnedFile = useRemovePinnedFile();
  const { applyPathChange } = useMoveEntry();
  const [recentVisibleCount, setRecentVisibleCount] = useState(RECENTS_SECTION_PAGE_SIZE);
  const [pinnedVisibleCount, setPinnedVisibleCount] = useState(SIDEBAR_SECTION_PAGE_SIZE);
  const recentFiles = useRecentSidebarFiles(recentVisibleCount);
  const pinnedEntries = usePinnedSidebarFiles(pinnedVisibleCount);

  const noopToggleDirectory = useCallback(async () => {}, []);
  const openFileAndComplete = useCallback(
    async (path: string) => {
      await openFile(path);
      onOpenFileComplete?.();
    },
    [onOpenFileComplete, openFile],
  );

  const handleRenameFile = useCallback(
    (entry: DirEntry) => {
      if (!enableContextMenus) return;

      void (async () => {
        const currentStem = getFileStem(entry.name);
        const nextValue = window.prompt("Rename file", currentStem);
        const trimmed = nextValue?.trim();
        if (!trimmed || trimmed === currentStem) return;

        const ext = getExtension(entry.name);
        const parent = getParentDir(entry.path);
        const newPath = `${parent}/${trimmed}${ext}`;
        if (newPath === entry.path) return;

        try {
          if (await tauri.fileExists(newPath)) {
            window.alert(`A file named "${trimmed}${ext}" already exists.`);
            return;
          }
          await applyPathChange(entry, newPath);
        } catch (error) {
          window.alert(
            `Failed to rename: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
    },
    [applyPathChange, enableContextMenus],
  );

  const handleFileContextMenu = useCallback(
    (_event: MouseEvent<HTMLElement>, entry: DirEntry) => {
      if (!enableContextMenus || !root) return;
      const parent = getParentDir(entry.path);
      const relative = getRelativePath(entry.path, root);

      void showFileContextMenu({
        isPinned: pinnedPaths.includes(entry.path),
        onOpen: () => {
          void openFileAndComplete(entry.path);
        },
        onOpenInNewTab: () => {
          void openFileInNewTabAction(entry.path).catch((error: unknown) => {
            window.alert(
              `Failed to open in new tab: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        },
        onTogglePin: () => {
          togglePinnedFile(entry.path);
        },
        onDuplicate: () => {
          void (async () => {
            try {
              const newPath = await duplicateFile(entry.path);
              await refreshDirectory(parent);
              await openFileInNewTabAction(newPath);
            } catch (error) {
              window.alert(
                `Failed to duplicate: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          })();
        },
        onCopyRelativePath: () => {
          void writeText(relative);
        },
        onCopyAbsolutePath: () => {
          void writeText(entry.path);
        },
        onReveal: () => {
          void tauri.revealInFileManager(entry.path).catch((error: unknown) => {
            window.alert(
              `Failed to reveal: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        },
        onRename: () => {
          handleRenameFile(entry);
        },
        onDelete: () => {
          void (async () => {
            const openFileState = getOpenFile(entry.path);
            if (openFileState?.isDirty) {
              const confirmed = window.confirm(
                `"${entry.name}" has unsaved changes. Delete anyway?`,
              );
              if (!confirmed) return;
            }
            try {
              await tauri.deleteEntry(entry.path);
              removePathReferences(entry.path);
              removePinnedFile(entry.path);
              await refreshDirectory(parent);
            } catch (error) {
              window.alert(
                `Failed to delete: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          })();
        },
      });
    },
    [
      enableContextMenus,
      handleRenameFile,
      openFileAndComplete,
      pinnedPaths,
      refreshDirectory,
      removePinnedFile,
      root,
      togglePinnedFile,
    ],
  );

  if (!root) {
    return <div className="p-4 text-[13px] text-[var(--text-muted)]">No folder open</div>;
  }

  return (
    <div className={className}>
      {pinnedEntries.files.length > 0 && (
        <SidebarSection title="Pinned">
          <div role="tree" aria-label="Pinned files" className="flex flex-col gap-px">
            {pinnedEntries.files.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                isExpanded={false}
                isRenaming={false}
                isSelected={false}
                onToggleDir={noopToggleDirectory}
                onOpenFile={openFileAndComplete}
                onContextMenu={enableContextMenus ? handleFileContextMenu : undefined}
                fileLabelMode={fileLabelMode}
              />
            ))}
            {pinnedEntries.hasMore && (
              <ShowMoreButton
                onClick={() => setPinnedVisibleCount((count) => count + SIDEBAR_SECTION_PAGE_SIZE)}
              />
            )}
          </div>
        </SidebarSection>
      )}

      {showRecents && recentFiles.files.length > 0 && (
        <SidebarSection title="Recents">
          <div role="tree" aria-label="Recents" className="flex flex-col gap-px">
            {recentFiles.files.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                isExpanded={false}
                isRenaming={false}
                isSelected={false}
                onToggleDir={noopToggleDirectory}
                onOpenFile={openFileAndComplete}
                onContextMenu={enableContextMenus ? handleFileContextMenu : undefined}
                fileLabelMode={fileLabelMode}
              />
            ))}
            {recentFiles.hasMore && (
              <ShowMoreButton
                onClick={() => setRecentVisibleCount((count) => count + RECENTS_SECTION_PAGE_SIZE)}
              />
            )}
          </div>
        </SidebarSection>
      )}

      <SidebarSection title="Everything">
        <FileTree
          rootPath={root}
          openFile={openFileAndComplete}
          enableContextMenus={enableContextMenus}
          renamingPath={renamingPath}
          setRenamingPath={setRenamingPath}
        />
      </SidebarSection>
    </div>
  );
}
