import { create } from "zustand";
import type { FileContent } from "@/types/fs";
import * as tauri from "@/lib/tauri";
import {
  getFrontmatterDisplayDate,
  inferTitle,
  parseDocument,
  type TitleSource,
} from "@/lib/frontmatter";
import { getDocumentStats, type DocumentStats } from "@/lib/document-stats";
import { cancelSave, scheduleSave } from "@/lib/save";
import {
  locationBehavior,
  serializeLocation,
  deserializeLocation,
  type FileLocation,
  type Location,
  type SerializedLocation,
} from "@/components/editor-area/page-kinds";
import type { ScrollAnchor } from "@/components/editor-area/editor-scroll-geometry";

export interface OpenFile {
  path: string;
  frontmatter: string | null;
  content: string;
  title: string;
  titleSource: TitleSource;
  diskContent: string;
  isDirty: boolean;
  isLoading: boolean;
  saveError: string | null;
  reloadVersion: number;
  scrollPos: number;
  // Content-anchored scroll position ({pos, offsetPx} of the top visible
  // line), saved at navigation time. Preferred over the raw pixel
  // scrollPos on restore: pixels go stale when the heightmap re-estimates
  // after a document swap. Null until the file is first navigated away from.
  scrollAnchor: ScrollAnchor | null;
  cursorPos: number;
  displayDate: string | null;
  stats: DocumentStats;
}

export interface Tab {
  id: string;
  location: Location;
  back: Location[];
  forward: Location[];
}

export type { Location, FileLocation } from "@/components/editor-area/page-kinds";

export interface SessionTab {
  location: SerializedLocation;
  back: SerializedLocation[];
  forward: SerializedLocation[];
}

interface EditorState {
  openFiles: Map<string, OpenFile>;
  tabs: Tab[];
  activeTabId: string | null;
  activeFilePath: string | null;

  openFile: (path: string) => Promise<void>;
  openFileInNewTab: (path: string) => Promise<void>;
  openNewTab: () => void;
  ensureLauncherTab: () => void;
  openOrFocus: (match: (tab: Tab) => boolean, factory: () => Tab) => void;
  replaceTabWithFile: (tabId: string, path: string) => Promise<void>;
  closeFile: (path: string) => void;
  closeTab: (tabId: string) => void;
  closeActiveTab: () => void;
  setActiveFile: (path: string) => void;
  setActiveTab: (tabId: string) => void;
  navigateToFile: (path: string) => Promise<void>;
  navigateBack: () => Promise<void>;
  navigateForward: () => Promise<void>;
  renameOpenFile: (oldPath: string, newPath: string) => void;
  removePathReferences: (path: string) => void;
  removePathsWithPrefix: (prefix: string) => void;
  rewritePathPrefix: (oldPrefix: string, newPrefix: string) => void;
  restoreSession: (
    tabs: SessionTab[],
    activeIndex: number | null,
    prefetchedActiveFile?: FileContent | null,
  ) => Promise<void>;
  updateContent: (path: string, content: string) => void;
  updateFrontmatter: (path: string, frontmatter: string | null) => void;
  markSaved: (path: string, diskContent: string, hasNewerChanges?: boolean) => void;
  setSaveError: (path: string, error: string | null) => void;
  reloadFromDisk: (path: string, rawContent: string) => void;
  updateScrollPos: (path: string, pos: number) => void;
  updateScrollAnchor: (path: string, anchor: ScrollAnchor | null) => void;
  updateCursorPos: (path: string, pos: number) => void;
}

type EditorStateSetter = (
  partial:
    | EditorState
    | Partial<EditorState>
    | ((state: EditorState) => EditorState | Partial<EditorState>),
  replace?: boolean,
) => void;

const pendingLoads = new Map<string, Promise<void>>();
const pendingNavigationVersionByTabId = new Map<string, number>();

// How long openFile waits for a fresh file to finish loading before falling
// back to creating the tab with a "Loading..." placeholder. Below ~100 ms is
// imperceptible, so fast disk reads never flash the spinner.
const OPEN_FILE_GRACE_MS = 40;

let tabSequence = 0;

function createTabId() {
  tabSequence += 1;
  return `tab-${tabSequence}`;
}

export function createLauncherTab(id = createTabId()): Tab {
  return { id, location: { kind: "launcher" }, back: [], forward: [] };
}

export function createFileTab(path: string, id = createTabId()): Tab {
  return { id, location: { kind: "file", path }, back: [], forward: [] };
}

