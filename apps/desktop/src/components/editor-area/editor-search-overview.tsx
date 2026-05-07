import { useEffect, useMemo, useState } from "react";
import { collectMatches, jumpToMatch, useEditorSearchStore } from "./editor-search-store";

interface EditorSearchOverviewProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function EditorSearchOverview({ scrollContainerRef }: EditorSearchOverviewProps) {
  const isOpen = useEditorSearchStore((s) => s.isOpen);
  const view = useEditorSearchStore((s) => s.view);
  const docVersion = useEditorSearchStore((s) => s.docVersion);
  const query = useEditorSearchStore((s) => s.query);

  const matches = useMemo(() => {
    if (!isOpen || !view || !query) return null;
    return collectMatches(view, query);
    // docVersion bumps on doc/selection change; recompute marks then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, view, query, docVersion]);

  // Re-render when the scroll container resizes so marks stay aligned with
  // the visible track height.
  const [, setHeightTick] = useState(0);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!isOpen || !el) return;
    const ro = new ResizeObserver(() => setHeightTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen, scrollContainerRef]);

  if (!isOpen || !view || !matches || matches.ranges.length === 0) return null;

  const trackHeight = scrollContainerRef.current?.clientHeight ?? 0;
  if (trackHeight === 0) return null;

  // Coalesce marks at most once per pixel of track height to keep huge match
  // counts cheap to render.
  const seenPx = new Set<number>();
  const marks: Array<{ key: number; topPx: number; isActive: boolean }> = [];
  for (let i = 0; i < matches.ranges.length; i++) {
    const range = matches.ranges[i];
    const topPx = Math.round((range.from / matches.docLength) * trackHeight);
    const isActive = i === matches.activeIndex;
    if (!isActive && seenPx.has(topPx)) continue;
    seenPx.add(topPx);
    marks.push({ key: i, topPx, isActive });
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute right-1 top-0 bottom-0 z-20 w-[6px]"
    >
      {marks.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => jumpToMatch(view, matches.ranges[m.key])}
          aria-label={`Jump to match ${m.key + 1} of ${matches.ranges.length}`}
          className="pointer-events-auto absolute left-0 right-0 cursor-pointer"
          style={{
            top: `${m.topPx}px`,
            height: m.isActive ? "4px" : "2px",
            transform: "translateY(-50%)",
            background: m.isActive
              ? "var(--accent)"
              : "color-mix(in srgb, var(--accent) 45%, transparent)",
            borderRadius: "1px",
          }}
        />
      ))}
    </div>
  );
}
