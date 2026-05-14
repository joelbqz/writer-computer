import { useRef, useState, type CSSProperties, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDocumentHeadings, type DocumentHeading } from "@/hooks/use-document-headings";
import { ScrollFade } from "@/components/scroll-fade";
import { SurfaceCard } from "@/components/surface-card";
import { useActiveHeadings } from "./use-active-headings";
import { useEscKey } from "./use-esc-key";
import { useMountTransition } from "./use-mount-transition";
import { showNativeContextMenu } from "./editor-context-menu";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";
import "./section-rail.css";

const INACTIVE_WIDTH = 7;
const ACTIVE_WIDTH = 14;
const TICK_HEIGHT = 1;
const TICK_GAP = 6;
const RAIL_LEFT = 12;
const RAIL_INNER_WIDTH = ACTIVE_WIDTH + 2;
const RAIL_ZONE_WIDTH = RAIL_LEFT + RAIL_INNER_WIDTH;
const POPOVER_WIDTH = 260;
const POPOVER_LEFT = RAIL_LEFT;
const POPOVER_TRANSITION_MS = 180;

interface SectionRailProps {
  filePath: string;
  view: EditorView | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

function scrollToHeading(view: EditorView, scroller: HTMLElement, heading: DocumentHeading) {
  const pos = Math.min(heading.pos, view.state.doc.length);
  const block = view.lineBlockAt(pos);
  const screenY = view.documentTop + block.top;
  const scrollerRect = scroller.getBoundingClientRect();
  const delta = screenY - scrollerRect.top - EDITOR_SAFE_SCROLL_MARGIN;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const next = Math.max(0, Math.min(scroller.scrollTop + delta, max));
  scroller.scrollTo({ top: next, behavior: "auto" });
}

function buildHeadingLink(heading: DocumentHeading) {
  return `[${heading.text}](#${heading.slug})`;
}

export function SectionRail({ filePath, view, scrollContainerRef }: SectionRailProps) {
  const headings = useDocumentHeadings(filePath);
  const { activeIndex } = useActiveHeadings(view, scrollContainerRef, headings);
  const [isOpen, setIsOpen] = useState(false);
  const { shouldRender, phase } = useMountTransition(isOpen, POPOVER_TRANSITION_MS);
  useEscKey(isOpen, () => setIsOpen(false));

  const railZoneRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Move-between rail and popover keeps the popover open; leaving to
  // anywhere else closes. Crucial because the popover overlaps the rail
  // x-range — we still need an explicit relatedTarget check to bridge.
  const handleRailLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && popoverRef.current?.contains(next)) return;
    setIsOpen(false);
  };

  const handlePopoverLeave = (event: React.MouseEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && railZoneRef.current?.contains(next)) return;
    setIsOpen(false);
  };

  const handleTickClick = (heading: DocumentHeading) => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;
    scrollToHeading(view, scroller, heading);
  };

  const handleContextMenu = (event: React.MouseEvent, heading: DocumentHeading) => {
    event.preventDefault();
    event.stopPropagation();
    void showNativeContextMenu(
      [
        {
          kind: "item",
          id: "copy-heading-link",
          text: "Copy heading link",
          action: () => {
            void writeText(buildHeadingLink(heading));
          },
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  };

  if (headings.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 z-20"
      style={{ width: POPOVER_LEFT + POPOVER_WIDTH }}
    >
      <div
        ref={railZoneRef}
        className="pointer-events-auto absolute inset-y-0 left-0"
        style={{ width: RAIL_ZONE_WIDTH }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={handleRailLeave}
      >
        <div
          className="section-rail-ticks absolute top-1/2 flex flex-col"
          data-open={isOpen ? "true" : "false"}
          style={{
            left: RAIL_LEFT,
            width: RAIL_INNER_WIDTH,
            gap: TICK_GAP,
            color: "var(--text-primary, currentColor)",
          }}
          aria-label="Document sections"
          role="navigation"
        >
          {headings.map((heading, i) => {
            const isActive = i === activeIndex;
            const tickStyle: CSSProperties = {
              width: isActive ? ACTIVE_WIDTH : INACTIVE_WIDTH,
              height: TICK_HEIGHT,
              background: "currentColor",
              opacity: isActive ? 1 : 0.35,
              transition: isActive ? "none" : "width 300ms ease-in, opacity 300ms ease-in",
            };
            return (
              <button
                key={`${heading.line}-${i}`}
                type="button"
                className="block cursor-default border-0 bg-transparent p-0"
                style={tickStyle}
                title={heading.text}
                onClick={() => handleTickClick(heading)}
                onContextMenu={(event) => handleContextMenu(event, heading)}
              />
            );
          })}
        </div>
      </div>

      {shouldRender && (
        <SurfaceCard
          ref={popoverRef}
          className="section-rail-popover pointer-events-auto absolute overflow-hidden"
          data-state={phase}
          style={{
            top: "50%",
            left: POPOVER_LEFT,
            width: POPOVER_WIDTH,
          }}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={handlePopoverLeave}
        >
          <ScrollFade
            axis="vertical"
            fadeSize="20px"
            className="scrollbar-none max-h-[70vh] overflow-y-auto px-4 py-3"
          >
            <ul className="flex flex-col" style={{ gap: 4 }}>
              {headings.map((heading, i) => {
                const isActive = i === activeIndex;
                return (
                  <li key={`${heading.line}-${i}`}>
                    <button
                      type="button"
                      className={`section-rail-popover-row block w-full cursor-default truncate border-0 bg-transparent p-0 text-left${
                        isActive ? " is-active" : ""
                      }`}
                      style={{
                        fontSize: 13,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.5,
                      }}
                      onClick={() => handleTickClick(heading)}
                      onContextMenu={(event) => handleContextMenu(event, heading)}
                    >
                      {heading.text}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollFade>
        </SurfaceCard>
      )}
    </div>
  );
}
