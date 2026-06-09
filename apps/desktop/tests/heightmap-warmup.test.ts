import { describe, expect, test } from "vite-plus/test";
import type { EditorView } from "@codemirror/view";
import { startHeightmapWarmup } from "../src/components/editor-area/heightmap-warmup";

/* The warm-up loop runs against a structural fake of the editor + scroller
   geometry: positions map linearly to pixels and the "viewport" follows
   scrollTop with a margin, emulating CodeMirror's rendered range. This
   exercises the sweep/termination/restore logic without a DOM. */

interface FakeScroller {
  scrollTop: number;
  clientTop: number;
  clientHeight: number;
  scrollHeight: number;
  scrollToCalls: number[];
  getBoundingClientRect: () => { top: number };
  scrollTo: (x: number, y: number) => void;
}

function makeFake({
  docLength = 5000,
  pxPerPos = 0.1,
  margin = 50,
  clientHeight = 100,
  measureDelayMs = 0,
  viewportTo,
}: {
  docLength?: number;
  pxPerPos?: number;
  margin?: number;
  clientHeight?: number;
  measureDelayMs?: number;
  viewportTo?: (defaultTo: number, scrollTop: number) => number;
} = {}) {
  const scroller: FakeScroller = {
    scrollTop: 0,
    clientTop: 0,
    clientHeight,
    scrollHeight: Math.max(clientHeight, docLength * pxPerPos),
    scrollToCalls: [],
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo(_x: number, y: number) {
      scroller.scrollTop = y;
      scroller.scrollToCalls.push(y);
    },
  };

  const view = {
    state: { doc: { length: docLength } },
    get documentTop() {
      return scroller.getBoundingClientRect().top + scroller.clientTop - scroller.scrollTop;
    },
    get viewport() {
      const from = Math.max(0, Math.floor((scroller.scrollTop - margin) / pxPerPos));
      const defaultTo = Math.min(
        docLength,
        Math.floor((scroller.scrollTop + clientHeight + margin) / pxPerPos),
      );
      return {
        from: Math.min(docLength, from),
        to: viewportTo ? viewportTo(defaultTo, scroller.scrollTop) : defaultTo,
      };
    },
    lineBlockAt(pos: number) {
      return { from: pos, top: pos * pxPerPos, height: pxPerPos };
    },
    lineBlockAtHeight(height: number) {
      const pos = Math.max(0, Math.min(docLength, Math.round(height / pxPerPos)));
      return { from: pos, top: pos * pxPerPos };
    },
    requestMeasure() {},
    elementAtHeight() {
      if (measureDelayMs > 0) {
        const start = performance.now();
        while (performance.now() - start < measureDelayMs) {
          // busy-wait so the chunk budget expires and the loop yields
        }
      }
      return {};
    },
  };

  const frames: (() => void)[] = [];
  const scheduleFrame = (cb: () => void) => {
    frames.push(cb);
  };
  const flushOneFrame = () => {
    const cb = frames.shift();
    cb?.();
    return cb !== undefined;
  };
  const flushAllFrames = () => {
    let guard = 1000;
    while (flushOneFrame()) {
      if (--guard === 0) throw new Error("warm-up did not terminate");
    }
  };

  return {
    view: view as unknown as EditorView,
    scroller: scroller as unknown as HTMLElement,
    rawScroller: scroller,
    scheduleFrame,
    flushOneFrame,
    flushAllFrames,
  };
}

const noopParse = () => true;

describe("startHeightmapWarmup", () => {
  test("sweeps the whole doc and ends at the px target", () => {
    const fake = makeFake();
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      target: { kind: "px", top: 200 },
      isDisposed: () => false,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    expect(handle.active).toBe(true);
    fake.flushAllFrames();

    expect(handle.active).toBe(false);
    expect(fake.rawScroller.scrollTop).toBe(200);
    // sweep positions stay between the initial restore and the final one
    expect(fake.rawScroller.scrollToCalls[0]).toBe(200);
    expect(fake.rawScroller.scrollToCalls.at(-1)).toBe(200);
  });

  test("resolves an anchor target against the heightmap", () => {
    const fake = makeFake();
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      // pos 3000 at pxPerPos 0.1 → block top at doc pixel 300; content top
      // sits offsetPx past it → scrollTop 320
      target: { kind: "anchor", pos: 3000, offsetPx: 20 },
      isDisposed: () => false,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    fake.flushAllFrames();
    expect(handle.active).toBe(false);
    expect(fake.rawScroller.scrollTop).toBeCloseTo(320);
  });

  test("skips when the viewport already covers the whole doc", () => {
    const fake = makeFake({ margin: 100_000 });
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      target: { kind: "px", top: 0 },
      isDisposed: () => false,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    fake.flushAllFrames();
    expect(handle.active).toBe(false);
    // initial restore + anchor re-resolve only; no sweep positions
    expect(fake.rawScroller.scrollToCalls).toEqual([0, 0]);
  });

  test("cancel before the first frame prevents any scrolling", () => {
    const fake = makeFake();
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      target: { kind: "px", top: 100 },
      isDisposed: () => false,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    handle.cancel();
    handle.cancel(); // idempotent
    expect(handle.active).toBe(false);
    fake.flushAllFrames();
    expect(fake.rawScroller.scrollToCalls).toEqual([]);
  });

  test("aborts without restoring when the user scrolls between chunks", () => {
    // slow measures force the chunk budget to expire after one step,
    // splitting the sweep across frames
    const fake = makeFake({ docLength: 50_000, measureDelayMs: 16 });
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      target: { kind: "px", top: 0 },
      isDisposed: () => false,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    fake.flushOneFrame(); // firstChunk
    fake.flushOneFrame(); // first sweep chunk, ends restored to 0
    expect(handle.active).toBe(true);

    fake.rawScroller.scrollTop = 999; // user grabs the scrollbar
    const callsBefore = fake.rawScroller.scrollToCalls.length;
    fake.flushAllFrames();

    expect(handle.active).toBe(false);
    expect(fake.rawScroller.scrollTop).toBe(999); // their position wins
    expect(fake.rawScroller.scrollToCalls.length).toBe(callsBefore);
  });

  test("stops explicitly when the viewport never advances", () => {
    const fake = makeFake({ viewportTo: () => 10 });
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      target: { kind: "px", top: 0 },
      isDisposed: () => false,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    fake.flushAllFrames();
    expect(handle.active).toBe(false);
    expect(fake.rawScroller.scrollTop).toBe(0); // still restored to target
  });

  test("stops at the step cap when progress is one position per step", () => {
    const fake = makeFake({
      docLength: 5000,
      // viewport.to == the position we just asked for → +1 per step
      viewportTo: (_defaultTo, scrollTop) => Math.round(scrollTop / 0.1),
    });
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      target: { kind: "px", top: 0 },
      isDisposed: () => false,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    fake.flushAllFrames();
    expect(handle.active).toBe(false);
    expect(fake.rawScroller.scrollTop).toBe(0);
  });

  test("disposed editor finishes without scrolling", () => {
    const fake = makeFake();
    let disposed = false;
    const handle = startHeightmapWarmup({
      view: fake.view,
      scroller: fake.scroller,
      target: { kind: "px", top: 0 },
      isDisposed: () => disposed,
      forceParse: noopParse,
      scheduleFrame: fake.scheduleFrame,
    });

    disposed = true;
    fake.flushAllFrames();
    expect(handle.active).toBe(false);
    expect(fake.rawScroller.scrollToCalls).toEqual([]);
  });
});
