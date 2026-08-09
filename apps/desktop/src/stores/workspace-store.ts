import { create } from "zustand";
import type { DirEntry } from "@/types/fs";
import type { RestoreWorkspaceResponse } from "@/lib/tauri";
import * as tauri from "@/lib/tauri";
import { getPreference, setPreference } from "@/lib/preferences";
import { saveSession, loadSession } from "@/lib/session";
import { getEditorSessionSnapshot, useEditorStore } from "@/stores/editor-store";

export type WorkspaceChromeMode = "workspace" | "compact-file";

interface WorkspaceState {
  root: string | null;
  workspaceEpoch: number;
  chromeMode: WorkspaceChromeMode;
  fileCount: number;
  isIndexing: boolean;
  isStartupResolved: boolean;
  directoryCache: Map<string, DirEntry[]>;
  expandedDirs: Set<string>;
  pinnedFiles: string[];
  sidebarMetadataVersion: number;
  recentWorkspaces: string[];

  openWorkspace: (path: string) => Promise<void>;
  /** Hydrate from a prefetched `RestoreWorkspaceResponse` (startup cold-path
   *  and user-initiated switches via the `restore_workspace` IPC). */
  restoreFromBundle: (bundle: RestoreWorkspaceResponse) => Promise<void>;
  closeWorkspace: () => void;
  setChromeMode: (mode: WorkspaceChromeMode) => void;
  setStartupResolved: () => void;
  refreshDirectory: (path: string) => Promise<void>;
  ensureDirectoryExpanded: (path: string) => Promise<void>;
  toggleDirectory: (path: string) => Promise<void>;
  invalidatePath: (path: string) => void;
  rewriteExpandedDir: (oldPath: string, newPath: string) => void;
  hydratePinnedFiles: (root: string) => Promise<void>;
  togglePinnedFile: (path: string) => void;
  removePinnedFile: (path: string) => void;
  removePinnedFilesWithPrefix: (prefix: string) => void;
  rewritePinnedPath: (oldPath: string, newPath: string) => void;
  bumpSidebarMetadataVersion: () => void;
  removeRecentWorkspace: (path: string) => Promise<void>;
}

function pinnedFilesPreferenceKey(root: string) {
  return `workspace:${root}:sidebar-pinned-files`;
}

