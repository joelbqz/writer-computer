import { useCallback } from "react";
import { getWorkspaceRoot } from "@/hooks/workspace-api";
import { useRefreshDirectory } from "@/hooks/use-file-tree";
import { openStandaloneFile } from "@/hooks/use-open-drop";
import { useOpenFile } from "@/hooks/use-tabs";
import {
  executeEntryCreation,
  type EntryCreationDestination,
  type EntryCreationTarget,
} from "@/lib/entry-creation";
import * as tauri from "@/lib/tauri";

export function useCreateEntry() {
  const refreshDirectory = useRefreshDirectory();
  const openWorkspaceFile = useOpenFile();

  return useCallback(
    (target: EntryCreationTarget, destination: EntryCreationDestination) =>
      executeEntryCreation(target, destination, {
        createFile: tauri.createFile,
        createFolder: tauri.createDirectory,
        refreshDirectory,
        openWorkspaceFile,
        openStandaloneFile,
        getCurrentRoot: getWorkspaceRoot,
      }),
    [openWorkspaceFile, refreshDirectory],
  );
}
