import { memo, useEffect, useRef, type MouseEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { File02Icon, Folder01Icon, Folder02Icon } from "@hugeicons/core-free-icons";
import { useIsActive, useResolvedDocumentTitle } from "@/hooks/use-tabs";
import { getFileStem } from "@/lib/paths";
import type { DirEntry } from "@/types/fs";

function FolderIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <HugeiconsIcon
      icon={isExpanded ? Folder02Icon : Folder01Icon}
      size={16}
      color="currentColor"
      strokeWidth={2}
    />
  );
}

function FileIcon() {
  return <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={2} />;
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
}: FileTreeNodeProps) {
  const isActive = useIsActive(entry.path);
  const editorTitle = useResolvedDocumentTitle(entry.is_dir ? null : entry.path);
  const displayName = entry.is_dir
    ? entry.name
    : editorTitle || entry.title || getFileStem(entry.name);
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
  const toneClassName = isHighlighted
    ? "text-[var(--fg-base)]"
    : "text-[var(--text-muted)] hover:text-[var(--fg-base)]";

  function handleClick(event: MouseEvent<HTMLElement>) {
    if (isRenaming) return;
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
    if (!entry.is_dir && !entry.is_markdown) return;
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
          className="flex w-5 shrink-0 items-center justify-center text-current"
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
      aria-label={entry.is_dir ? `${entry.name} folder` : displayName}
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pr-2 text-left text-[13px] leading-[1.15] transition-colors ${toneClassName} ${bgClassName}`}
      style={{ paddingLeft: depth === 0 ? 10 : depth * 12 + 6 }}
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-current">
        {entry.is_dir ? <FolderIcon isExpanded={isExpanded} /> : <FileIcon />}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{displayName}</span>
    </button>
  );
});
