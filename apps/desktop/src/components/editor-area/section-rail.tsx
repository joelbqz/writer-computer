import { useCallback, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDocumentHeadings, type DocumentHeading } from "@/hooks/use-document-headings";
import { useActiveHeadings } from "./use-active-headings";
import { useEscKey } from "./use-esc-key";
import { showNativeContextMenu } from "./editor-context-menu";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";
import { ScrollFade } from "@/components/scroll-fade";

const INACTIVE_WIDTH = 5;
const ACTIVE_WIDTH = 10;
const TICK_HEIGHT = 2;
const TICK_GAP = 6;
const RAIL_LEFT = 12;
const RAIL_INNER_WIDTH = ACTIVE_WIDTH + 2;
const RAIL_ZONE_WIDTH = RAIL_LEFT + RAIL_INNER_WIDTH + 12;
const POPOVER_WIDTH = 260;

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
  const close = useCallback(() => setIsOpen(false), []);
  useEscKey(isOpen, close);

  const railZoneRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Move-between rail and popover keeps the popover open; leaving to
  // anywhere else closes. Crucial because the rail zone abuts the popover
  // with no gap, so we can't rely on a single wrapper to bridge them.
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
      style={{ width: RAIL_ZONE_WIDTH + POPOVER_WIDTH }}
    >
      <div
        ref={railZoneRef}
        className="pointer-events-auto absolute inset-y-0 left-0"
        style={{ width: RAIL_ZONE_WIDTH }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={handleRailLeave}
      >
        <div
          className="absolute top-1/2 flex -translate-y-1/2 flex-col"
          style={{
            left: RAIL_LEFT,
            width: RAIL_INNER_WIDTH,
            gap: TICK_GAP,
            color: "var(--text-primary, currentColor)",
            opacity: isOpen ? 0 : 1,
            pointerEvents: isOpen ? "none" : "auto",
            transition: "opacity 150ms ease",
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
              opacity: isActive ? 1 : 0.2,
              transition: "width 180ms ease, opacity 180ms ease",
            };
            return (
              <button
                key={`${heading.line}-${i}`}
                type="button"
                className="block cursor-pointer border-0 bg-transparent p-0"
                style={tickStyle}
                title={heading.text}
                onClick={() => handleTickClick(heading)}
                onContextMenu={(event) => handleContextMenu(event, heading)}
              />
            );
          })}
        </div>
      </div>

      {isOpen && (
        <div
          ref={popoverRef}
          className="pointer-events-auto absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-2xl"
          style={{
            left: RAIL_ZONE_WIDTH,
            width: POPOVER_WIDTH,
            background: "var(--surface-card)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid var(--line-subtler)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.18)",
            isolation: "isolate",
          }}
          onMouseLeave={handlePopoverLeave}
        >
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              background: "color-mix(in srgb, var(--bg-base) 55%, transparent)",
              zIndex: -1,
            }}
          />
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
                      className="block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left"
                      style={{
                        color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                        fontSize: 13,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.5,
                        transition: "color 150ms ease",
                      }}
                      onClick={() => {
                        handleTickClick(heading);
                        setIsOpen(false);
                      }}
                      onContextMenu={(event) => handleContextMenu(event, heading)}
                    >
                      {heading.text}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollFade>
        </div>
      )}
    </div>
  );
}
