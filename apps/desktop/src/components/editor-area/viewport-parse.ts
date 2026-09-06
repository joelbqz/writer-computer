import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { forceParsing, syntaxTreeAvailable } from "@codemirror/language";

const VIEWPORT_OVERSHOOT = 2000;
const VIEWPORT_PARSE_BUDGET_MS = 50;
const IDLE_PARSE_BUDGET_MS = 50;
const IDLE_PARSE_TIMEOUT_MS = 2000;

/** Parse through the current viewport (plus overshoot) synchronously, then
 *  finish the document in an idle slice. Called on mount and tab swap so
 *  tree-derived decorations don't render the first screen stale. */
export function advanceViewportParse(view: EditorView, isDisposed: () => boolean) {
  const viewport = view.viewport;
  const target = Math.min(view.state.doc.length, viewport.to + VIEWPORT_OVERSHOOT);
  forceParsing(view, target, VIEWPORT_PARSE_BUDGET_MS);

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(
      () => {
        if (isDisposed()) return;
        forceParsing(view, view.state.doc.length, IDLE_PARSE_BUDGET_MS);
      },
      { timeout: IDLE_PARSE_TIMEOUT_MS },
    );
  }
}

// Keep the committed syntax tree caught up with the viewport during
// scrolling. The language plugin's background worker parses in
// requestIdleCallback slices, which starve while the user scrolls and are
// budget-capped on long documents — until it catches up, every tree-derived
// decoration field (list geometry, hidden markers, folds) renders the
// scrolled-into region as bare paragraphs (see the list hanging-indent bug).
// `forceParsing` dispatches when the tree advanced, which commits a fresh
// LanguageState and fires those fields' rebuild guards. `syntaxTreeAvailable`
// makes the caught-up steady state a no-op, and the parse-commit dispatch
// itself doesn't change the viewport, so this can't loop.
export const viewportParsePlugin = ViewPlugin.fromClass(
  class {
    private timeout = -1;

    update(update: ViewUpdate) {
      if (!update.viewportChanged || this.timeout >= 0) return;
      const view = update.view;
      const target = Math.min(view.state.doc.length, view.viewport.to + VIEWPORT_OVERSHOOT);
      if (syntaxTreeAvailable(view.state, target)) return;
      // Defer: dispatching (which forceParsing does) is illegal inside an
      // update cycle.
      this.timeout = window.setTimeout(() => {
        this.timeout = -1;
        const upto = Math.min(view.state.doc.length, view.viewport.to + VIEWPORT_OVERSHOOT);
        if (!syntaxTreeAvailable(view.state, upto)) {
          forceParsing(view, upto, VIEWPORT_PARSE_BUDGET_MS);
        }
      }, 0);
    }

    destroy() {
      if (this.timeout >= 0) window.clearTimeout(this.timeout);
    }
  },
);
