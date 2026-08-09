import { useCallback } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  getOpenFile,
  getOpenFiles,
  openFileInNewTab as openFileInNewTabAction,
  removePathReferences,
  removePathsWithPrefix,
} from "@/hooks/editor-api";
import { getWorkspaceEpoch, getWorkspaceRoot } from "@/hooks/workspace-api";
import * as tauri from "@/lib/tauri";
import { getFileName, getParentDir, getRelativePath } from "@/lib/paths";
import { duplicateFile } from "./duplicate-file";
import {
  createUntitledSidebarEntry,
  getSidebarCreationErrorMessage,
  type SidebarEntryKind,
} from "./sidebar-entry-creation";
import { showFileContextMenu } from "./file-context-menu";
import { showFolderContextMenu } from "./folder-context-menu";
import { showBulkContextMenu } from "./bulk-context-menu";
import type { DirEntry } from "@/types/fs";

interface UseFileTreeContextMenusArgs {
  openFile: (path: string) => Promise<void>;
  workspaceRoot: string | null;
  pinnedFiles: string[];
  togglePinnedFile: (path: string) => void;
  removePinnedFile: (path: string) => void;
  removePinnedFilesWithPrefix: (prefix: string) => void;
  ensureDirectoryExpanded: (path: string) => Promise<void>;
  refreshDirectory: (path: string) => Promise<void>;
  invalidatePath: (path: string) => void;
  setRenamingPath: (path: string | null) => void;
  clearSelection: () => void;
}

export function useFileTreeContextMenus({
  openFile,
  workspaceRoot,
  pinnedFiles,
  togglePinnedFile,
  removePinnedFile,
  removePinnedFilesWithPrefix,
  ensureDirectoryExpanded,
  refreshDirectory,
  invalidatePath,
  setRenamingPath,
  clearSelection,
}: UseFileTreeContextMenusArgs) {
  const handleFileContextMenu = useCallback(
    (entry: DirEntry) => {
      const parent = getParentDir(entry.path);
      const relative = workspaceRoot ? getRelativePath(entry.path, workspaceRoot) : entry.path;

      void showFileContextMenu({
        isPinned: pinnedFiles.includes(entry.path),
        onOpen: () => {
          void openFile(entry.path);
        },
        onOpenInNewTab: () => {
          void openFileInNewTabAction(entry.path).catch((error: unknown) => {
            window.alert(
              `Failed to open in new tab: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
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
        onTogglePin: () => {
          togglePinnedFile(entry.path);
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
          setRenamingPath(entry.path);
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
      openFile,
      pinnedFiles,
      refreshDirectory,
      removePinnedFile,
      setRenamingPath,
      togglePinnedFile,
      workspaceRoot,
    ],
  );

  const createEntryInFolder = useCallback(
    (entry: DirEntry, kind: SidebarEntryKind) => {
      const activeRoot = workspaceRoot;
      if (!activeRoot) return;
      const activeEpoch = getWorkspaceEpoch();
      const isCurrent = () =>
        getWorkspaceRoot() === activeRoot && getWorkspaceEpoch() === activeEpoch;

      void (async () => {
        try {
          const result = await createUntitledSidebarEntry(entry.path, kind, {
            fileExists: tauri.fileExists,
            createFile: tauri.createFile,
            createFolder: tauri.createDirectory,
            isCurrent,
            revealEntry: () => ensureDirectoryExpanded(entry.path),
            beginRenaming: setRenamingPath,
          });
          if ("followUpFailure" in result) {
            window.alert(
              `Created "${getFileName(result.path)}", but Writer could not update the sidebar: ${getSidebarCreationErrorMessage(result.followUpFailure)}`,
            );
          }
        } catch (error) {
          if (isCurrent()) {
            window.alert(`Failed to create ${kind}: ${getSidebarCreationErrorMessage(error)}`);
          }
        }
      })();
    },
    [ensureDirectoryExpanded, setRenamingPath, workspaceRoot],
  );

  const handleFolderContextMenu = useCallback(
    (entry: DirEntry) => {
      const parent = getParentDir(entry.path);
      const relative = workspaceRoot ? getRelativePath(entry.path, workspaceRoot) : entry.path;

      void showFolderContextMenu({
        onNewFile: () => {
          createEntryInFolder(entry, "file");
        },
        onNewFolder: () => {
          createEntryInFolder(entry, "folder");
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
          setRenamingPath(entry.path);
        },
        onDelete: () => {
          void (async () => {
            // Check if any open files inside this folder are dirty
            const openFiles = getOpenFiles();
            const dirPrefix = `${entry.path}/`;
            let dirtyCount = 0;
            for (const [path, file] of openFiles) {
              if (path.startsWith(dirPrefix) && file.isDirty) {
                dirtyCount += 1;
              }
            }

            if (dirtyCount > 0) {
              const confirmed = window.confirm(
                `"${entry.name}" contains ${dirtyCount} unsaved file${dirtyCount > 1 ? "s" : ""}. Delete anyway?`,
              );
              if (!confirmed) return;
            }

            try {
              await tauri.deleteEntry(entry.path);
              removePathsWithPrefix(entry.path);
              removePinnedFilesWithPrefix(entry.path);
              invalidatePath(entry.path);
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
      createEntryInFolder,
      invalidatePath,
      refreshDirectory,
      removePinnedFilesWithPrefix,
      setRenamingPath,
      workspaceRoot,
    ],
  );

  const handleBulkContextMenu = useCallback(
    (paths: Set<string>) => {
      const pathArray = [...paths];

      void showBulkContextMenu(
        {
          onCopyRelativePaths: () => {
            const relatives = pathArray.map((p) =>
              workspaceRoot ? getRelativePath(p, workspaceRoot) : p,
            );
            void writeText(relatives.join("\n"));
          },
          onCopyAbsolutePaths: () => {
            void writeText(pathArray.join("\n"));
          },
          onDelete: () => {
            void (async () => {
              // Check for dirty files
              const openFilesMap = getOpenFiles();
              let dirtyCount = 0;
              for (const p of pathArray) {
                const file = openFilesMap.get(p);
                if (file?.isDirty) dirtyCount += 1;
              }

              if (dirtyCount > 0) {
                const confirmed = window.confirm(
                  `${dirtyCount} of ${pathArray.length} selected items have unsaved changes. Delete anyway?`,
                );
                if (!confirmed) return;
              } else {
                const confirmed = window.confirm(`Delete ${pathArray.length} items?`);
                if (!confirmed) return;
              }

              const parentDirs = new Set<string>();
              await Promise.all(
                pathArray.map(async (p) => {
                  try {
                    await tauri.deleteEntry(p);
                    removePathReferences(p);
                    removePinnedFile(p);
                    removePinnedFilesWithPrefix(p);
                    parentDirs.add(getParentDir(p));
                  } catch (error) {
                    window.alert(
                      `Failed to delete "${p}": ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }),
              );

              clearSelection();
              await Promise.all([...parentDirs].map((dir) => refreshDirectory(dir)));
            })();
          },
        },
        pathArray.length,
      );
    },
    [
      clearSelection,
      refreshDirectory,
      removePinnedFile,
      removePinnedFilesWithPrefix,
      workspaceRoot,
    ],
  );

  return { handleFileContextMenu, handleFolderContextMenu, handleBulkContextMenu };
}
