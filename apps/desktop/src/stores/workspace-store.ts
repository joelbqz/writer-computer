import { create } from "zustand";
import type { DirEntry } from "@/types/fs";
import type { RestoreWorkspaceResponse } from "@/lib/tauri";
import * as tauri from "@/lib/tauri";
import { saveSession, loadSession } from "@/lib/session";
import { getEditorSessionSnapshot, useEditorStore } from "@/stores/editor-store";

interface WorkspaceState {
  root: string | null;
  isIndexing: boolean;
  isStartupResolved: boolean;
  directoryCache: Map<string, DirEntry[]>;
  expandedDirs: Set<string>;
  recentWorkspaces: string[];

  openWorkspace: (path: string) => Promise<void>;
  /** Hydrate from a prefetched `RestoreWorkspaceResponse` (startup cold-path
   *  and user-initiated switches via the `restore_workspace` IPC). */
  restoreFromBundle: (bundle: RestoreWorkspaceResponse) => Promise<void>;
  closeWorkspace: () => void;
  setStartupResolved: () => void;
  refreshDirectory: (path: string) => Promise<void>;
  toggleDirectory: (path: string) => Promise<void>;
  invalidatePath: (path: string) => void;
  rewriteExpandedDir: (oldPath: string, newPath: string) => void;
  removeRecentWorkspace: (path: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  root: null,
  isIndexing: false,
  isStartupResolved: false,
  directoryCache: new Map(),
  expandedDirs: new Set(),
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
    const entries = await tauri.readDirectory(info.root);
    const recents = await tauri.getRecentWorkspaces();
    set({
      root: info.root,
      isIndexing: true,
      directoryCache: new Map([[info.root, entries]]),
      expandedDirs: new Set(),
      recentWorkspaces: recents,
    });

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
    set({ root: null, directoryCache: new Map(), expandedDirs: new Set(), isIndexing: false });
  },

  restoreFromBundle: async (bundle) => {
    // Clear editor state in case anything was hydrated by a parallel hook.
    useEditorStore.setState({
      openFiles: new Map(),
      tabs: [],
      activeTabId: null,
      activeFilePath: null,
    });

    set({
      root: bundle.workspace.root,
      isIndexing: true,
      directoryCache: new Map([[bundle.workspace.root, bundle.entries]]),
      expandedDirs: new Set(),
      recentWorkspaces: bundle.recent_workspaces,
    });

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

    useEditorStore.getState().ensureLauncherTab();
  },

  setStartupResolved: () => set({ isStartupResolved: true }),

  refreshDirectory: async (path: string) => {
    const entries = await tauri.readDirectory(path);
    set((state) => {
      const cache = new Map(state.directoryCache);
      cache.set(path, entries);
      return { directoryCache: cache };
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
