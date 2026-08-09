import { useEffect, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import type { SearchResult } from "@/types/fs";
import {
  useCloseCommandPalette,
  useCommandPaletteIntent,
  useCommandPaletteSearch,
  useCommandPaletteSession,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "@/hooks/use-command-palette";
import { useSidebar } from "@/hooks/use-sidebar";
import { useIsCompactFileMode, useWorkspace } from "@/hooks/use-workspace";
import {
  useActiveFilePath,
  useActiveTabId,
  useCloseActiveTab,
  useCloseTab,
  useOpenFile,
  useOpenSettingsTab,
  useOpenTabs,
} from "@/hooks/use-tabs";
import { useTheme } from "@/hooks/use-theme";
import { useFuzzySearch } from "./use-fuzzy-search";
import { useGlobalRecentFiles } from "@/hooks/use-global-recent-files";
import { openStandaloneFile } from "@/hooks/use-open-drop";
import { useCreateEntry } from "@/hooks/use-create-entry";
import { getCommandPaletteSession } from "@/hooks/command-palette-api";
import { runCreateRequest } from "./run-create-request";
import { settingsKind } from "@/components/editor-area/page-kinds/settings";
import { getFileName, getFileStem, getParentDir } from "@/lib/paths";
import { getEntryCreationPath, planEntryCreation } from "@/lib/entry-creation";
import * as tauri from "@/lib/tauri";
import type { RecentFile } from "@/lib/tauri";

function matchesSearch(text: string, q: string) {
  return text.toLowerCase().includes(q.toLowerCase());
}

function HighlightedPath({ path, indices }: { path: string; indices: number[] }) {
  const set = new Set(indices);
  return (
    <span>
      {Array.from(path).map((char, i) => (
        <span key={i} className={set.has(i) ? "text-link font-semibold" : undefined}>
          {char}
        </span>
      ))}
    </span>
  );
}

export function CommandPalette() {
  const isOpen = useIsCommandPaletteOpen();
  const close = useCloseCommandPalette();
  const openCommandPalette = useOpenCommandPalette();
  const intent = useCommandPaletteIntent();
  const search = useCommandPaletteSearch();
  const paletteSession = useCommandPaletteSession();
  const setSearch = useSetCommandPaletteSearch();
  const { toggleSidebar } = useSidebar();
  const { root, isIndexing, openWorkspace, closeWorkspace } = useWorkspace();
  const openFile = useOpenFile();
  const closeActiveTab = useCloseActiveTab();
  const closeTab = useCloseTab();
  const activeTabId = useActiveTabId();
  const activeFilePath = useActiveFilePath();
  const tabs = useOpenTabs();
  const { toggleTheme } = useTheme();
  const openSettingsTab = useOpenSettingsTab();
  const isCompactFileMode = useIsCompactFileMode();
  const createEntry = useCreateEntry();

  const createKind = intent === "create-file" ? "file" : null;
  const isCreateIntent = createKind !== null;
  const trimmedSearch = search.trim();
  const fileQuery = isCreateIntent ? "" : search;
  // Standalone compact windows have no workspace index — search filters the
  // global recents list client-side instead of hitting fuzzy_search.
  const results = useFuzzySearch(isCompactFileMode ? "" : fileQuery);
  const { files: globalRecents } = useGlobalRecentFiles(30, isOpen && isCompactFileMode);
  // In standalone mode new files are created next to the active file.
  const createBaseDir = root ?? (activeFilePath ? getParentDir(activeFilePath) : null);
  const createPlan =
    createBaseDir && createKind ? planEntryCreation(createBaseDir, search, createKind) : null;
  const createTarget = createPlan?.ok ? createPlan.target : null;
  const createPath = createTarget ? getEntryCreationPath(createTarget) : null;
  const [createErrorState, setCreateErrorState] = useState<{
    session: number;
    message: string;
  } | null>(null);
  const createError =
    createErrorState?.session === paletteSession ? createErrorState.message : null;

  function handleSelect(path: string) {
    void (isCompactFileMode ? openStandaloneFile(path) : openFile(path));
    close();
  }

  function handleCreate() {
    if (!createTarget) return;

    const requestSession = paletteSession;
    setCreateErrorState(null);
    void runCreateRequest({
      create: () => createEntry(createTarget, isCompactFileMode ? "standalone" : "workspace"),
      isCurrent: () => getCommandPaletteSession() === requestSession,
      onCreated: (result) => {
        close();

        if (result.followUpFailures.length > 0) {
          const failedSteps = [
            result.followUpFailures.some((failure) => failure.step === "refresh")
              ? "refresh the sidebar"
              : null,
            result.followUpFailures.some((failure) => failure.step === "open")
              ? "open the file"
              : null,
          ].filter((step): step is string => Boolean(step));
          const details = result.followUpFailures
            .map((failure) =>
              failure.error instanceof Error ? failure.error.message : String(failure.error),
            )
            .join("\n");
          window.alert(
            `Created "${createTarget.name}", but Writer could not ${failedSteps.join(" or ")}.\n${details}`,
          );
        }
      },
      onCreationError: (error) => {
        setCreateErrorState({
          session: requestSession,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  async function handleOpenWorkspace() {
    const picked = await tauri.pickWorkspace();
    if (picked) {
      // Standalone compact windows stay pure — workspaces open elsewhere.
      if (isCompactFileMode) {
        await tauri.openWorkspaceInNewWindow(picked);
      } else {
        await openWorkspace(picked);
      }
    }
    close();
  }

  type Command = { id: string; label: string; description: string; run: () => void };

  const commands: Command[] = [
    root &&
      !isCompactFileMode && {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
        description: "Command",
        run: () => {
          toggleSidebar();
          close();
        },
      },
    (root || (isCompactFileMode && activeFilePath)) && {
      id: "new-file",
      label: "Create New File",
      description: "Command",
      run: () => openCommandPalette("create-file"),
    },
    root &&
      activeFilePath && {
        id: "open-in-compact-window",
        label: "Open File in Compact Window",
        description: "Command",
        run: () => {
          void tauri.openFileInStandaloneWindow(activeFilePath);
          close();
        },
      },
    activeTabId &&
      !isCompactFileMode && {
        id: "close-tab",
        label: "Close Current Tab",
        description: "Command",
        run: () => {
          closeActiveTab();
          close();
        },
      },
    tabs.length > 0 &&
      !isCompactFileMode && {
        id: "close-all",
        label: "Close All Tabs",
        description: "Command",
        run: () => {
          for (const tab of tabs) closeTab(tab.id);
          close();
        },
      },
    {
      id: "open-workspace",
      label: "Open Workspace",
      description: "Command",
      run: () => void handleOpenWorkspace(),
    },
    root && {
      id: "close-workspace",
      label: "Close Workspace",
      description: "Command",
      run: () => {
        closeWorkspace();
        close();
      },
    },
    {
      id: "toggle-theme",
      label: "Toggle Dark Mode",
      description: "Command",
      run: () => {
        toggleTheme();
        close();
      },
    },
    !isCompactFileMode && {
      id: "open-settings",
      label: "Settings",
      description: settingsKind.description,
      run: () => {
        openSettingsTab();
        close();
      },
    },
  ].filter((c): c is Command => Boolean(c));

  const visibleFiles: SearchResult[] =
    !isCreateIntent && trimmedSearch && !isCompactFileMode ? results : [];
  const visibleRecents: RecentFile[] =
    !isCreateIntent && isCompactFileMode && trimmedSearch
      ? globalRecents.filter(
          (entry) =>
            matchesSearch(entry.title ?? "", trimmedSearch) ||
            matchesSearch(entry.name, trimmedSearch) ||
            matchesSearch(entry.path, trimmedSearch),
        )
      : [];
  const visibleCommands = isCreateIntent
    ? []
    : trimmedSearch
      ? commands.filter((c) => matchesSearch(c.label, trimmedSearch))
      : commands;
  const firstValue = isCreateIntent
    ? (createPath ?? "")
    : (visibleCommands[0]?.id ?? visibleFiles[0]?.path ?? visibleRecents[0]?.path ?? "");

  const listRef = useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState(firstValue);

  // Snap selection + scroll to the first item whenever the search/intent
  // changes, or when async file results arrive and the first item shifts.
  // firstValue is a primitive, so this is stable across renders.
  // selectedValue is also set by cmdk onValueChange (keyboard nav) and this effect also scrolls the list — not pure derived state.
  /* eslint-disable react-doctor/no-derived-state */
  useEffect(() => {
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [search, intent, firstValue]);
  /* eslint-enable react-doctor/no-derived-state */

  const createLabel = "file";
  const placeholder = isCreateIntent ? `Create a new ${createLabel}...` : "Search...";

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      label="Command Palette"
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder={placeholder}
        value={search}
        onValueChange={(value) => {
          setCreateErrorState(null);
          setSearch(value);
        }}
      />
      <CommandList ref={listRef}>
        {isCreateIntent ? (
          <>
            {createError && <CommandEmpty>{createError}</CommandEmpty>}
            {!createError && createPlan && !createPlan.ok && (
              <CommandEmpty>{createPlan.error}</CommandEmpty>
            )}
            {!createError && createTarget && createPath && (
              <CommandGroup heading={`Create ${createLabel}`}>
                <CommandItem value={createPath} onSelect={handleCreate}>
                  Create: {getFileName(createPath)}
                </CommandItem>
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            {visibleFiles.length === 0 &&
              visibleRecents.length === 0 &&
              visibleCommands.length === 0 && (
                <CommandEmpty>
                  {isIndexing && trimmedSearch && !isCompactFileMode
                    ? "Indexing workspace..."
                    : "No results found."}
                </CommandEmpty>
              )}

            {(visibleFiles.length > 0 ||
              visibleRecents.length > 0 ||
              visibleCommands.length > 0) && (
              <CommandGroup
                heading={
                  trimmedSearch ? (isIndexing ? "Results (indexing...)" : "Results") : "Suggested"
                }
              >
                {visibleCommands.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={c.run}>
                    <div className="flex flex-col">
                      <span>{c.label}</span>
                      <span className="text-[13px] text-text-muted">{c.description}</span>
                    </div>
                  </CommandItem>
                ))}

                {visibleFiles.map((r) => (
                  <CommandItem key={r.path} value={r.path} onSelect={() => handleSelect(r.path)}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{getFileName(r.path)}</span>
                      <span className="truncate text-[13px] text-text-muted">
                        <HighlightedPath path={r.relative_path} indices={r.match_indices} />
                      </span>
                    </div>
                  </CommandItem>
                ))}

                {visibleRecents.map((entry) => (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    onSelect={() => handleSelect(entry.path)}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{entry.title || getFileStem(entry.name)}</span>
                      <span className="truncate text-[13px] text-text-muted">
                        {getParentDir(entry.path)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
