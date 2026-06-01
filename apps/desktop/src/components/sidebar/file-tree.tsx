import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  useDirectoryCache,
  useExpandedDirs,
  useInvalidatePath,
  useRefreshDirectory,
  useRewriteExpandedDir,
  useToggleDirectory,
} from "@/hooks/use-file-tree";
import { useOpenFile } from "@/hooks/use-tabs";
import { useSetting } from "@/hooks/use-settings";
import {
  getOpenFile,
  getOpenFiles,
  openFileInNewTab as openFileInNewTabAction,
  removePathReferences,
  removePathsWithPrefix,
  renameOpenFile,
  rewritePathPrefix,
} from "@/hooks/editor-api";
import { useIsVirtualWorkspace, useWorkspaceRoot } from "@/hooks/use-workspace";
import * as tauri from "@/lib/tauri";
import { getFileStem, getParentDir, getRelativePath } from "@/lib/paths";
import { duplicateFile } from "./duplicate-file";
import { FileTreeNode } from "./file-tree-node";
import { showFileContextMenu } from "./file-context-menu";
import { showFolderContextMenu } from "./folder-context-menu";
import { showBulkContextMenu } from "./bulk-context-menu";
import { flattenTree } from "./flatten-tree";
import { useAutoRefresh } from "./use-auto-refresh";
import type { DirEntry } from "@/types/fs";

interface FileTreeProps {
  rootPath: string;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot);
}