export function createSettingsTab(id = createTabId()): Tab {
  return { id, location: { kind: "settings" }, back: [], forward: [] };
}

const EMPTY_STATS: DocumentStats = { words: 0, characters: 0, paragraphs: 0 };

function createLoadingFile(path: string): OpenFile {
  return {
    path,
    frontmatter: null,
    content: "",
    title: "",
    titleSource: "none",
    diskContent: "",
    isDirty: false,
    isLoading: true,
    saveError: null,
    reloadVersion: 0,
    scrollPos: 0,
    scrollAnchor: null,
    cursorPos: 0,
    displayDate: null,
    stats: EMPTY_STATS,
  };
}

function withDerivedDate<T extends { frontmatter: string | null }>(file: T) {
  return { ...file, displayDate: getFrontmatterDisplayDate(file.frontmatter) };
}

function withDerivedStats<T extends { content: string }>(file: T) {
  return { ...file, stats: getDocumentStats(file.content) };
}

function withDerived<T extends { frontmatter: string | null; content: string }>(file: T) {
  return {
    ...file,
    displayDate: getFrontmatterDisplayDate(file.frontmatter),
    stats: getDocumentStats(file.content),
  };
}

function cloneTab(tab: Tab): Tab {
  return { ...tab, back: [...tab.back], forward: [...tab.forward] };
}

function locationPaths(location: Location): string[] {
  return locationBehavior(location).paths(location);
}

function locationPrimaryPath(location: Location): string | null {
  return locationBehavior(location).primaryPath(location);
}

function deriveActiveFilePath(tabs: Tab[], activeTabId: string | null): string | null {
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  return activeTab ? locationPrimaryPath(activeTab.location) : null;
}

function getTabIndex(tabs: Tab[], tabId: string) {
  return tabs.findIndex((tab) => tab.id === tabId);
}

