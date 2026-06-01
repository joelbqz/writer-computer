import { memo, useEffect, useRef, type MouseEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, File02Icon } from "@hugeicons/core-free-icons";
import { useIsActive, useResolvedDocumentTitle } from "@/hooks/use-tabs";
import { getFileStem } from "@/lib/paths";
import type { DirEntry } from "@/types/fs";

function FolderOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M2 18V7.54925C2 7.13285 2.00003 6.57825 2.00008 5.99979C2.00022 4.34307 3.34334 3.00002 5.00006 3.00005L8.1459 3.00009C9.28221 3.00011 10.321 3.64213 10.8292 4.65849L12 7.00024H16C17.4001 7.00024 18.1002 7.00024 18.635 7.27272C19.1054 7.5124 19.4878 7.89485 19.7275 8.36524C20 8.90001 20 9.60006 20 11.0002C20 12.4003 20 11.0821 20 11.0821"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.02277 13.1546C5.59126 12.426 6.46388 12 7.38808 12H20.2567C21.8556 12 22.8081 13.7833 21.919 15.1122L19.4647 18.7804C18.5367 20.1674 16.9779 21 15.3091 21H5.04755C2.54904 21 1.14537 18.1246 2.68225 16.1547L5.02277 13.1546Z"
        stroke="currentColor"
        strokeWidth={2}
      />
    </svg>
  );
}

function FolderClosedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 7L11.1056 7.44719C11.275 7.78599 11.6212 8 12 8V7ZM20.6667 7.50559L20.1111 8.33707L20.1112 8.33708L20.6667 7.50559ZM21.4944 8.33329L22.3259 7.77771L22.3258 7.77768L21.4944 8.33329ZM21.1573 18.7779L20.3258 18.2223L20.3258 18.2224L21.1573 18.7779ZM19.7779 20.1573L19.2224 19.3258L19.2223 19.3258L19.7779 20.1573ZM3.46447 19.5355L4.17159 18.8284L4.17156 18.8284L3.46447 19.5355ZM2.38032 4.53806L3.25355 5.02538L3.25355 5.02537L2.38032 4.53806ZM3.53806 3.38032L4.02537 4.25355L4.02538 4.25355L3.53806 3.38032ZM9.19926 3.19101L9.55039 2.25468L9.55038 2.25468L9.19926 3.19101ZM11.3666 5.73313L12.261 5.28594L12.261 5.2859L11.3666 5.73313ZM12 7V8H16.75V7V6H12V7ZM16.75 7V8C17.8242 8 18.5545 8.00121 19.1134 8.05806C19.6556 8.11322 19.9245 8.21235 20.1111 8.33707L20.6667 7.50559L21.2223 6.67411C20.6522 6.29324 20.0161 6.13958 19.3158 6.06833C18.6322 5.99879 17.7825 6 16.75 6V7ZM20.6667 7.50559L20.1112 8.33708C20.3295 8.48296 20.517 8.67044 20.663 8.8889L21.4944 8.33329L22.3258 7.77768C22.034 7.341 21.6591 6.96598 21.2222 6.6741L20.6667 7.50559ZM21.4944 8.33329L20.6629 8.88887C20.7876 9.0755 20.8868 9.34441 20.9419 9.88659C20.9988 10.4455 21 11.1758 21 12.25H22H23C23 11.2175 23.0012 10.3678 22.9317 9.68418C22.8604 8.98385 22.7068 8.34775 22.3259 7.77771L21.4944 8.33329ZM22 12.25H21C21 14.0264 20.9988 15.2834 20.8998 16.2565C20.8025 17.2128 20.6191 17.7834 20.3258 18.2223L21.1573 18.7779L21.9888 19.3335C22.5382 18.5112 22.7761 17.5734 22.8895 16.4589C23.0012 15.3611 23 13.9848 23 12.25H22ZM21.1573 18.7779L20.3258 18.2224C20.0341 18.6591 19.6591 19.0341 19.2224 19.3258L19.7779 20.1573L20.3334 20.9888C20.9885 20.5511 21.5511 19.9885 21.9888 19.3334L21.1573 18.7779ZM19.7779 20.1573L19.2223 19.3258C18.7834 19.6191 18.2128 19.8025 17.2565 19.8998C16.2834 19.9988 15.0264 20 13.25 20V21V22C14.9848 22 16.3611 22.0012 17.4589 21.8895C18.5734 21.7761 19.5112 21.5382 20.3335 20.9888L19.7779 20.1573ZM13.25 21V20H12V21V22H13.25V21ZM12 21V20C9.6147 20 7.92633 19.9979 6.64689 19.8259C5.39621 19.6577 4.68705 19.3439 4.17159 18.8284L3.46447 19.5355L2.75735 20.2426C3.70635 21.1916 4.90793 21.61 6.38039 21.808C7.82408 22.0021 9.67125 22 12 22V21ZM3.46447 19.5355L4.17156 18.8284C3.65611 18.313 3.34229 17.6038 3.17414 16.3531C3.00212 15.0736 3 13.3853 3 11H2H1C1 13.3287 0.997876 15.1759 1.19198 16.6196C1.38994 18.0921 1.80836 19.2936 2.75738 20.2426L3.46447 19.5355ZM2 11H3V7.94427H2H1V11H2ZM2 7.94427H3C3 7.01816 3.00091 6.38857 3.04368 5.90336C3.08529 5.4313 3.16053 5.19205 3.25355 5.02538L2.38032 4.53806L1.50709 4.05075C1.21979 4.56557 1.10487 5.12119 1.0514 5.72774C0.999094 6.32115 1 7.05391 1 7.94427H2ZM2.38032 4.53806L3.25355 5.02537C3.43428 4.70151 3.70152 4.43428 4.02537 4.25355L3.53806 3.38032L3.05075 2.50709C2.40302 2.86856 1.86856 3.40303 1.50709 4.05075L2.38032 4.53806ZM3.53806 3.38032L4.02538 4.25355C4.19205 4.16053 4.4313 4.08529 4.90336 4.04368C5.38857 4.00091 6.01816 4 6.94427 4V3V2C6.05391 2 5.32115 1.99909 4.72774 2.0514C4.12119 2.10487 3.56557 2.21979 3.05074 2.50709L3.53806 3.38032ZM6.94427 3V4C8.18672 4 8.5491 4.0152 8.84814 4.12734L9.19926 3.19101L9.55038 2.25468C8.8307 1.9848 8.02932 2 6.94427 2V3ZM9.19926 3.19101L8.84813 4.12734C9.57406 4.39957 9.89698 5.03001 10.4722 6.18036L11.3666 5.73313L12.261 5.2859C11.7866 4.33715 11.1503 2.85467 9.55039 2.25468L9.19926 3.19101ZM11.3666 5.73313L10.4722 6.18032L11.1056 7.44719L12 7L12.8944 6.55281L12.261 5.28594L11.3666 5.73313Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FolderIcon({ isExpanded }: { isExpanded: boolean }) {
  if (isExpanded) return <FolderOpenIcon />;
  return <FolderClosedIcon />;
}

function FileIcon() {
  return <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={1.8} />;
}

interface FileTreeNodeProps {
  entry: DirEntry;
  depth: number;
  isExpanded: boolean;
  isRenaming: boolean;
  isSelected: boolean;
  onToggleDir: (path: string) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  onClick?: (event: MouseEvent<HTMLElement>, entry: DirEntry) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, entry: DirEntry) => void;
  onRenameSubmit?: (entry: DirEntry, nextStem: string) => void;
  onRenameCancel?: () => void;
  /** Tree-wide label mode from `appearance.sidebar-file-label`. `"filename"`
   *  shows the file stem; anything else (incl. `undefined` pre-hydration)
   *  shows the document title, falling back to the stem. */
  fileLabelMode?: string;
}

