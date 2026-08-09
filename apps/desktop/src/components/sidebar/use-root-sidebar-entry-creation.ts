import { useCallback } from "react";
import { useRefreshDirectory } from "@/hooks/use-file-tree";
import { getWorkspaceEpoch, getWorkspaceRoot } from "@/hooks/workspace-api";
import { useWorkspaceRoot } from "@/hooks/use-workspace";
import { getFileName } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import {
  createUntitledSidebarEntry,
  getSidebarCreationErrorMessage,
  type SidebarEntryKind,
} from "./sidebar-entry-creation";

export function useRootSidebarEntryCreation(beginRenaming: (path: string) => void) {
  const root = useWorkspaceRoot();
  const refreshDirectory = useRefreshDirectory();

  return useCallback(
    (kind: SidebarEntryKind) => {
      if (!root) return;
      const targetRoot = root;
      const targetEpoch = getWorkspaceEpoch();
      const isCurrent = () =>
        getWorkspaceRoot() === targetRoot && getWorkspaceEpoch() === targetEpoch;

      void (async () => {
        try {
          const result = await createUntitledSidebarEntry(targetRoot, kind, {
            fileExists: tauri.fileExists,
            createFile: tauri.createFile,
            createFolder: tauri.createDirectory,
            isCurrent,
            revealEntry: () => refreshDirectory(targetRoot),
            beginRenaming,
          });
          if ("followUpFailure" in result) {
            window.alert(
              `Created "${getFileName(result.path)}", but Writer could not refresh the sidebar: ${getSidebarCreationErrorMessage(result.followUpFailure)}`,
            );
          }
        } catch (error) {
          if (isCurrent()) {
            window.alert(`Failed to create ${kind}: ${getSidebarCreationErrorMessage(error)}`);
          }
        }
      })();
    },
    [beginRenaming, refreshDirectory, root],
  );
}