function getActiveTab(state: Pick<EditorState, "tabs" | "activeTabId">) {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

function collectReferencedPaths(tabs: Tab[]) {
  const paths = new Set<string>();
  for (const tab of tabs) {
    for (const p of locationPaths(tab.location)) paths.add(p);
    for (const loc of tab.back) for (const p of locationPaths(loc)) paths.add(p);
    for (const loc of tab.forward) for (const p of locationPaths(loc)) paths.add(p);
  }
  return paths;
}

function maybePruneFiles(
  state: Pick<EditorState, "openFiles" | "tabs">,
  nextTabs: Tab[],
  candidatePaths: string[],
) {
  const referenced = collectReferencedPaths(nextTabs);
  let files: Map<string, OpenFile> | null = null;

  for (const path of candidatePaths) {
    if (referenced.has(path)) continue;
    const file = (files ?? state.openFiles).get(path);
    if (!file || file.isDirty) continue;
    cancelSave(path);
    if (!files) files = new Map(state.openFiles);
    files.delete(path);
  }

  return files;
}

function tabPaths(tab: Tab): string[] {
  const paths = new Set<string>();
  for (const p of locationPaths(tab.location)) paths.add(p);
  for (const loc of tab.back) for (const p of locationPaths(loc)) paths.add(p);
  for (const loc of tab.forward) for (const p of locationPaths(loc)) paths.add(p);
  return [...paths];
}

function startNavigation(tabId: string) {
  const nextVersion = (pendingNavigationVersionByTabId.get(tabId) ?? 0) + 1;
  pendingNavigationVersionByTabId.set(tabId, nextVersion);
  return nextVersion;
}

function isNavigationCurrent(tabId: string, version: number) {
  return pendingNavigationVersionByTabId.get(tabId) === version;
}

function rewriteLocation(location: Location, from: string, to: string): Location | null {
  return locationBehavior(location).rewritePath(location as never, from, to) as Location | null;
}

function removeFromLocation(location: Location, path: string): Location | null {
  return locationBehavior(location).removePath(location as never, path) as Location | null;
}

function applyRewriteToTab(tab: Tab, rewrite: (loc: Location) => Location | null): Tab | null {
  const newLocation = rewrite(tab.location);
  if (!newLocation) return null;
  const back = tab.back.map(rewrite).filter((l): l is Location => l !== null);
  const forward = tab.forward.map(rewrite).filter((l): l is Location => l !== null);
  return { ...tab, location: newLocation, back, forward };
}

async function ensureFileLoaded(path: string, set: EditorStateSetter, get: () => EditorState) {
  const existing = get().openFiles.get(path);
  if (existing && !existing.isLoading) return;

  const pending = pendingLoads.get(path);
  if (pending) {
    await pending;
    return;
  }

  if (!existing) {
    set((state) => {
      if (state.openFiles.has(path)) return state;
      const files = new Map(state.openFiles);
      files.set(path, createLoadingFile(path));
      return { openFiles: files };
    });
  }

  const loadPromise = tauri
    .readFile(path)
    .then((raw) => {
      const parsed = parseDocument(raw.content);
      set((state) => {
        const file = state.openFiles.get(path);
        if (!file) return state;
        const files = new Map(state.openFiles);
        files.set(
          path,
          withDerived({
            ...file,
            path,
            frontmatter: parsed.frontmatter,
            content: parsed.body ?? "",
            title: parsed.title,
            titleSource: parsed.titleSource,
            diskContent: raw.content,
            isLoading: false,
          }),
        );
        return { openFiles: files };
      });
    })
    .catch((error) => {
      set((state) => {
        const file = state.openFiles.get(path);
        if (!file) return state;
        const files = new Map(state.openFiles);
        files.delete(path);
        return { openFiles: files };
      });
      throw error;
    })
    .finally(() => {
      pendingLoads.delete(path);
    });

  pendingLoads.set(path, loadPromise);
  await loadPromise;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: new Map(),
  tabs: [],
  activeTabId: null,
  activeFilePath: null,

  openFile: async (path: string) => {
    const state = get();
    const activeTab = getActiveTab(state);

    if (activeTab?.location.kind === "launcher") {
      await state.replaceTabWithFile(activeTab.id, path);
      return;
    }

    // Reuse the active file tab by navigating in-place.
    if (activeTab?.location.kind === "file") {
      await state.navigateToFile(path);
      return;
    }

    // No tabs at all — create one.
    const loadPromise = ensureFileLoaded(path, set as EditorStateSetter, get);
    loadPromise.catch(() => {});

    const loadFailedBeforeGrace = await Promise.race([
      loadPromise.then(
        () => false,
        () => true,
      ),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), OPEN_FILE_GRACE_MS)),
    ]);
    if (loadFailedBeforeGrace) return;

    const nextTab = createFileTab(path);
    set((state) => ({
      tabs: [...state.tabs, nextTab],
      activeTabId: nextTab.id,
      activeFilePath: path,
    }));

    try {
      await loadPromise;
    } catch {
      get().closeTab(nextTab.id);
    }
  },

  // Always create a fresh tab for `path`, even if another tab already shows it.
  // Used by the sidebar context menu's "Open in new tab" action so it never
  // collapses into the existing tab the way `openFile` does.
  openFileInNewTab: async (path: string) => {
    const nextTab = createFileTab(path);

    set((state) => {
      const openFiles = state.openFiles.has(path)
        ? undefined
        : new Map(state.openFiles).set(path, createLoadingFile(path));
      return {
        tabs: [...state.tabs, nextTab],
        activeTabId: nextTab.id,
        activeFilePath: path,
        ...(openFiles ? { openFiles } : {}),
      };
    });

    try {
      await ensureFileLoaded(path, set as EditorStateSetter, get);
    } catch {
      get().closeTab(nextTab.id);
      throw new Error(`Failed to open ${path}`);
    }
  },

  openNewTab: () => {
    const nextTab = createLauncherTab();
    set((state) => ({
      tabs: [...state.tabs, nextTab],
      activeTabId: nextTab.id,
      activeFilePath: null,
    }));
  },

  ensureLauncherTab: () => {
    set((state) => {
      if (state.tabs.length > 0) return state;
      const launcherTab = createLauncherTab();
      return {
        tabs: [launcherTab],
        activeTabId: launcherTab.id,
        activeFilePath: null,
      };
    });
  },

  openOrFocus: (match, factory) => {
    const state = get();
    const existing = state.tabs.find(match);
    if (existing) {
      if (existing.id !== state.activeTabId) {
        state.setActiveTab(existing.id);
      }
      return;
    }
    const activeTab = getActiveTab(state);
    const nextTab = factory();
    set((currentState) => {
      if (activeTab?.location.kind === "launcher") {
        const index = getTabIndex(currentState.tabs, activeTab.id);
        if (index !== -1) {
          const tabs = [...currentState.tabs];
          tabs[index] = { ...nextTab, id: activeTab.id };
          return {
            tabs,
            activeTabId: activeTab.id,
            activeFilePath: deriveActiveFilePath(tabs, activeTab.id),
          };
        }
      }
      return {
        tabs: [...currentState.tabs, nextTab],
        activeTabId: nextTab.id,
        activeFilePath: deriveActiveFilePath([...currentState.tabs, nextTab], nextTab.id),
      };
    });
  },

  replaceTabWithFile: async (tabId: string, path: string) => {
    const targetTab = get().tabs.find((tab) => tab.id === tabId);
    if (!targetTab || targetTab.location.kind !== "launcher") {
      await get().openFile(path);
      return;
    }

    const nextTab = createFileTab(path, tabId);
    const version = startNavigation(tabId);

    set((state) => {
      const index = getTabIndex(state.tabs, tabId);
      if (index === -1) return state;
      if (state.tabs[index]?.location.kind !== "launcher") return state;
      const tabs = [...state.tabs];
      tabs[index] = nextTab;
      const openFiles = state.openFiles.has(path)
        ? undefined
        : new Map(state.openFiles).set(path, createLoadingFile(path));
      return {
        tabs,
        activeFilePath: state.activeTabId === tabId ? path : state.activeFilePath,
        ...(openFiles ? { openFiles } : {}),
      };
    });

    try {
      await ensureFileLoaded(path, set as EditorStateSetter, get);
    } catch {
      if (!isNavigationCurrent(tabId, version)) return;

      set((state) => {
        const index = getTabIndex(state.tabs, tabId);
        if (index === -1) {
          const files = maybePruneFiles(state, state.tabs, [path]);
          return files ? { openFiles: files } : state;
        }

        const currentTab = state.tabs[index];
        const currentLocation = currentTab?.location;
        if (!currentLocation || currentLocation.kind !== "file" || currentLocation.path !== path) {
          const files = maybePruneFiles(state, state.tabs, [path]);
          return files ? { openFiles: files } : state;
        }

        const tabs = [...state.tabs];
        tabs[index] = targetTab;
        const files = maybePruneFiles(state, tabs, [path]);

        return {
          tabs,
          activeFilePath: state.activeTabId === tabId ? null : state.activeFilePath,
          ...(files ? { openFiles: files } : {}),
        };
      });
    }
  },

  closeFile: (path: string) => {
    const { activeTabId, tabs } = get();
    const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) : null;
    if (activeTab?.location.kind === "file" && activeTab.location.path === path) {
      get().closeTab(activeTab.id);
      return;
    }

    const targetTab = tabs.find(
      (tab) => tab.location.kind === "file" && tab.location.path === path,
    );
    if (targetTab) get().closeTab(targetTab.id);
  },

  closeTab: (tabId: string) => {
    set((state) => {
      const index = getTabIndex(state.tabs, tabId);
      if (index === -1) return state;

      const closedTab = state.tabs[index]!;
      let tabs = state.tabs.filter((tab) => tab.id !== tabId);

      let activeTabId = state.activeTabId;
      if (tabs.length === 0) {
        const launcherTab = createLauncherTab();
        tabs = [launcherTab];
        activeTabId = launcherTab.id;
      } else if (state.activeTabId === tabId) {
        activeTabId = tabs[index]?.id ?? tabs[index - 1]?.id ?? null;
      }

      const files = maybePruneFiles(state, tabs, tabPaths(closedTab));

      return {
        tabs,
        activeTabId,
        activeFilePath: deriveActiveFilePath(tabs, activeTabId),
        ...(files ? { openFiles: files } : {}),
      };
    });

    pendingNavigationVersionByTabId.delete(tabId);
  },

  closeActiveTab: () => {
    const activeTabId = get().activeTabId;
    if (activeTabId) get().closeTab(activeTabId);
  },

  setActiveFile: (path: string) => {
    const tab = get().tabs.find(
      (candidate) => candidate.location.kind === "file" && candidate.location.path === path,
    );
    if (!tab) return;
    set({ activeTabId: tab.id, activeFilePath: path });
  },

  setActiveTab: (tabId: string) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    set({ activeTabId: tabId, activeFilePath: deriveActiveFilePath(get().tabs, tabId) });
  },

  navigateToFile: async (path: string) => {
    const state = get();
    const activeTab = getActiveTab(state);
    if (!activeTab) {
      await state.openFile(path);
      return;
    }
    if (activeTab.location.kind === "launcher") {
      await state.replaceTabWithFile(activeTab.id, path);
      return;
    }
    if (activeTab.location.kind === "file" && activeTab.location.path === path) return;

    const previousTab = cloneTab(activeTab);
    const nextLocation: FileLocation = { kind: "file", path };
    const nextTab: Tab = {
      ...cloneTab(activeTab),
      location: nextLocation,
      back: [...activeTab.back, activeTab.location],
      forward: [],
    };

    const version = startNavigation(activeTab.id);

    set((currentState) => {
      const index = getTabIndex(currentState.tabs, activeTab.id);
      if (index === -1) return currentState;
      const tabs = [...currentState.tabs];
      tabs[index] = nextTab;
      const openFiles = currentState.openFiles.has(path)
        ? undefined
        : new Map(currentState.openFiles).set(path, createLoadingFile(path));
      return {
        tabs,
        activeFilePath:
          currentState.activeTabId === activeTab.id ? path : currentState.activeFilePath,
        ...(openFiles ? { openFiles } : {}),
      };
    });

    try {
      await ensureFileLoaded(path, set as EditorStateSetter, get);
    } catch {
      if (!isNavigationCurrent(activeTab.id, version)) return;

      set((currentState) => {
        const index = getTabIndex(currentState.tabs, activeTab.id);
        if (index === -1) return currentState;
        const tabs = [...currentState.tabs];
        tabs[index] = previousTab;
        const files = maybePruneFiles(currentState, tabs, [path]);
        return {
          tabs,
          activeFilePath:
            currentState.activeTabId === activeTab.id
              ? locationPrimaryPath(previousTab.location)
              : currentState.activeFilePath,
          ...(files ? { openFiles: files } : {}),
        };
      });
    }
  },

  navigateBack: async () => {
    const state = get();
    const activeTab = getActiveTab(state);
    if (!activeTab || activeTab.back.length === 0) return;

    const targetLocation = activeTab.back[activeTab.back.length - 1]!;
    const previousTab = cloneTab(activeTab);
    const nextTab: Tab = {
      ...cloneTab(activeTab),
      location: targetLocation,
      back: activeTab.back.slice(0, -1),
      forward: [activeTab.location, ...activeTab.forward],
    };
    const targetPath = locationPrimaryPath(targetLocation);
    const version = startNavigation(activeTab.id);

    set((currentState) => {
      const index = getTabIndex(currentState.tabs, activeTab.id);
      if (index === -1) return currentState;
      const tabs = [...currentState.tabs];
      tabs[index] = nextTab;
      return {
        tabs,
        activeFilePath:
          currentState.activeTabId === activeTab.id ? targetPath : currentState.activeFilePath,
      };
    });

    if (!targetPath) return;

    try {
      await ensureFileLoaded(targetPath, set as EditorStateSetter, get);
    } catch {
      if (!isNavigationCurrent(activeTab.id, version)) return;

      set((currentState) => {
        const index = getTabIndex(currentState.tabs, activeTab.id);
        if (index === -1) return currentState;
        const tabs = [...currentState.tabs];
        tabs[index] = previousTab;
        const files = maybePruneFiles(currentState, tabs, [targetPath]);
        return {
          tabs,
          activeFilePath:
            currentState.activeTabId === activeTab.id
              ? locationPrimaryPath(previousTab.location)
              : currentState.activeFilePath,
          ...(files ? { openFiles: files } : {}),
        };
      });
    }
  },

  navigateForward: async () => {
    const state = get();
    const activeTab = getActiveTab(state);
    if (!activeTab || activeTab.forward.length === 0) return;

    const [targetLocation, ...remainingForward] = activeTab.forward;
    const previousTab = cloneTab(activeTab);
    const nextTab: Tab = {
      ...cloneTab(activeTab),
      location: targetLocation!,
      back: [...activeTab.back, activeTab.location],
      forward: remainingForward,
    };
    const targetPath = locationPrimaryPath(targetLocation!);
    const version = startNavigation(activeTab.id);

    set((currentState) => {
      const index = getTabIndex(currentState.tabs, activeTab.id);
      if (index === -1) return currentState;
      const tabs = [...currentState.tabs];
      tabs[index] = nextTab;
      return {
        tabs,
        activeFilePath:
          currentState.activeTabId === activeTab.id ? targetPath : currentState.activeFilePath,
      };
    });

    if (!targetPath) return;

    try {
      await ensureFileLoaded(targetPath, set as EditorStateSetter, get);
    } catch {
      if (!isNavigationCurrent(activeTab.id, version)) return;

      set((currentState) => {
        const index = getTabIndex(currentState.tabs, activeTab.id);
        if (index === -1) return currentState;
        const tabs = [...currentState.tabs];
        tabs[index] = previousTab;
        const files = maybePruneFiles(currentState, tabs, [targetPath]);
        return {
          tabs,
          activeFilePath:
            currentState.activeTabId === activeTab.id
              ? locationPrimaryPath(previousTab.location)
              : currentState.activeFilePath,
          ...(files ? { openFiles: files } : {}),
        };
      });
    }
  },

  renameOpenFile: (oldPath: string, newPath: string) => {
    let shouldScheduleSave = false;

    set((state) => {
      const file = state.openFiles.get(oldPath);
      if (!file) return state;

      shouldScheduleSave = file.isDirty;

      const files = new Map(state.openFiles);
      files.delete(oldPath);
      files.set(newPath, { ...file, path: newPath });

      const rewrite = (loc: Location) => rewriteLocation(loc, oldPath, newPath);
      const tabs = state.tabs.map((tab) => applyRewriteToTab(tab, rewrite) ?? tab);

      return {
        openFiles: files,
        tabs,
        activeFilePath: state.activeFilePath === oldPath ? newPath : state.activeFilePath,
      };
    });

    cancelSave(oldPath);
    if (shouldScheduleSave) scheduleSave(newPath);
  },

  // Drop every reference to `path` from editor state. Used after a delete so
  // tabs, history, openFiles, and pending saves are all cleaned up explicitly
  // instead of relying on the file watcher to fix things up later.
  removePathReferences: (path: string) => {
    set((state) => {
      const transform = (loc: Location) => removeFromLocation(loc, path);
      const tabs = state.tabs
        .map((tab) => applyRewriteToTab(tab, transform))
        .filter((tab): tab is Tab => tab !== null);

      let activeTabId = state.activeTabId;
      if (!tabs.some((tab) => tab.id === activeTabId)) {
        activeTabId = tabs[0]?.id ?? null;
      }

      const files = state.openFiles.has(path) ? new Map(state.openFiles) : null;
      files?.delete(path);

      return {
        tabs,
        activeTabId,
        activeFilePath: deriveActiveFilePath(tabs, activeTabId),
        ...(files ? { openFiles: files } : {}),
      };
    });

    cancelSave(path);

    if (get().tabs.length === 0) {
      get().ensureLauncherTab();
    }
  },

  // Drop every reference to paths starting with `prefix` from editor state.
  // Used after deleting a folder to clean up all contained files.
  removePathsWithPrefix: (prefix: string) => {
    const dirPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const matches = (p: string) => p === prefix || p.startsWith(dirPrefix);

    const cancelledPaths: string[] = [];

    set((state) => {
      const transform = (loc: Location): Location | null => {
        for (const p of locationPaths(loc)) {
          if (matches(p)) {
            return removeFromLocation(loc, p);
          }
        }
        return loc;
      };
      const tabs = state.tabs
        .map((tab) => applyRewriteToTab(tab, transform))
        .filter((tab): tab is Tab => tab !== null);

      let activeTabId = state.activeTabId;
      if (!tabs.some((tab) => tab.id === activeTabId)) {
        activeTabId = tabs[0]?.id ?? null;
      }

      const files = new Map(state.openFiles);
      for (const path of files.keys()) {
        if (matches(path)) {
          cancelledPaths.push(path);
          files.delete(path);
        }
      }

      return {
        tabs,
        activeTabId,
        activeFilePath: deriveActiveFilePath(tabs, activeTabId),
        openFiles: files,
      };
    });

    for (const path of cancelledPaths) {
      cancelSave(path);
    }

    if (get().tabs.length === 0) {
      get().ensureLauncherTab();
    }
  },

  // Rewrite a path prefix across all tabs, histories, and openFiles.
  // Used after renaming a folder to update all contained file references.
  rewritePathPrefix: (oldPrefix: string, newPrefix: string) => {
    const dirPrefix = oldPrefix.endsWith("/") ? oldPrefix : `${oldPrefix}/`;
    const rewritePath = (p: string) => {
      if (p === oldPrefix) return newPrefix;
      if (p.startsWith(dirPrefix)) return newPrefix + p.slice(oldPrefix.length);
      return p;
    };

    const reschedulePaths: string[] = [];

    set((state) => {
      const transform = (loc: Location): Location | null => {
        let next: Location = loc;
        for (const p of locationPaths(loc)) {
          const rewritten = rewritePath(p);
          if (rewritten !== p) {
            const applied = rewriteLocation(next, p, rewritten);
            if (!applied) return null;
            next = applied;
          }
        }
        return next;
      };
      const tabs = state.tabs
        .map((tab) => applyRewriteToTab(tab, transform))
        .filter((tab): tab is Tab => tab !== null);

      const files = new Map<string, OpenFile>();
      for (const [path, file] of state.openFiles) {
        const newPath = rewritePath(path);
        if (newPath !== path) {
          files.set(newPath, { ...file, path: newPath });
          if (file.isDirty) reschedulePaths.push(newPath);
          cancelSave(path);
        } else {
          files.set(path, file);
        }
      }

      return {
        tabs,
        openFiles: files,
        activeFilePath: state.activeFilePath ? rewritePath(state.activeFilePath) : null,
      };
    });

    for (const path of reschedulePaths) {
      scheduleSave(path);
    }
  },

  restoreSession: async (
    tabs: SessionTab[],
    activeIndex: number | null,
    prefetchedActiveFile: FileContent | null = null,
  ) => {
    const restoredTabs: Tab[] = [];
    for (const sessionTab of tabs) {
      const location = deserializeLocation(sessionTab.location);
      if (!location) continue;
      const back = sessionTab.back
        .map((l) => deserializeLocation(l))
        .filter((l): l is Location => l !== null);
      const forward = sessionTab.forward
        .map((l) => deserializeLocation(l))
        .filter((l): l is Location => l !== null);
      restoredTabs.push({
        id: createTabId(),
        location,
        back,
        forward,
      });
    }

    if (restoredTabs.length === 0) {
      set({
        openFiles: new Map(),
        tabs: [],
        activeTabId: null,
        activeFilePath: null,
      });
      get().ensureLauncherTab();
      return;
    }

    const uniquePaths = [
      ...new Set(
        restoredTabs.flatMap((tab) => [
          ...locationPaths(tab.location),
          ...tab.back.flatMap((l) => locationPaths(l)),
          ...tab.forward.flatMap((l) => locationPaths(l)),
        ]),
      ),
    ];
    const activeTabIndex = activeIndex ?? 0;
    const activeTab = restoredTabs[activeTabIndex] ?? restoredTabs[0] ?? null;
    const activePath = activeTab ? locationPrimaryPath(activeTab.location) : null;

    // If the bundled `restore_workspace` IPC pre-fetched the active file, seed
    // it directly so the editor can mount with content already in place — no
    // round-trip back to Rust for the most-visible tab.
    const seededActive =
      prefetchedActiveFile && activePath && prefetchedActiveFile.path === activePath
        ? (() => {
            const parsed = parseDocument(prefetchedActiveFile.content);
            return withDerived({
              ...createLoadingFile(activePath),
              path: activePath,
              frontmatter: parsed.frontmatter,
              content: parsed.body ?? "",
              title: parsed.title,
              titleSource: parsed.titleSource,
              diskContent: prefetchedActiveFile.content,
              isLoading: false,
            });
          })()
        : null;

    set((state) => {
      const files = new Map(state.openFiles);
      for (const path of uniquePaths) {
        if (!files.has(path)) files.set(path, createLoadingFile(path));
      }
      if (seededActive && activePath) {
        files.set(activePath, seededActive);
      }

      return {
        openFiles: files,
        tabs: restoredTabs,
        activeTabId: activeTab?.id ?? null,
        activeFilePath: activePath,
      };
    });

    // Skip the active path if we already seeded it from the prefetch — the
    // remaining background tabs still get loaded in parallel.
    const pathsToLoad = seededActive
      ? uniquePaths.filter((path) => path !== activePath)
      : uniquePaths;

    const results = await Promise.allSettled(
      pathsToLoad.map((path) => ensureFileLoaded(path, set as EditorStateSetter, get)),
    );
    const failedPaths = new Set(
      pathsToLoad.filter((_, index) => results[index]?.status === "rejected"),
    );

    if (failedPaths.size === 0) return;

    let shouldEnsureLauncher = false;
    set((state) => {
      const transform = (loc: Location): Location | null => {
        for (const p of locationPaths(loc)) {
          if (failedPaths.has(p)) return null;
        }
        return loc;
      };
      const nextTabs = state.tabs
        .map((tab) => applyRewriteToTab(tab, transform))
        .filter((tab): tab is Tab => tab !== null);
      const files = new Map(state.openFiles);
      for (const path of failedPaths) files.delete(path);

      const activeTabId = nextTabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : (nextTabs[0]?.id ?? null);
      shouldEnsureLauncher = nextTabs.length === 0;

      return {
        openFiles: files,
        tabs: nextTabs,
        activeTabId,
        activeFilePath: deriveActiveFilePath(nextTabs, activeTabId),
      };
    });

    if (shouldEnsureLauncher) get().ensureLauncherTab();
  },

  updateContent: (path: string, content: string) => {
    const file = get().openFiles.get(path);
    if (!file) return;

    set((state) => {
      const existing = state.openFiles.get(path);
      if (!existing) return state;
      if (existing.content === content && existing.isDirty) return state;

      const { title, titleSource } = inferTitle(content, existing.frontmatter);
      const files = new Map(state.openFiles);
      files.set(
        path,
        withDerivedStats({
          ...existing,
          content,
          title,
          titleSource,
          isDirty: true,
        }),
      );
      return { openFiles: files };
    });

    scheduleSave(path);
  },

  updateFrontmatter: (path: string, frontmatter: string | null) => {
    set((state) => {
      const file = state.openFiles.get(path);
      if (!file || file.frontmatter === frontmatter) return state;

      const { title, titleSource } = inferTitle(file.content, frontmatter);
      const files = new Map(state.openFiles);
      files.set(
        path,
        withDerivedDate({
          ...file,
          frontmatter,
          title,
          titleSource,
          isDirty: true,
        }),
      );
      return { openFiles: files };
    });

    scheduleSave(path);
  },

  markSaved: (path: string, diskContent: string, hasNewerChanges = false) => {
    set((state) => {
      const file = state.openFiles.get(path);
      if (!file) return state;

      const files = new Map(state.openFiles);
      files.set(path, {
        ...file,
        diskContent,
        isDirty: hasNewerChanges,
        saveError: null,
      });
      return { openFiles: files };
    });
  },

  setSaveError: (path: string, error: string | null) => {
    set((state) => {
      const file = state.openFiles.get(path);
      if (!file || file.saveError === error) return state;

      const files = new Map(state.openFiles);
      files.set(path, { ...file, saveError: error });
      return { openFiles: files };
    });
  },

  reloadFromDisk: (path: string, rawContent: string) => {
    cancelSave(path);
    const parsed = parseDocument(rawContent);
    set((state) => {
      const file = state.openFiles.get(path);
      if (!file) return state;

      const files = new Map(state.openFiles);
      files.set(
        path,
        withDerived({
          ...file,
          frontmatter: parsed.frontmatter,
          content: parsed.body ?? "",
          title: parsed.title,
          titleSource: parsed.titleSource,
          diskContent: rawContent,
          isDirty: false,
          reloadVersion: file.reloadVersion + 1,
        }),
      );
      return { openFiles: files };
    });
  },

  updateScrollPos: (path: string, pos: number) => {
    set((state) => {
      const file = state.openFiles.get(path);
      if (!file || file.scrollPos === pos) return state;

      const files = new Map(state.openFiles);
      files.set(path, { ...file, scrollPos: pos });
      return { openFiles: files };
    });
  },

  updateScrollAnchor: (path: string, anchor: ScrollAnchor | null) => {
    set((state) => {
      const file = state.openFiles.get(path);
      if (!file) return state;
      const prev = file.scrollAnchor;
      if (prev === anchor) return state;
      if (prev && anchor && prev.pos === anchor.pos && prev.offsetPx === anchor.offsetPx) {
        return state;
      }

      const files = new Map(state.openFiles);
      files.set(path, { ...file, scrollAnchor: anchor });
      return { openFiles: files };
    });
  },

  updateCursorPos: (path: string, pos: number) => {
    set((state) => {
      const file = state.openFiles.get(path);
      if (!file || file.cursorPos === pos) return state;

      const files = new Map(state.openFiles);
      files.set(path, { ...file, cursorPos: pos });
      return { openFiles: files };
    });
  },
}));

export function getEditorSessionSnapshot(state: Pick<EditorState, "tabs" | "activeTabId">) {
  const tabs: SessionTab[] = [];
  let activeIndex: number | null = null;
  state.tabs.forEach((tab) => {
    const location = serializeLocation(tab.location);
    if (!location) return;
    const back = tab.back
      .map((l) => serializeLocation(l))
      .filter((l): l is SerializedLocation => l !== null);
    const forward = tab.forward
      .map((l) => serializeLocation(l))
      .filter((l): l is SerializedLocation => l !== null);
    const index = tabs.length;
    tabs.push({ location, back, forward });
    if (state.activeTabId && tab.id === state.activeTabId) {
      activeIndex = index;
    }
  });
  return { tabs, activeIndex };
}
