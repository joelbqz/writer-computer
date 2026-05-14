import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { SearchCursor, findNext, findPrevious, replaceAll, replaceNext } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
  applyEditorSearchQuery,
  closeEditorSearch,
  useEditorSearchStore,
} from "./editor-search-store";
import { SurfaceCard } from "@/components/surface-card";

interface MatchInfo {
  current: number;
  total: number;
}

function computeMatchInfo(view: EditorView, query: string): MatchInfo | null {
  if (!query) return null;
  const doc = view.state.doc;
  const head = view.state.selection.main.head;
  let total = 0;
  let current = 0;
  try {
    const cursor = new SearchCursor(doc, query, 0, doc.length, (s) => s.toLowerCase());
    let it = cursor.next();
    while (!it.done) {
      total++;
      const m = it.value;
      if (current === 0 && m.from <= head && m.to >= head) current = total;
      else if (current === 0 && m.from > head) current = total;
      it = cursor.next();
    }
  } catch {
    return null;
  }
  if (total > 0 && current === 0) current = 1;
  return { current, total };
}

export function EditorSearchOverlay() {
  const isOpen = useEditorSearchStore((s) => s.isOpen);
  const view = useEditorSearchStore((s) => s.view);
  const openVersion = useEditorSearchStore((s) => s.openVersion);
  const docVersion = useEditorSearchStore((s) => s.docVersion);

  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);

  // On open: pre-fill from selection (single-line only) and focus the find input.
  useEffect(() => {
    if (!isOpen || !view) return;
    const sel = view.state.selection.main;
    let nextQuery = query;
    if (sel.from !== sel.to) {
      const text = view.state.sliceDoc(sel.from, sel.to);
      if (!text.includes("\n")) {
        nextQuery = text;
        setQuery(text);
      }
    }
    applyEditorSearchQuery(view, nextQuery, replaceText);
    const focusFrame = requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
    return () => cancelAnimationFrame(focusFrame);
    // Only runs when the overlay is explicitly opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, view, openVersion]);

  const matchInfo = useMemo(() => {
    if (!isOpen || !view) return null;
    return computeMatchInfo(view, query);
    // docVersion bumps on every doc/selection change so the count recomputes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, view, query, docVersion]);

  const actions = useMemo(() => {
    function next() {
      if (view && query) findNext(view);
    }
    function prev() {
      if (view && query) findPrevious(view);
    }
    function doReplace() {
      if (view && query) replaceNext(view);
    }
    function doReplaceAll() {
      if (view && query) replaceAll(view);
    }
    function doClose() {
      closeEditorSearch({ restoreFocus: true });
    }
    return { next, prev, doReplace, doReplaceAll, doClose };
  }, [view, query]);

  if (!isOpen || !view) return null;

  function onFindKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      actions.doClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) actions.prev();
      else actions.next();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) actions.prev();
      else actions.next();
    }
  }

  function onQueryChange(nextQuery: string) {
    if (!view) return;
    setQuery(nextQuery);
    applyEditorSearchQuery(view, nextQuery, replaceText);
  }

  function onReplaceTextChange(nextReplaceText: string) {
    if (!view) return;
    setReplaceText(nextReplaceText);
    applyEditorSearchQuery(view, query, nextReplaceText);
  }

  function onReplaceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      actions.doClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      actions.doReplace();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) actions.prev();
      else actions.next();
    }
  }

  return (
    <SurfaceCard
      role="dialog"
      aria-label="Find in document"
      data-search-overlay
      className="pointer-events-auto absolute bottom-2 right-3 z-40 w-[min(560px,calc(100%-1.5rem))] overflow-hidden p-2"
    >
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 items-center justify-center text-[var(--fg-base)] opacity-[0.54]"
          >
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
          </span>
          <input
            ref={findInputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onFindKeyDown}
            placeholder="Find"
            aria-label="Find"
            className="w-full rounded-lg bg-[var(--surface-input)] pl-[34px] pr-16 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:outline-none h-[var(--chrome-control-height)]"
          />
          {matchInfo && query && (
            <span
              aria-live="polite"
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] tabular-nums text-[var(--text-muted)]"
            >
              {matchInfo.total === 0 ? "No matches" : `${matchInfo.current}/${matchInfo.total}`}
            </span>
          )}
        </div>
        <IconButton label="Previous match" onClick={actions.prev}>
          <HugeiconsIcon icon={ArrowUp01Icon} size={14} color="currentColor" strokeWidth={2} />
        </IconButton>
        <IconButton label="Next match" onClick={actions.next}>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} color="currentColor" strokeWidth={2} />
        </IconButton>
        <button
          type="button"
          onClick={() => setShowReplace((v) => !v)}
          aria-pressed={showReplace}
          aria-label="Toggle replace"
          className={`shrink-0 rounded-md px-2 text-[12px] tracking-tight transition-colors h-[var(--chrome-control-height)] ${
            showReplace
              ? "bg-[var(--surface-selected)] text-[var(--text-primary)]"
              : "text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-secondary)]"
          }`}
        >
          Replace
        </button>
        <IconButton label="Close" onClick={actions.doClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} color="currentColor" strokeWidth={2} />
        </IconButton>
      </div>

      {showReplace && (
        <div className="mt-1.5 flex items-center gap-1.5 pl-7">
          <input
            type="text"
            value={replaceText}
            onChange={(e) => onReplaceTextChange(e.target.value)}
            onKeyDown={onReplaceKeyDown}
            placeholder="Replace"
            aria-label="Replace"
            className="min-w-0 flex-1 rounded-lg bg-[var(--surface-input)] px-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:outline-none h-[var(--chrome-control-height)]"
          />
          <button
            type="button"
            onClick={actions.doReplace}
            className="shrink-0 rounded-md px-2.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] h-[var(--chrome-control-height)]"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={actions.doReplaceAll}
            className="shrink-0 rounded-md bg-[var(--accent)] px-2.5 text-[12px] font-medium text-white hover:opacity-90 h-[var(--chrome-control-height)]"
          >
            All
          </button>
        </div>
      )}
    </SurfaceCard>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function IconButton({ label, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-secondary)] h-[var(--chrome-control-height)] w-[var(--chrome-control-height)]"
    >
      {children}
    </button>
  );
}
