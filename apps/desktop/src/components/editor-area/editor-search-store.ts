import { create } from "zustand";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  openSearchPanel,
  SearchCursor,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface EditorSearchState {
  isOpen: boolean;
  view: EditorView | null;
  openVersion: number;
  // Bumped on every doc/selection change so the overlay can recompute the
  // match count without subscribing to CodeMirror state directly.
  docVersion: number;
  // Mirror of the find input value so non-overlay consumers (e.g. the
  // scrollbar overview) can compute matches without prop-drilling.
  query: string;
  bumpDocVersion: (view: EditorView) => void;
  setQuery: (query: string) => void;
}

export const useEditorSearchStore = create<EditorSearchState>((set) => ({
  isOpen: false,
  view: null,
  openVersion: 0,
  docVersion: 0,
  query: "",
  bumpDocVersion: (view) =>
    set((s) => {
      if (!s.isOpen || s.view !== view) return s;
      return { docVersion: s.docVersion + 1 };
    }),
  setQuery: (query) => set({ query }),
}));

export function openEditorSearch(view: EditorView) {
  const currentView = useEditorSearchStore.getState().view;
  if (currentView && currentView !== view) closeSearchPanel(currentView);

  openSearchPanel(view);
  useEditorSearchStore.setState((s) => ({ isOpen: true, view, openVersion: s.openVersion + 1 }));
}

export function closeEditorSearch({
  view,
  restoreFocus = false,
}: { view?: EditorView; restoreFocus?: boolean } = {}) {
  const currentView = useEditorSearchStore.getState().view;
  if (view && currentView !== view) return;

  if (currentView) closeSearchPanel(currentView);
  useEditorSearchStore.setState({ isOpen: false, view: null, query: "" });
  if (restoreFocus) currentView?.focus();
}

export function applyEditorSearchQuery(view: EditorView, query: string, replaceText: string) {
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: query,
        caseSensitive: false,
        regexp: false,
        replace: replaceText,
      }),
    ),
  });
  useEditorSearchStore.getState().setQuery(query);
}

export function findNextMatch(view: EditorView) {
  return findNext(view);
}

export function findPreviousMatch(view: EditorView) {
  return findPrevious(view);
}

export interface MatchOffsets {
  ranges: Array<{ from: number; to: number }>;
  activeIndex: number;
  docLength: number;
}

const MAX_OVERVIEW_MATCHES = 5000;

export function collectMatches(view: EditorView, query: string): MatchOffsets | null {
  if (!query) return null;
  const doc = view.state.doc;
  const ranges: Array<{ from: number; to: number }> = [];
  const head = view.state.selection.main.head;
  let activeIndex = -1;
  try {
    const cursor = new SearchCursor(doc, query, 0, doc.length, (s) => s.toLowerCase());
    let it = cursor.next();
    while (!it.done) {
      const m = it.value;
      const idx = ranges.length;
      ranges.push({ from: m.from, to: m.to });
      if (activeIndex === -1 && m.from <= head && m.to >= head) activeIndex = idx;
      else if (activeIndex === -1 && m.from > head) activeIndex = idx;
      if (ranges.length >= MAX_OVERVIEW_MATCHES) break;
      it = cursor.next();
    }
  } catch {
    return null;
  }
  if (ranges.length > 0 && activeIndex === -1) activeIndex = 0;
  return { ranges, activeIndex, docLength: Math.max(1, doc.length) };
}

export function jumpToMatch(view: EditorView, range: { from: number; to: number }) {
  view.dispatch({
    selection: EditorSelection.single(range.from, range.to),
    effects: EditorView.scrollIntoView(EditorSelection.range(range.from, range.to), {
      y: "nearest",
    }),
    userEvent: "select.search",
  });
}
