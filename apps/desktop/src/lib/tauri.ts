import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  DirEntry,
  FileContent,
  IndexStats,
  SearchResult,
  WriteResult,
  WorkspaceInfo,
} from "@/types/fs";

// Filesystem commands
export function readDirectory(path: string): Promise<DirEntry[]> {
  return invoke("read_directory", { path });
}

export function readFile(path: string): Promise<FileContent> {
  return invoke("read_file", { path });
}

export function writeFile(path: string, content: string): Promise<WriteResult> {
  return invoke("write_file", { path, content });
}

export function createFile(path: string): Promise<FileContent> {
  return invoke("create_file", { path });
}

export function createDirectory(path: string): Promise<DirEntry> {
  return invoke("create_directory", { path });
}

export function renameEntry(oldPath: string, newPath: string): Promise<void> {
  return invoke("rename_entry", { oldPath, newPath });
}

export function deleteEntry(path: string): Promise<void> {
  return invoke("delete_entry", { path });
}

export function fileExists(path: string): Promise<boolean> {
  return invoke("file_exists", { path });
}

export function revealInFileManager(path: string): Promise<void> {
  return invoke("reveal_in_file_manager", { path });
}

// Workspace commands
export function openWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke("open_workspace", { path });
}

/** Open a new in-process window for the given workspace. Each window owns
 *  its own per-window `WorkspaceState` on the Rust side (watcher, file
 *  index, settings layer) so two windows hosting different workspaces don't
 *  share file events or search results. Pass `file` to have the new window
 *  focus a specific markdown file inside the workspace. If another window
 *  already hosts `path`, that window is focused instead. */
export function openWorkspaceInNewWindow(path: string, file?: string | null): Promise<void> {
  return invoke("open_workspace_in_new_window", { path, file: file ?? null });
}

/** Bundled startup-restore IPC. Returns workspace info, root directory
 *  entries, the recents list, the persisted session, and (when available)
 *  the active tab's file content in a single round trip. */
export interface RestoreWorkspaceResponse {
  workspace: WorkspaceInfo;
  entries: DirEntry[];
  recent_workspaces: string[];
  session: SessionData | null;
  active_file: FileContent | null;
}

export function restoreWorkspace(path: string): Promise<RestoreWorkspaceResponse> {
  return invoke("restore_workspace", { path });
}

export async function pickWorkspace(): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Open Folder",
  });
  return selected;
}

export async function pickFile(): Promise<string | null> {
  const selected = await openDialog({
    directory: false,
    multiple: false,
    title: "Open File",
    filters: [{ name: "Markdown", extensions: ["md", "mdx", "markdown", "txt"] }],
  });
  return selected;
}

export function getRecentWorkspaces(): Promise<string[]> {
  return invoke("get_recent_workspaces");
}

export function removeRecentWorkspace(path: string): Promise<void> {
  return invoke("remove_recent_workspace", { path });
}

// Session commands
export interface SessionData {
  tabs?: SessionTabData[];
  active_index?: number | null;
}

export interface SerializedLocationData {
  kind: string;
  [key: string]: unknown;
}

export interface SessionTabData {
  location: SerializedLocationData;
  back: SerializedLocationData[];
  forward: SerializedLocationData[];
}

export function saveSession(
  workspaceRoot: string,
  tabs: SessionTabData[],
  activeIndex: number | null,
): Promise<void> {
  return invoke("save_session", { workspaceRoot, tabs, activeIndex });
}

export function loadSession(workspaceRoot: string): Promise<SessionData | null> {
  return invoke("load_session", { workspaceRoot });
}

// Search commands
export function indexWorkspace(): Promise<IndexStats> {
  return invoke("index_workspace");
}

export function fuzzySearch(query: string, limit?: number): Promise<SearchResult[]> {
  return invoke("fuzzy_search", { query, limit });
}

// Settings commands
export function getSettings(): Promise<Record<string, unknown>> {
  return invoke("get_settings");
}

export function getSetting(key: string): Promise<unknown> {
  return invoke("get_setting", { key });
}

export function setSetting(
  key: string,
  value: unknown,
  scope: "global" | "workspace" = "global",
): Promise<void> {
  return invoke("set_setting", { key, value, scope });
}

export function resetSetting(key: string, scope: "global" | "workspace" = "global"): Promise<void> {
  return invoke("reset_setting", { key, scope });
}

// Pending open queue (drag-drop / CLI arg / dock open)
export interface PendingOpenPayload {
  workspace: string;
  file: string | null;
}

export function takePendingOpen(): Promise<PendingOpenPayload | null> {
  return invoke("take_pending_open");
}

// Startup state (single IPC call for all initialization data). The settings
// schema is NOT included — it's a build-time constant that the frontend
// imports statically from `@/lib/settings-schema` rather than fetching over
// IPC. Rust still uses the JSON internally (config.rs::settings_schema) for
// defaults; the IPC just doesn't expose it to TS.
export interface StartupState {
  settings: Record<string, unknown>;
  recent_workspaces: string[];
  pending_open: PendingOpenPayload | null;
  /** Prefetched workspace restore payload. Populated for pending-open cold
   *  starts in target-only mode, or when `window.restore-workspace` is
   *  enabled, there's no pending open, and the most-recent recent workspace
   *  still exists on disk. The frontend hydrates its stores synchronously
   *  from this bundle before the first render, so React mounts with full
   *  content instead of an empty shell. */
  restore_bundle: RestoreWorkspaceResponse | null;
}

export function getStartupState(): Promise<StartupState> {
  return invoke("get_startup_state");
}

// Window commands
export function showMainWindow(): Promise<void> {
  return getCurrentWindow().show();
}

// Image commands
export function saveClipboardImage(
  markdownFilePath: string,
  imageData: number[],
  format: string,
): Promise<{ relative_path: string; absolute_path: string }> {
  return invoke("save_clipboard_image", { markdownFilePath, imageData, format });
}
