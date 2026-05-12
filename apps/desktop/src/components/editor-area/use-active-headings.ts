import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { DocumentHeading } from "@/hooks/use-document-headings";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";

// Match the scroll-to-heading landing y so clicking a tick / row immediately
// activates the destination heading instead of keeping the previous one
// active. A small fudge protects against measurement jitter at the boundary.
const ACTIVE_OFFSET_PX = EDITOR_SAFE_SCROLL_MARGIN + 4;

export interface ActiveHeadings {
  activeIndex: number | null;
}

const EMPTY: ActiveHeadings = { activeIndex: null };

function computeActive(
  view: EditorView,
  scroller: HTMLElement,
  headings: DocumentHeading[],
): ActiveHeadings {
  if (headings.length === 0) return EMPTY;
  const docLen = view.state.doc.length;
  const scrollerRect = scroller.getBoundingClientRect();
  const threshold = scrollerRect.top + ACTIVE_OFFSET_PX;

  let activeIndex: number | null = null;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const pos = Math.min(h.pos, docLen);
    const block = view.lineBlockAt(pos);
    const screenY = view.documentTop + block.top;
    if (screenY > threshold) break;
    activeIndex = i;
  }
  // Before any heading has scrolled past the threshold we're still on the
  // first heading conceptually — fall back so the rail's first tick lights
  // up at the top of the document.
  if (activeIndex === null) activeIndex = 0;
  return { activeIndex };
}

export function useActiveHeadings(
  view: EditorView | null,
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  headings: DocumentHeading[],
): ActiveHeadings {
  const [state, setState] = useState<ActiveHeadings>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) {
      if (stateRef.current !== EMPTY) setState(EMPTY);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = computeActive(view, scroller, headings);
      if (stateRef.current.activeIndex !== next.activeIndex) setState(next);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [view, scrollContainerRef, headings]);

  return state;
}
