import { useRef, useCallback, useEffect } from "react";
import { EditorView } from "@codemirror/view";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { closeEditorSearch } from "./editor-search-store";
import { findOuterScroller, scrollPosToSafeTop } from "./editor-scroll";
import { createEditorExtensions } from "./editor-extensions";
import { findHeadingBySlug } from "./link-navigation";
import { advanceViewportParse } from "./viewport-parse";
import { clampSelectionToHeadings } from "./heading-decorations";
import * as editorApi from "@/hooks/editor-api";
import { useReloadVersion } from "@/hooks/use-tabs";
import { getFileName } from "@/lib/paths";
import { consumePendingAnchor } from "@/lib/pending-anchor";
import { logTimeline, mark } from "@/lib/startup-metrics";
import { showEditorNotice } from "./editor-notice-store";

function resolveScrollContainer(root: HTMLElement, getScrollContainer?: () => HTMLElement | null) {
  return getScrollContainer?.() ?? findOuterScroller(root);
}

function restoreCursorPosition(view: EditorView, cursorPos: number) {
  // Always dispatch a selection — even a no-op anchor: 0 — so the
  // `headingSelectionGuard` transactionFilter sees the initial selection and
  // clamps it out of any no-go zone (e.g., a doc that starts with a heading
  // would otherwise render the caret at lineFrom, which is the start of the
  // hash chars). `EditorState.create`'s default selection is at position 0
  // and isn't a transaction, so the filter never fires for it.
  let pos: number;
  if (cursorPos > 0) {
    pos = Math.min(cursorPos, view.state.doc.length);
  } else if (view.state.doc.toString() === "# ") {
    // New-file template from create_file_impl is "# "; land caret after it so the user can type the title immediately.
    pos = 2;
  } else {
    pos = 0;
  }
  view.dispatch({ selection: { anchor: pos } });
}

function restoreScrollPosition(
  scrollContainer: HTMLElement,
  scrollPos: number,
  isDisposed: () => boolean,
) {
  requestAnimationFrame(() => {
    if (isDisposed()) return;

    // Always apply the initial scroll so a new file can reset a reused container back to the top.
    scrollContainer.scrollTo(0, Math.max(0, scrollPos));
  });
}

export function useProsemarkEditor(
  filePath: string,
  getScrollContainer?: () => HTMLElement | null,
  autoFocus = false,
  onViewChange?: (view: EditorView | null) => void,
) {
  const viewRef = useRef<EditorView | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  const disposedRef = useRef(false);
  const filePathRef = useRef(filePath);
  // getScrollContainer is captured into a ref only to resolve a DOM scroll container, not invoked as a callback from an effect.
  // eslint-disable-next-line react-doctor/no-event-handler
  const getScrollContainerRef = useRef(getScrollContainer);
  const autoFocusRef = useRef(autoFocus);
  const onViewChangeRef = useRef(onViewChange);
  const prevPathRef = useRef<string | null>(null);
  const prevReloadVersionRef = useRef<number>(0);
  const historyCompartmentRef = useRef<Compartment | null>(null);
  if (!historyCompartmentRef.current) historyCompartmentRef.current = new Compartment();

  const reloadVersion = useReloadVersion(filePath);

  // Keep refs in sync for use by closures and the swap effect.
  filePathRef.current = filePath;
  getScrollContainerRef.current = getScrollContainer;
  autoFocusRef.current = autoFocus;
  onViewChangeRef.current = onViewChange;

  // Stable ref callback — only handles mount/unmount.
  const mountRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      disposedRef.current = true;
      scrollCleanupRef.current?.();
      scrollCleanupRef.current = null;
      const view = viewRef.current;
      if (view) {
        closeEditorSearch({ view });
        view.destroy();
      }
      viewRef.current = null;
      onViewChangeRef.current?.(null);
      return;
    }

    if (viewRef.current) return;

    disposedRef.current = false;

    const currentPath = filePathRef.current;
    const file = editorApi.getOpenFile(currentPath);
    const initialContent = file?.content ?? "";

    const view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: initialContent,
        extensions: createEditorExtensions(
          () => filePathRef.current,
          () => disposedRef.current,
          historyCompartmentRef.current!,
        ),
      }),
    });

    viewRef.current = view;
    prevPathRef.current = currentPath;
    prevReloadVersionRef.current = file?.reloadVersion ?? 0;
    onViewChangeRef.current?.(view);

    mark("editor-ready");
    logTimeline();

    advanceViewportParse(view, () => disposedRef.current);

    restoreCursorPosition(view, file?.cursorPos ?? 0);
    clampSelectionToHeadings(view);

    const scrollContainer = resolveScrollContainer(el, getScrollContainerRef.current);
    if (scrollContainer) {
      restoreScrollPosition(scrollContainer, file?.scrollPos ?? 0, () => disposedRef.current);

      const handleScroll = () => {
        editorApi.updateScrollPos(filePathRef.current, scrollContainer.scrollTop);
      };
      scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
      scrollCleanupRef.current = () => scrollContainer.removeEventListener("scroll", handleScroll);
    }

    if (autoFocusRef.current) view.focus();
  }, []);

  // Detect path or reload-version changes and swap the document in place.
  // Syncs the external CodeMirror EditorView to filePath/reloadVersion changes (tab switch / external reload); there is no DOM handler to host it.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || disposedRef.current) return;

    // eslint-disable-next-line react-doctor/no-event-handler
    const pathChanged = filePath !== prevPathRef.current;
    const reloaded = !pathChanged && reloadVersion !== prevReloadVersionRef.current;

    if (!pathChanged && !reloaded) return;

    prevPathRef.current = filePath;
    prevReloadVersionRef.current = reloadVersion;

    const file = editorApi.getOpenFile(filePath);
    const content = file?.content ?? "";

    const cursorPos = pathChanged
      ? Math.min(file?.cursorPos ?? 0, content.length)
      : Math.min(view.state.selection.main.head, content.length);

    if (pathChanged) {
      // Reset undo history per file. Removing the history compartment discards
      // its state field; re-adding initializes it fresh. Only history is in the
      // compartment, so the language state and every decoration field survive
      // and the swap doesn't flash raw markdown the way a full view.setState
      // would.
      const historyCompartment = historyCompartmentRef.current!;
      view.dispatch({ effects: historyCompartment.reconfigure([]) });
      view.dispatch({ effects: historyCompartment.reconfigure(history()) });
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: EditorSelection.cursor(cursorPos),
      annotations: Transaction.addToHistory.of(false),
      userEvent: pathChanged ? "writer.swap" : "writer.reload",
      scrollIntoView: false,
    });

    if (pathChanged) {
      const scrollContainer = resolveScrollContainer(
        view.dom.parentElement!,
        getScrollContainerRef.current,
      );
      if (scrollContainer) {
        const pendingAnchor = consumePendingAnchor(filePath);
        if (pendingAnchor !== undefined) {
          const heading = findHeadingBySlug(content, pendingAnchor);
          if (heading) {
            requestAnimationFrame(() => {
              if (disposedRef.current) return;
              scrollPosToSafeTop(view, scrollContainer, heading.pos, "auto");
            });
          } else {
            scrollContainer.scrollTo({ top: 0, behavior: "auto" });
            showEditorNotice(`Heading "#${pendingAnchor}" not found in ${getFileName(filePath)}`);
          }
        } else {
          restoreScrollPosition(scrollContainer, file?.scrollPos ?? 0, () => disposedRef.current);
        }
      }
    }

    advanceViewportParse(view, () => disposedRef.current);
    clampSelectionToHeadings(view);
  }, [filePath, reloadVersion]);

  return mountRef;
}
