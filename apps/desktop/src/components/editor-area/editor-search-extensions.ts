import { EditorView, keymap } from "@codemirror/view";
import { type Extension, Prec, StateField } from "@codemirror/state";
import { search } from "@codemirror/search";
import {
  closeEditorSearch,
  findNextMatch,
  findPreviousMatch,
  openEditorSearch,
  useEditorSearchStore,
} from "./editor-search-store";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";
import { findOuterScroller } from "./editor-scroll";

// Invisible CodeMirror search panel: returning a hidden DOM here flips
// `searchState.panel` to truthy, which is what gates the built-in match
// highlighter. The actual UI is our React `EditorSearchOverlay`.
function invisibleSearchPanel() {
  const dom = document.createElement("div");
  dom.style.display = "none";
  return { dom };
}

// True when the latest transaction was a search/replace navigation
// (`select.search` from findNext/findPrevious/jumpToMatch, or
// `input.replace` from replaceNext/replaceAll). The custom scrollHandler
// reads this to scope the safe-zone scroll to search nav only — without
// it, ordinary typing would also be repositioned and cause a jump on
// every keystroke that triggered CodeMirror's cursor tracking.
const searchScrollIntent = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    if (!tr.selection && !tr.docChanged) return value;
    return tr.isUserEvent("select.search") || tr.isUserEvent("input.replace");
  },
});

// Override scrollIntoView only for search/replace navigation so matches
// land in the clear zone of the *outer* scroll container (the
// EditorScrollContainer is wrapped by a fade mask + 120px progressive
// blur, and CodeMirror's default scroll walks ancestors generically and
// doesn't always land the match where we want it). Only nudges the
// scroll when the match is outside the safe zone — if it's already
// visible we don't move so stepping between nearby matches doesn't
// jump. For typing and ordinary cursor moves we return false and let
// CodeMirror's default scroll behavior run.
const searchScrollHandler = EditorView.scrollHandler.of((view, range) => {
  if (!view.state.field(searchScrollIntent, false)) return false;
  const scroller = findOuterScroller(view.dom);
  if (!scroller) return false;
  // Use lineBlockAt + documentTop (CodeMirror's layout model) rather
  // than coordsAtPos (rendered DOM): coordsAtPos returns null when the
  // match is outside the currently-rendered viewport, which silently
  // fell back to the default scroll and ignored our fade margin.
  const block = view.lineBlockAt(range.head);
  const matchTop = view.documentTop + block.top;
  const matchBottom = view.documentTop + block.bottom;
  const scrollerRect = scroller.getBoundingClientRect();
  const contentTop = scrollerRect.top + scroller.clientTop;
  const safeTop = contentTop + EDITOR_SAFE_SCROLL_MARGIN;
  const safeBottom = contentTop + scroller.clientHeight - EDITOR_SAFE_SCROLL_MARGIN;
  // Top edge wins if the line is taller than the safe zone, so the
  // match (anchored at the line's top) stays visible instead of being
  // pushed above the fade by a bottom-align scroll.
  let delta = 0;
  if (matchTop < safeTop) {
    delta = matchTop - safeTop;
  } else if (matchBottom > safeBottom && block.height <= safeBottom - safeTop) {
    delta = matchBottom - safeBottom;
  } else {
    return true;
  }
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const next = Math.max(0, Math.min(scroller.scrollTop + delta, max));
  if (Math.abs(scroller.scrollTop - next) < 1) return true;
  scroller.scrollTo({ top: next, behavior: "auto" });
  return true;
});

const openOrFind = (find: (view: EditorView) => boolean) => (view: EditorView) => {
  if (!useEditorSearchStore.getState().isOpen) {
    openEditorSearch(view);
    return true;
  }
  return find(view);
};

/** Find/replace wiring: CodeMirror's search state (with a hidden panel so its
 *  match highlighter runs), the safe-zone scroll for search navigation, and
 *  the Mod-f / Mod-g / Escape bindings that drive the React overlay.
 *
 *  Place after `prosemarkBasicSetup()` in the extension list: the Escape
 *  binding is at default precedence so an open completion popup gets Escape
 *  first. */
export const editorSearchExtensions: Extension = [
  search({ literal: true, createPanel: invisibleSearchPanel }),
  searchScrollIntent,
  searchScrollHandler,
  Prec.highest(
    keymap.of([
      {
        key: "Mod-f",
        run: (view) => {
          openEditorSearch(view);
          return true;
        },
      },
      {
        key: "Mod-g",
        preventDefault: true,
        run: openOrFind(findNextMatch),
        shift: openOrFind(findPreviousMatch),
      },
    ]),
  ),
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (!useEditorSearchStore.getState().isOpen) return false;
        closeEditorSearch({ view, restoreFocus: true });
        return true;
      },
    },
  ]),
];
