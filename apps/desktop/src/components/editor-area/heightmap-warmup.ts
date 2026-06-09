import { forceParsing } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import {
  deriveScrollAnchor,
  resolveScrollAnchorTop,
  scrollTopForDocPixel,
  type ScrollAnchor,
} from "./editor-scroll-geometry";

/* Heightmap warm-up (see SPECs/scrollbar-stability-spec.md and
   docs/editor.md "Heightmap warm-up after document swaps").

   A document swap/reload resets CodeMirror's heightmap to per-line
   estimates; scrolling then converts estimates to measurements chunk by
   chunk, changing the document height and dancing the scrollbar thumb.
   This sweeps the viewport through the whole document right after the
   swap, forcing a synchronous render+measure per step, so the heightmap
   converges before the user scrolls.

   Why no visual freeze is needed: each rAF chunk is one task, every exit
   path restores the target scroll position (try/finally), and browsers
   paint only between tasks — intermediate sweep positions are never
   painted, and the coalesced scroll event observes only the target. The
   only visible effect is the thumb converging during the burst.

   Progress is tracked in document positions (`view.viewport.to`), not
   pixels: estimate→measured corrections and CodeMirror's own anchor
   compensation shift pixel space mid-sweep. */

export type WarmupTarget = { kind: "px"; top: number } | ({ kind: "anchor" } & ScrollAnchor);

export interface WarmupHandle {
  cancel(): void;
  readonly active: boolean;
}

interface WarmupOptions {
  view: EditorView;
  scroller: HTMLElement;
  target: WarmupTarget;
  isDisposed: () => boolean;
  /** Test seam — defaults to @codemirror/language's forceParsing. */
  forceParse?: (view: EditorView, upto: number, timeoutMs: number) => unknown;
  /** Test seam — defaults to requestAnimationFrame. */
  scheduleFrame?: (cb: () => void) => void;
}

const TOTAL_BUDGET_MS = 250;
const CHUNK_BUDGET_MS = 14;
const MAX_STEPS = 200;
// Parse runs ahead of measurement so syntax-dependent styling (heading
// sizes, fence backgrounds) exists when a region is measured. The viewport
// overlap between steps re-measures any region whose parse lagged.
const PARSE_AHEAD_CHARS = 10_000;
const PARSE_STEP_BUDGET_MS = 5;
// Beyond this the scroller moved between chunks — user input. Sub-pixel
// scroll restoration rounding stays under it.
const EXTERNAL_SCROLL_TOLERANCE_PX = 2;

export function startHeightmapWarmup(opts: WarmupOptions): WarmupHandle {
  const { view, scroller, target, isDisposed } = opts;
  const forceParse = opts.forceParse ?? forceParsing;
  const scheduleFrame = opts.scheduleFrame ?? ((cb: () => void) => requestAnimationFrame(cb));

  const state = {
    cancelled: false,
    active: true,
    nextPos: 0,
    steps: 0,
    retried: false,
    startedAt: 0,
    anchor: null as ScrollAnchor | null,
    lastSetTop: -1,
  };

  function finish(reason?: string) {
    state.active = false;
    if (reason) {
      console.debug(
        `[editor] heightmap warm-up ${reason} at pos ${state.nextPos}/${view.state.doc.length}`,
      );
    }
  }

  function forceMeasure() {
    view.requestMeasure();
    // elementAtHeight flushes the measure queue synchronously: when it
    // returns, the viewport for the scroll position set above has been
    // rendered and its line heights measured into the heightmap.
    view.elementAtHeight(0);
  }

  function restoreTarget() {
    if (!state.anchor) return;
    state.lastSetTop = resolveScrollAnchorTop(view, scroller, state.anchor);
    scroller.scrollTo(0, state.lastSetTop);
  }

  function firstChunk() {
    if (state.cancelled || isDisposed()) return finish();
    if (scroller.clientHeight === 0) return finish("skipped (zero-height scroller)");

    // Initial restore — subsumes the old restoreScrollPosition: always
    // applied, so a new file resets a reused container back to the top.
    const initialTop =
      target.kind === "px"
        ? Math.max(0, target.top)
        : resolveScrollAnchorTop(view, scroller, target);
    scroller.scrollTo(0, initialTop);
    forceMeasure();

    // From here on the on-screen content is pinned: every chunk exits by
    // re-resolving this anchor against the converging heightmap. A px
    // target anchors to whatever content the restore put on screen.
    state.anchor =
      target.kind === "anchor"
        ? { pos: target.pos, offsetPx: target.offsetPx }
        : deriveScrollAnchor(view, scroller);
    restoreTarget();

    const { from, to } = view.viewport;
    if (from === 0 && to >= view.state.doc.length) return finish();

    state.startedAt = performance.now();
    // Sweep from the top: when the restore landed mid-document, the region
    // above it is estimated too and scrolling up would still dance.
    state.nextPos = 0;
    chunk();
  }

  function chunk() {
    if (state.cancelled || isDisposed()) return finish();
    if (Math.abs(scroller.scrollTop - state.lastSetTop) > EXTERNAL_SCROLL_TOLERANCE_PX) {
      // The user moved the scroller between chunks (wheel, thumb drag,
      // keys) — leave their position alone and stop converging.
      return finish("aborted (external scroll)");
    }

    const docLength = view.state.doc.length;
    let stopped: string | undefined;
    try {
      const chunkStart = performance.now();
      while (state.nextPos < docLength) {
        if (++state.steps > MAX_STEPS) {
          stopped = "stopped (step cap)";
          break;
        }
        if (performance.now() - state.startedAt > TOTAL_BUDGET_MS) {
          stopped = "stopped (time budget)";
          break;
        }
        if (performance.now() - chunkStart > CHUNK_BUDGET_MS) break; // yield to the next frame

        forceParse(
          view,
          Math.min(docLength, state.nextPos + PARSE_AHEAD_CHARS),
          PARSE_STEP_BUDGET_MS,
        );
        const block = view.lineBlockAt(Math.min(state.nextPos, docLength));
        scroller.scrollTop = scrollTopForDocPixel(view, scroller, block.top);
        forceMeasure();

        const covered = view.viewport.to;
        if (covered < state.nextPos) {
          // No forward progress (pathological geometry). One retry, then
          // stop explicitly — the covered region stays stable either way.
          if (state.retried) {
            stopped = "stopped (no viewport progress)";
            break;
          }
          state.retried = true;
          continue;
        }
        state.retried = false;
        state.nextPos = covered + 1;
      }
    } finally {
      // Every exit restores the target, so the upcoming paint and the
      // coalesced scroll event only ever see the target position.
      restoreTarget();
    }

    if (stopped) return finish(stopped);
    if (state.nextPos >= docLength) return finish();
    scheduleFrame(chunk);
  }

  scheduleFrame(firstChunk);

  return {
    cancel() {
      // Idempotent; no DOM writes — the last chunk already restored the
      // target, and a cancel racing a swap must not fight the new content.
      state.cancelled = true;
      state.active = false;
    },
    get active() {
      return state.active;
    },
  };
}
