import { useCallback, useTransition, type MouseEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  useActiveTabId,
  useCanNavigateBack,
  useCanNavigateForward,
  useCloseTab,
  useFileSaveError,
  useIsFileLoading,
  useNavigateBack,
  useNavigateForward,
  useOpenNewTab,
  useOpenTabs,
  useResolvedDocumentTitle,
  useSetActiveTab,
  type Tab,
} from "@/hooks/use-tabs";
import { ScrollFade } from "@/components/scroll-fade";
import { useScrollActiveTabIntoView } from "@/hooks/use-scroll-active-tab-into-view";
import { useEditorStore } from "@/stores/editor-store";
import { getRelativePath } from "@/lib/paths";
import { pageKind } from "./page-kinds";
import { buildTabMenuItemsSpec, showNativeContextMenu } from "./editor-context-menu";
import { useWorkspaceRoot } from "@/hooks/use-workspace";

interface EditorTabButtonProps {
  tab: Tab;
  isActive: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, tab: Tab) => void;
}

function EditorTabButton({
  tab,
  isActive,
  onSelect,
  onClose,
  onContextMenu,
}: EditorTabButtonProps) {
  const kind = pageKind(tab.location);
  const filePath = kind.primaryPath(tab.location);
  const isLoading = useIsFileLoading(filePath ?? "");
  const saveError = useFileSaveError(filePath);
  const documentTitle = useResolvedDocumentTitle(filePath);
  const title = documentTitle || kind.title(tab.location);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(tab.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(tab.id);
      }}
      onContextMenu={(event) => {
        if (!kind.supportsFileContextMenu || !onContextMenu) return;
        event.preventDefault();
        onContextMenu(event, tab);
      }}
      className={` group relative flex shrink-0 items-center overflow-hidden whitespace-nowrap rounded-[8px] px-3.5 text-[13px] leading-[1.15] select-none cursor-default max-w-[180px] h-[var(--chrome-control-height)] ${
        isActive
          ? "bg-[var(--tab-active-bg)] text-[var(--text-secondary)] backdrop-blur-2xl"
          : "bg-transparent text-[var(--text-muted)] hover:bg-[var(--tab-active-bg)] hover:text-[var(--text-secondary)] hover:backdrop-blur-2xl"
      }`}
    >
      {saveError ? (
        <span
          aria-label={`Save failed: ${saveError}`}
          title={`Save failed: ${saveError}`}
          className="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff5f57]"
        />
      ) : null}
      <span
        className={`truncate group-hover:[mask-image:linear-gradient(to_right,black,black_calc(100%_-_28px),transparent)] group-hover:[-webkit-mask-image:linear-gradient(to_right,black,black_calc(100%_-_32px),transparent_calc(100%_-_8px))] ${isLoading ? "animate-pulse opacity-60" : ""}`}
      >
        {title}
      </span>
      <div
        className="pointer-events-none absolute inset-y-0 right-0 flex translate-x-full items-center justify-end pr-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
        style={{ width: 40 }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose(tab.id);
          }}
          className="pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[13px] leading-none text-[var(--text-icon-muted)] hover:text-[var(--text-secondary)]"
          aria-label={`Close ${title}`}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function EditorTabs() {
  const tabs = useOpenTabs();
  const activeTabId = useActiveTabId();
  const setActiveTab = useSetActiveTab();
  const closeTab = useCloseTab();
  const canNavigateBack = useCanNavigateBack();
  const canNavigateForward = useCanNavigateForward();
  const navigateBack = useNavigateBack();
  const navigateForward = useNavigateForward();
  const openNewTab = useOpenNewTab();
  const workspaceRoot = useWorkspaceRoot();
  const [, startTransition] = useTransition();
  useScrollActiveTabIntoView();

  const handleTabContextMenu = useCallback(
    (_event: MouseEvent<HTMLElement>, tab: Tab) => {
      const kind = pageKind(tab.location);
      if (!kind.supportsFileContextMenu) return;
      const filePath = kind.primaryPath(tab.location);
      if (!filePath) return;
      const relative = workspaceRoot ? getRelativePath(filePath, workspaceRoot) : filePath;

      void showNativeContextMenu(
        buildTabMenuItemsSpec({
          onClose: () => closeTab(tab.id),
          onCloseOthers: () => {
            const state = useEditorStore.getState();
            for (const t of state.tabs) {
              if (t.id !== tab.id) closeTab(t.id);
            }
          },
          onCloseAll: () => {
            const ids = useEditorStore.getState().tabs.map((t) => t.id);
            for (const id of ids) {
              closeTab(id);
            }
          },
          onRevealInSidebar: () => {
            // Setting the active file highlights it in the sidebar tree
            setActiveTab(tab.id);
          },
          onCopyPath: () => {
            void writeText(relative);
          },
        }),
      );
    },
    [closeTab, setActiveTab, workspaceRoot],
  );

  return (
    <div
      data-tauri-drag-region
      className="group/tabs flex min-w-0 items-center gap-3"
      style={{
        height: "calc(var(--chrome-control-height) + var(--chrome-control-padding) * 2)",
        paddingBlock: "var(--chrome-control-padding)",
      }}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void navigateBack()}
          disabled={!canNavigateBack}
          className="flex h-[var(--chrome-control-height)] w-7 items-center justify-center rounded-lg text-base text-[var(--text-icon-muted)] transition-colors enabled:hover:bg-[var(--surface-subtle)] enabled:hover:text-[var(--text-secondary)] disabled:opacity-30"
          title="Back"
          aria-label="Back"
        >
          ←
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void navigateForward()}
          disabled={!canNavigateForward}
          className="flex h-[var(--chrome-control-height)] w-7 items-center justify-center rounded-lg text-base text-[var(--text-icon-muted)] transition-colors enabled:hover:bg-[var(--surface-subtle)] enabled:hover:text-[var(--text-secondary)] disabled:opacity-30"
          title="Forward"
          aria-label="Forward"
        >
          →
        </button>
      </div>

      <div data-tauri-drag-region className="relative flex min-w-0 flex-1 items-center">
        <ScrollFade
          axis="horizontal"
          data-tab-strip
          data-tauri-drag-region
          className="flex min-w-0 items-center overflow-x-auto scrollbar-none"
        >
          <div data-tauri-drag-region className="flex min-w-max items-center gap-1">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;

              return (
                <div key={tab.id} data-tab-id={tab.id} className="flex items-center">
                  <EditorTabButton
                    tab={tab}
                    isActive={isActive}
                    onSelect={(tabId) => startTransition(() => setActiveTab(tabId))}
                    onClose={closeTab}
                    onContextMenu={handleTabContextMenu}
                  />
                </div>
              );
            })}
          </div>
        </ScrollFade>
        <button
          type="button"
          onClick={openNewTab}
          className="ml-1 flex h-[var(--chrome-control-height)] w-9 shrink-0 items-center justify-center rounded-lg text-base text-[var(--text-icon-muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--text-secondary)]"
          title="New tab"
          aria-label="New tab"
        >
          +
        </button>
      </div>
    </div>
  );
}
