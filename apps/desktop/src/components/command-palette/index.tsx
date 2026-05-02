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
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "@/hooks/use-command-palette";
import { useSidebar } from "@/hooks/use-sidebar";
import { useWorkspace } from "@/hooks/use-workspace";
import {
  useActiveTabId,
  useCloseActiveTab,
  useCloseTab,
  useOpenFile,
  useOpenSettingsTab,
  useOpenTabs,
} from "@/hooks/use-tabs";
import { useTheme } from "@/hooks/use-theme";
import { useFuzzySearch } from "./use-fuzzy-search";
import { settingsKind } from "@/components/editor-area/page-kinds/settings";
import { getFileName } from "@/lib/paths";
import * as tauri from "@/lib/tauri";

function toCreatePath(root: string, rawName: string) {
  const trimmed = rawName.trim();
  const fileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  return `${root}/${fileName}`;
}

export function CommandPalette() {
  const isOpen = useIsCommandPaletteOpen();
  const close = useCloseCommandPalette();
  const openCommandPalette = useOpenCommandPalette();
  const intent = useCommandPaletteIntent();
  const search = useCommandPaletteSearch();
  const setSearch = useSetCommandPaletteSearch();
  const { toggleSidebar } = useSidebar();
  const { root, isIndexing, openWorkspace, closeWorkspace } = useWorkspace();
  const openFile = useOpenFile();
  const closeActiveTab = useCloseActiveTab();
  const closeTab = useCloseTab();
  const activeTabId = useActiveTabId();
  const tabs = useOpenTabs();
  const { toggleTheme } = useTheme();
  const openSettingsTab = useOpenSettingsTab();

  const isCreateIntent = intent === "create-file";
  const trimmedSearch = search.trim();
  const fileQuery = isCreateIntent ? "" : search;
  const results = useFuzzySearch(fileQuery);
  const createPath = root && trimmedSearch ? toCreatePath(root, trimmedSearch) : null;

  function matchesSearch(text: string, q: string) {
    return text.toLowerCase().includes(q.toLowerCase());
  }

  function handleSelect(path: string) {
    void openFile(path);
    close();
  }

  function handleCreate() {
    if (!createPath) return;

    close();
    void (async () => {
      await tauri.createFile(createPath);
      await openFile(createPath);
    })();
  }

  async function handleOpenWorkspace() {
    const picked = await tauri.pickWorkspace();
    if (picked) {
      await openWorkspace(picked);
    }
    close();
  }

  type Command = { id: string; label: string; description: string; run: () => void };

  const commands: Command[] = [
    root && {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      description: "Command",
      run: () => {
        toggleSidebar();
        close();
      },
    },
    root && {
      id: "new-file",
      label: "Create New File",
      description: "Command",
      run: () => openCommandPalette("create-file"),
    },
    activeTabId && {
      id: "close-tab",
      label: "Close Current Tab",
      description: "Command",
      run: () => {
        closeActiveTab();
        close();
      },
    },
    tabs.length > 0 && {
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
    {
      id: "open-settings",
      label: "Settings",
      description: settingsKind.description,
      run: () => {
        openSettingsTab();
        close();
      },
    },
  ].filter((c): c is Command => Boolean(c));

  const visibleFiles: SearchResult[] = !isCreateIntent && trimmedSearch ? results : [];
  const visibleCommands = isCreateIntent
    ? []
    : trimmedSearch
      ? commands.filter((c) => matchesSearch(c.label, trimmedSearch))
      : commands;
  const firstValue = visibleCommands[0]?.id ?? visibleFiles[0]?.path ?? "";

  const listRef = useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState(firstValue);

  // Snap selection + scroll to the first item whenever the search/intent
  // changes, or when async file results arrive and the first item shifts.
  // firstValue is a primitive, so this is stable across renders.
  useEffect(() => {
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [search, intent, firstValue]);

  function renderHighlightedPath(path: string, indices: number[]) {
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

  const placeholder = isCreateIntent ? "Create a new note..." : "Search...";

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
      <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
      <CommandList ref={listRef}>
        {isCreateIntent ? (
          <>
            {!trimmedSearch && <CommandEmpty>Type a note name to create it.</CommandEmpty>}
            {createPath && (
              <CommandGroup heading="Create note">
                <CommandItem value={createPath} onSelect={handleCreate}>
                  Create: {getFileName(createPath)}
                </CommandItem>
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            {visibleFiles.length === 0 && visibleCommands.length === 0 && (
              <CommandEmpty>
                {isIndexing && trimmedSearch ? "Indexing workspace..." : "No results found."}
              </CommandEmpty>
            )}

            {(visibleFiles.length > 0 || visibleCommands.length > 0) && (
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
                        {renderHighlightedPath(r.relative_path, r.match_indices)}
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