export const FileTreeNode = memo(function FileTreeNode({
  entry,
  depth,
  isExpanded,
  isRenaming,
  isSelected,
  onToggleDir,
  onOpenFile,
  onClick,
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
  fileLabelMode,
}: FileTreeNodeProps) {
  const isActive = useIsActive(entry.path);
  const editorTitle = useResolvedDocumentTitle(entry.is_dir ? null : entry.path);
  const displayName = entry.is_dir
    ? entry.name
    : fileLabelMode === "filename"
      ? getFileStem(entry.name)
      : editorTitle || entry.title || getFileStem(entry.name);
  const renderedName = entry.missing ? `${displayName} (missing)` : displayName;
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and select the stem when entering rename mode.
  useEffect(() => {
    if (!isRenaming) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isRenaming]);

  const isHighlighted = isActive || isSelected;

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (isRenaming) return;
    if (entry.missing) return;
    // All clicks go through onClick so the parent can manage selection.
    // The parent decides whether to also open/toggle based on modifiers.
    if (onClick) {
      onClick(event, entry);
      return;
    }
    if (entry.is_dir) {
      void onToggleDir(entry.path);
    } else {
      void onOpenFile(entry.path);
    }
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    if (entry.missing || (!entry.is_dir && !entry.is_markdown)) return;
    if (!onContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(event, entry);
  }

  if (isRenaming) {
    // Directories show the full name; files show only the stem (extension is appended on submit).
    const initialValue = entry.is_dir ? entry.name : getFileStem(entry.name);
    return (
      <div
        className={`flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pr-2 text-[13px] leading-[1.15] ${
          isActive ? "bg-[var(--surface-subtle)]" : ""
        }`}
        style={{ paddingLeft: depth === 0 ? 10 : depth * 12 + 6 }}
      >
        <span
          className="flex w-5 antialiased shrink-0 items-center justify-center text-current"
          aria-hidden="true"
        >
          {entry.is_dir ? <FolderIcon isExpanded={isExpanded} /> : <FileIcon />}
        </span>
        <input
          ref={inputRef}
          type="text"
          defaultValue={initialValue}
          aria-label={`Rename ${entry.name}`}
          className="min-w-0 flex-1 rounded border border-[var(--surface-border)] bg-[var(--surface-elevated)] px-1 py-px text-[13px] leading-[1.15] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameSubmit?.(entry, event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel?.();
            }
          }}
          onBlur={(event) => onRenameSubmit?.(entry, event.currentTarget.value)}
        />
      </div>
    );
  }

  const bgClassName = isSelected
    ? "bg-[var(--surface-selected)]"
    : isActive
      ? "bg-[var(--surface-subtle)]"
      : "hover:bg-[var(--surface-subtle)]";

  return (
    <button
      type="button"
      role="treeitem"
      data-tree-path={entry.path}
      aria-selected={isActive}
      aria-expanded={entry.is_dir ? isExpanded : undefined}
      aria-label={
        entry.missing
          ? `${renderedName} unavailable`
          : entry.is_dir
            ? `${entry.name} folder`
            : displayName
      }
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`group ${entry.is_dir ? "group/folder " : ""}flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pr-2 text-left text-[13px] leading-[1.15] text-[var(--fg-base)] ${entry.missing ? "cursor-default" : ""} ${bgClassName}`}
      style={{ paddingLeft: depth === 0 ? 10 : depth * 12 + 6 }}
    >
      <span className="relative flex w-5 shrink-0 items-center justify-center">
        {entry.is_dir ? (
          <>
            <span className="flex items-center justify-center opacity-60 group-hover:opacity-100 group-hover/folder:opacity-0">
              <FolderIcon isExpanded={isExpanded} />
            </span>
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/folder:opacity-100">
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={16}
                color="currentColor"
                strokeWidth={2}
                className={`transition-transform duration-200 ease-out ${isExpanded ? "rotate-90" : ""}`}
              />
            </span>
          </>
        ) : (
          <span className="opacity-60 group-hover:opacity-100">
            <FileIcon />
          </span>
        )}
      </span>
      <span
        className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${isHighlighted ? "opacity-100" : "opacity-60 group-hover:opacity-100"}`}
      >
        {renderedName}
      </span>
    </button>
  );
});
