import { useWorkspaceStore } from "@/stores/workspace-store";

export function getWorkspaceRoot() {
  return useWorkspaceStore.getState().root;
}

export function getWorkspaceEpoch() {
  return useWorkspaceStore.getState().workspaceEpoch;
}