async function resolveUniqueName(
  parentPath: string,
  baseName: string,
  extension: string,
): Promise<string> {
  const first = `${parentPath}/${baseName}${extension}`;
  if (!(await tauri.fileExists(first))) return first;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${parentPath}/${baseName} ${n}${extension}`;
    if (!(await tauri.fileExists(candidate))) return candidate;
  }

  throw new Error(`Could not find an available name for "${baseName}" in ${parentPath}`);
}

export function FileTree({ rootPath }: FileTreeProps) {
  const directoryCache = useDirectoryCache();
  const expandedDirs = useExpandedDirs();
  const toggleDirectory = useToggleDirectory();
  const openFile = useOpenFile();
  const refreshDirectory = useRefreshDirectory();
  const invalidatePath = useInvalidatePath();
  const rewriteExpandedDir = useRewriteExpandedDir();
  const workspaceRoot = useWorkspaceRoot();
  const isVirtualWorkspace = useIsVirtualWorkspace();
  const fileLabelMode = useSetting("appearance.sidebar-file-label");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  const entries = directoryCache.get(rootPath) ?? [];

  // Self-heal: if root was evicted from cache, reload it
  useAutoRefresh(rootPath, entries.length === 0);

  const flatItems = useMemo(
    () => flattenTree(entries, 0, directoryCache, expandedDirs),
    [directoryCache, entries, expandedDirs],
  );

  // Clear selection on Escape
  useEffect(() => {
    if (selectedPaths.size === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedPaths(new Set());
        setSelectionAnchor(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPaths.size]);

  const handleSelectionClick = useCallback(
    (event: MouseEvent<HTMLElement>, entry: DirEntry) => {
      if (event.shiftKey) {
        // Range select: from anchor (or first item) to clicked item.
        // Replaces current selection with the range.
        const anchor = selectionAnchor ?? flatItems[0]?.entry.path ?? null;
        if (!anchor) return;

        const anchorIndex = flatItems.findIndex((item) => item.entry.path === anchor);
        const targetIndex = flatItems.findIndex((item) => item.entry.path === entry.path);
        if (anchorIndex === -1 || targetIndex === -1) return;

        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const next = new Set<string>();
        for (let i = start; i <= end; i += 1) {
          next.add(flatItems[i].entry.path);
        }
        setSelectedPaths(next);
        // Don't change anchor — standard behavior keeps it on Shift+Click
      } else if (event.metaKey || event.ctrlKey) {
        // Toggle individual item in selection
        const next = new Set(selectedPaths);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        setSelectedPaths(next);
        setSelectionAnchor(entry.path);
        // Don't open/toggle — modifier click is purely selection
      } else {
        // Plain click: clear selection and perform normal action
        setSelectedPaths(new Set());
        setSelectionAnchor(entry.path);
        if (entry.missing) {
          return;
        }
        if (entry.is_dir) {
          void toggleDirectory(entry.path);
        } else {
          void openFile(entry.path);
        }
      }
    },
    [flatItems, openFile, selectedPaths, selectionAnchor, toggleDirectory],
  );

  const handleRenameSubmit = useCallback(
    async (entry: DirEntry, nextValue: string) => {
      setRenamingPath(null);

      const trimmed = nextValue.trim();
      if (!trimmed) return;

      if (entry.is_dir) {
        // For directories, the value is the full name.
        if (trimmed === entry.name) return;

        const parent = getParentDir(entry.path);
        const newPath = `${parent}/${trimmed}`;
        if (newPath === entry.path) return;

        try {
          if (await tauri.fileExists(newPath)) {
            window.alert(`A folder named "${trimmed}" already exists.`);
            return;
          }
          await tauri.renameEntry(entry.path, newPath);
          rewritePathPrefix(entry.path, newPath);
          rewriteExpandedDir(entry.path, newPath);
          await refreshDirectory(parent);
        } catch (error) {
          window.alert(
            `Failed to rename: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else {
        // For files, the value is the stem only.
        const currentStem = getFileStem(entry.name);
        if (trimmed === currentStem) return;

        const ext = getExtension(entry.name);
        const parent = getParentDir(entry.path);
        const newPath = `${parent}/${trimmed}${ext}`;
        if (newPath === entry.path) return;

        try {
          if (await tauri.fileExists(newPath)) {
            window.alert(`A file named "${trimmed}${ext}" already exists.`);
            return;
          }
          await tauri.renameEntry(entry.path, newPath);
          renameOpenFile(entry.path, newPath);
          await refreshDirectory(parent);
        } catch (error) {
          window.alert(
            `Failed to rename: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
    [refreshDirectory, rewriteExpandedDir],
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleFileContextMenu = useCallback(
    (entry: DirEntry) => {
      const parent = getParentDir(entry.path);
      const relative = workspaceRoot ? getRelativePath(entry.path, workspaceRoot) : entry.path;

      void showFileContextMenu({
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
    [openFile, refreshDirectory, workspaceRoot],
  );

  const handleFolderContextMenu = useCallback(
    (entry: DirEntry) => {
      const parent = getParentDir(entry.path);
      const relative = workspaceRoot ? getRelativePath(entry.path, workspaceRoot) : entry.path;

      void showFolderContextMenu({
        onNewFile: () => {
          void (async () => {
            try {
              const filePath = await resolveUniqueName(entry.path, "Untitled", ".md");
              await tauri.createFile(filePath);
              // Expand the folder so the new file is visible
              if (!expandedDirs.has(entry.path)) {
                await toggleDirectory(entry.path);
              } else {
                await refreshDirectory(entry.path);
              }
              setRenamingPath(filePath);
            } catch (error) {
              window.alert(
                `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          })();
        },
        onNewFolder: () => {
          void (async () => {
            try {
              const folderPath = await resolveUniqueName(entry.path, "Untitled Folder", "");
              await tauri.createDirectory(folderPath);
              // Expand the parent folder so the new folder is visible
              if (!expandedDirs.has(entry.path)) {
                await toggleDirectory(entry.path);
              } else {
                await refreshDirectory(entry.path);
              }
              setRenamingPath(folderPath);
            } catch (error) {
              window.alert(
                `Failed to create folder: ${error instanceof Error ? error.message : String(error)}`,
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
    [expandedDirs, invalidatePath, refreshDirectory, toggleDirectory, workspaceRoot],
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
              for (const p of pathArray) {
                try {
                  await tauri.deleteEntry(p);
                  removePathReferences(p);
                  parentDirs.add(getParentDir(p));
                } catch (error) {
                  window.alert(
                    `Failed to delete "${p}": ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              }

              setSelectedPaths(new Set());
              setSelectionAnchor(null);
              for (const dir of parentDirs) {
                await refreshDirectory(dir);
              }
            })();
          },
        },
        pathArray.length,
      );
    },
    [refreshDirectory, workspaceRoot],
  );

  const handleContextMenu = useCallback(
    (_event: MouseEvent<HTMLElement>, entry: DirEntry) => {
      if (isVirtualWorkspace || entry.missing) {
        return;
      }

      // If multiple items are selected and the right-clicked item is in the selection,
      // show the bulk menu
      if (selectedPaths.size >= 2 && selectedPaths.has(entry.path)) {
        handleBulkContextMenu(selectedPaths);
        return;
      }

      // Clear selection for single-item context menu
      setSelectedPaths(new Set());
      setSelectionAnchor(null);

      if (entry.is_dir) {
        handleFolderContextMenu(entry);
      } else {
        handleFileContextMenu(entry);
      }
    },
    [
      handleBulkContextMenu,
      handleFileContextMenu,
      handleFolderContextMenu,
      isVirtualWorkspace,
      selectedPaths,
    ],
  );

  if (flatItems.length === 0) {
    return <div className="px-2 text-[13px] text-[var(--text-muted)]">No files</div>;
  }

  return (
    <div className="flex flex-col gap-px py-2" role="tree" aria-label="File tree">
      {flatItems.map((item) => (
        <FileTreeNode
          key={item.entry.path}
          entry={item.entry}
          depth={item.depth}
          isExpanded={item.entry.is_dir && expandedDirs.has(item.entry.path)}
          isRenaming={renamingPath === item.entry.path}
          isSelected={selectedPaths.has(item.entry.path)}
          onToggleDir={toggleDirectory}
          onOpenFile={openFile}
          onClick={handleSelectionClick}
          onContextMenu={handleContextMenu}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={handleRenameCancel}
          fileLabelMode={fileLabelMode}
        />
      ))}
    </div>
  );
}