function normalizePinnedFiles(root: string, paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  const rootPrefix = `${root}/`;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string") continue;
    if (!path.startsWith(rootPrefix)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

async function loadPinnedFiles(root: string) {
  const paths = await getPreference<unknown>(pinnedFilesPreferenceKey(root), []);
  return normalizePinnedFiles(root, paths);
}

function persistPinnedFiles(root: string, paths: string[]) {
  void setPreference(pinnedFilesPreferenceKey(root), paths);
}

function withoutPath(paths: string[], path: string) {
  return paths.filter((candidate) => candidate !== path);
}

function dedupe(paths: string[]) {
  return [...new Set(paths)];
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  root: null,
  workspaceEpoch: 0,
  chromeMode: "workspace",
  fileCount: 0,
  isIndexing: false,
  isStartupResolved: false,
  directoryCache: new Map(),
  expandedDirs: new Set(),
  pinnedFiles: [],
  sidebarMetadataVersion: 0,
  recentWorkspaces: [],

  openWorkspace: async (path: string) => {
    // Multi-window: when this window already has a workspace, open the new
    // one in a fresh in-process window instead of replacing the current
    // workspace. Each window has its own `WorkspaceState` on the Rust side
    // so file watchers, search indexes, and session state stay isolated.
    const prevRoot = get().root;
    if (prevRoot && prevRoot !== path) {
      await tauri.openWorkspaceInNewWindow(path);
      return;
    }
    if (prevRoot === path) {
      return;
    }

    // Clear editor state before switching
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });

    const info = await tauri.openWorkspace(path);
    // Read the directory and load the session under the canonical root that
    // Rust returned, not the raw input. Otherwise watcher events (which fire
    // canonical paths) miss the cache key and the sidebar goes stale on
    // aliased workspaces (e.g. `/var/...` → `/private/var/...`).
    const [entries, recents] = await Promise.all([
      tauri.readDirectory(info.root),
      tauri.getRecentWorkspaces(),
    ]);
    set((state) => ({
      root: info.root,
      workspaceEpoch: state.workspaceEpoch + 1,
      chromeMode: "workspace",
      fileCount: info.file_count,
      isIndexing: true,
      directoryCache: new Map([[info.root, entries]]),
      expandedDirs: new Set(),
      pinnedFiles: [],
      sidebarMetadataVersion: 0,
      recentWorkspaces: recents,
    }));
    void get().hydratePinnedFiles(info.root);

    const session = await loadSession(info.root);
    if (session && session.tabs.length > 0) {
      await useEditorStore.getState().restoreSession(session.tabs, session.activeIndex);
      return;
    }

    useEditorStore.getState().ensureLauncherTab();
  },

  closeWorkspace: () => {
    const root = get().root;
    if (!root) return;
    const snapshot = getEditorSessionSnapshot(useEditorStore.getState());
    void saveSession(root, snapshot.tabs, snapshot.activeIndex);
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });
    set((state) => ({
      root: null,
      workspaceEpoch: state.workspaceEpoch + 1,
      chromeMode: "workspace",
      fileCount: 0,
      directoryCache: new Map(),
      expandedDirs: new Set(),
      pinnedFiles: [],
      sidebarMetadataVersion: 0,
      isIndexing: false,
    }));
  },

  restoreFromBundle: async (bundle) => {
    // Clear editor state in case anything was hydrated by a parallel hook.
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });

    set((state) => ({
      root: bundle.workspace.root,
      workspaceEpoch: state.workspaceEpoch + 1,
      chromeMode: "workspace",
      fileCount: bundle.workspace.file_count,
      isIndexing: true,
      directoryCache: new Map([[bundle.workspace.root, bundle.entries]]),
      expandedDirs: new Set(),
      pinnedFiles: [],
      sidebarMetadataVersion: 0,
      recentWorkspaces: bundle.recent_workspaces,
    }));
    void get().hydratePinnedFiles(bundle.workspace.root);

    if (bundle.session && bundle.session.tabs && bundle.session.tabs.length > 0) {
      // Fire-and-forget: `restoreSession` populates the active tab
      // synchronously (via prefetchedActiveFile) before it starts awaiting
      // background tab reads. We intentionally don't await the whole thing
      // so the startup flow doesn't block on tabs the user isn't looking at
      // yet — they load in the background and fill in on their own.
      void useEditorStore
        .getState()
        .restoreSession(
          bundle.session.tabs,
          bundle.session.active_index ?? null,
          bundle.active_file,
        )
        .catch((error) => {
          console.error("Failed to load background tabs from restored session", error);
        });
      return;
    }

    if (bundle.open_file) {
      // Workspace+file open (open_workspace_in_new_window with a file):
      // the requested file becomes a normal tab in workspace chrome.
      void useEditorStore.getState().openFile(bundle.open_file);
      return;
    }

    useEditorStore.getState().ensureLauncherTab();
  },

  setChromeMode: (mode) => set({ chromeMode: mode }),

  setStartupResolved: () => set({ isStartupResolved: true }),

  refreshDirectory: async (path: string) => {
    const { root: rootAtStart, workspaceEpoch: epochAtStart } = get();
    const entries = await tauri.readDirectory(path);
    set((state) => {
      if (state.root !== rootAtStart || state.workspaceEpoch !== epochAtStart) return state;
      const cache = new Map(state.directoryCache);
      cache.set(path, entries);
      return { directoryCache: cache };
    });
  },

  ensureDirectoryExpanded: async (path: string) => {
    const { root: rootAtStart, workspaceEpoch: epochAtStart } = get();
    const entries = await tauri.readDirectory(path);
    set((state) => {
      if (state.root !== rootAtStart || state.workspaceEpoch !== epochAtStart) return state;
      const cache = new Map(state.directoryCache);
      cache.set(path, entries);
      const expandedDirs = new Set(state.expandedDirs);
      expandedDirs.add(path);
      return { directoryCache: cache, expandedDirs };
    });
  },

  toggleDirectory: async (path: string) => {
    const { expandedDirs, directoryCache } = get();
    const newExpanded = new Set(expandedDirs);

    if (newExpanded.has(path)) {
      newExpanded.delete(path);
      set({ expandedDirs: newExpanded });
    } else {
      newExpanded.add(path);
      if (!directoryCache.has(path)) {
        const entries = await tauri.readDirectory(path);
        set((state) => {
          const cache = new Map(state.directoryCache);
          cache.set(path, entries);
          return { directoryCache: cache, expandedDirs: newExpanded };
        });
      } else {
        set({ expandedDirs: newExpanded });
      }
    }
  },

  invalidatePath: (path: string) => {
    set((state) => {
      const cache = new Map(state.directoryCache);
      cache.delete(path);
      return { directoryCache: cache };
    });
  },

  rewriteExpandedDir: (oldPath: string, newPath: string) => {
    set((state) => {
      const dirPrefix = `${oldPath}/`;
      const next = new Set<string>();
      let changed = false;

      for (const dir of state.expandedDirs) {
        if (dir === oldPath) {
          next.add(newPath);
          changed = true;
        } else if (dir.startsWith(dirPrefix)) {
          next.add(newPath + dir.slice(oldPath.length));
          changed = true;
        } else {
          next.add(dir);
        }
      }

      if (!changed) return state;

      // Also rekey directory cache entries under the old prefix
      const cache = new Map<string, DirEntry[]>();
      for (const [key, entries] of state.directoryCache) {
        if (key === oldPath) {
          cache.set(newPath, entries);
        } else if (key.startsWith(dirPrefix)) {
          cache.set(newPath + key.slice(oldPath.length), entries);
        } else {
          cache.set(key, entries);
        }
      }

      return { expandedDirs: next, directoryCache: cache };
    });
  },

  hydratePinnedFiles: async (root: string) => {
    const pinnedFiles = await loadPinnedFiles(root);
    if (get().root !== root) return;
    set({ pinnedFiles });
  },

  togglePinnedFile: (path: string) => {
    const root = get().root;
    if (!root || !path.startsWith(`${root}/`)) return;

    let next: string[] = [];
    set((state) => {
      next = state.pinnedFiles.includes(path)
        ? withoutPath(state.pinnedFiles, path)
        : [path, ...state.pinnedFiles];
      return { pinnedFiles: next };
    });
    persistPinnedFiles(root, next);
  },

  removePinnedFile: (path: string) => {
    const root = get().root;
    if (!root) return;

    let next: string[] | null = null;
    set((state) => {
      if (!state.pinnedFiles.includes(path)) return state;
      const updated = withoutPath(state.pinnedFiles, path);
      next = updated;
      return { pinnedFiles: updated };
    });
    if (next) persistPinnedFiles(root, next);
  },

  removePinnedFilesWithPrefix: (prefix: string) => {
    const root = get().root;
    if (!root) return;

    const prefixWithSlash = `${prefix}/`;
    let next: string[] | null = null;
    set((state) => {
      const filtered = state.pinnedFiles.filter(
        (path) => path !== prefix && !path.startsWith(prefixWithSlash),
      );
      if (filtered.length === state.pinnedFiles.length) return state;
      next = filtered;
      return { pinnedFiles: filtered };
    });
    if (next) persistPinnedFiles(root, next);
  },

  rewritePinnedPath: (oldPath: string, newPath: string) => {
    const root = get().root;
    if (!root) return;

    const oldPrefix = `${oldPath}/`;
    let next: string[] | null = null;
    set((state) => {
      let changed = false;
      const rewritten = state.pinnedFiles.map((path) => {
        if (path === oldPath) {
          changed = true;
          return newPath;
        }
        if (path.startsWith(oldPrefix)) {
          changed = true;
          return newPath + path.slice(oldPath.length);
        }
        return path;
      });
      if (!changed) return state;
      const updated = dedupe(rewritten);
      next = updated;
      return { pinnedFiles: updated };
    });
    if (next) persistPinnedFiles(root, next);
  },

  bumpSidebarMetadataVersion: () => {
    set((state) => ({ sidebarMetadataVersion: state.sidebarMetadataVersion + 1 }));
  },

  removeRecentWorkspace: async (path: string) => {
    await tauri.removeRecentWorkspace(path);
    set((state) => ({
      recentWorkspaces: state.recentWorkspaces.filter((p) => p !== path),
    }));
  },
}));

// Recent workspaces are hydrated by resolveStartup() via get_startup_state before the first render.

// Save session whenever tabs change (debounced) and on window close
if (typeof window !== "undefined") {
  let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;

  useEditorStore.subscribe((state, prev) => {
    if (state.tabs === prev.tabs && state.activeTabId === prev.activeTabId) return;
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
      // Standalone compact windows have no root, so they never persist a
      // session — the root check covers both cases.
      const root = useWorkspaceStore.getState().root;
      if (!root) return;
      const snapshot = getEditorSessionSnapshot(useEditorStore.getState());
      void saveSession(root, snapshot.tabs, snapshot.activeIndex);
    }, 500);
  });

  window.addEventListener("beforeunload", () => {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
    const root = useWorkspaceStore.getState().root;
    if (!root) return;
    const snapshot = getEditorSessionSnapshot(useEditorStore.getState());
    void saveSession(root, snapshot.tabs, snapshot.activeIndex);
  });
}
