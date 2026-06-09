import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { findOuterScroller } from "./editor-scroll-geometry";

/* Dev-only heightmap diagnostics (see SPECs/scrollbar-stability-spec.md).

   CodeMirror estimates unmeasured line heights and corrects them as lines
   enter the rendered viewport; each correction changes the document height
   and moves the scrollbar thumb. This plugin logs one line per measure
   cycle that changed heights, attributing the newly-rendered lines by type
   (heading / blank / fence / wrap-candidate) so a regression in scroll
   stability points at the term in the math that moved.

   Enable with `localStorage.setItem("writer:debug-heightmap", "1")` in a
   dev build, then reload. */

export function heightmapDebugEnabled(): boolean {
  return import.meta.env.DEV && localStorage.getItem("writer:debug-heightmap") === "1";
}

const HEADING_RE = /^#{1,6}\s/;
const FENCE_RE = /^(`{3,}|~{3,})/;

interface LineTypeCounts {
  heading: number;
  blank: number;
  fence: number;
  wrap: number;
  other: number;
}

// Classify doc lines in the parts of the new viewport that the previous
// viewport didn't cover. Offsets compare across updates, so attribution is
// approximate when the doc changed in between — fine for diagnostics.
function classifyNewLines(update: ViewUpdate, prevFrom: number, prevTo: number): LineTypeCounts {
  const { from, to } = update.view.viewport;
  const doc = update.state.doc;
  const counts: LineTypeCounts = { heading: 0, blank: 0, fence: 0, wrap: 0, other: 0 };
  const wrapCols = Math.max(
    20,
    Math.floor(update.view.scrollDOM.clientWidth / update.view.defaultCharacterWidth),
  );

  const segments: [number, number][] = [];
  if (from < prevFrom) segments.push([from, Math.min(to, prevFrom)]);
  if (to > prevTo) segments.push([Math.max(from, prevTo), to]);

  for (const [segFrom, segTo] of segments) {
    if (segFrom >= segTo) continue;
    let line = doc.lineAt(segFrom);
    for (;;) {
      const text = line.text;
      if (text.length === 0) counts.blank++;
      else if (HEADING_RE.test(text)) counts.heading++;
      else if (FENCE_RE.test(text)) counts.fence++;
      else if (text.length > wrapCols) counts.wrap++;
      else counts.other++;
      if (line.to >= segTo || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return counts;
}

const heightmapDebugPlugin = ViewPlugin.fromClass(
  class {
    prevContentHeight: number;
    prevViewport: { from: number; to: number };
    scroller: HTMLElement | null = null;

    constructor(view: EditorView) {
      this.prevContentHeight = view.contentHeight;
      this.prevViewport = { from: view.viewport.from, to: view.viewport.to };
    }

    update(update: ViewUpdate) {
      if (!update.heightChanged && !update.geometryChanged) return;

      const view = update.view;
      this.scroller ??= findOuterScroller(view);

      const height = view.contentHeight;
      const delta = height - this.prevContentHeight;
      const counts = classifyNewLines(update, this.prevViewport.from, this.prevViewport.to);
      const flags = `${update.heightChanged ? "H" : ""}${update.geometryChanged ? "G" : ""}`;

      console.debug(
        `[heightmap] t=${Math.round(performance.now())}ms ${flags}` +
          ` h=${this.prevContentHeight.toFixed(1)}→${height.toFixed(1)} (Δ${delta >= 0 ? "+" : ""}${delta.toFixed(1)})` +
          ` scrollH=${this.scroller?.scrollHeight ?? "?"} top=${this.scroller ? Math.round(this.scroller.scrollTop) : "?"}` +
          ` vp=${update.view.viewport.from}–${update.view.viewport.to}` +
          ` new{heading:${counts.heading},blank:${counts.blank},fence:${counts.fence},wrap:${counts.wrap},other:${counts.other}}`,
      );

      this.prevContentHeight = height;
      this.prevViewport = { from: view.viewport.from, to: view.viewport.to };
    }
  },
);

export const heightmapDebug: Extension = heightmapDebugPlugin;
