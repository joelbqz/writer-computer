import { useCallback, useState, type CSSProperties, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useDocumentHeadings, type DocumentHeading } from "@/hooks/use-document-headings";
import { useActiveHeadings } from "./use-active-headings";
import { useEscKey } from "./use-esc-key";
import { showNativeContextMenu } from "./editor-context-menu";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";

const INACTIVE_WIDTH = 5;
const ACTIVE_WIDTH = 10;
const TICK_HEIGHT = 2;
const TICK_GAP = 6;
const INDENT_PER_LEVEL = 4;
const RAIL_LEFT = 12;
const RAIL_INNER_WIDTH = ACTIVE_WIDTH + 6;
const POPOVER_OFFSET = 12;
const POPOVER_WIDTH = 260;
const POPOVER_INDENT_PER_LEVEL = 12;

const CLOSED_HOT_ZONE_WIDTH = RAIL_LEFT + RAIL_INNER_WIDTH + 6;
const OPEN_HOT_ZONE_WIDTH = RAIL_LEFT + RAIL_INNER_WIDTH + POPOVER_OFFSET + POPOVER_WIDTH;

interface SectionRailProps {
  filePath: string;
  view: EditorView | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

function scrollToHeading(
  view: EditorView,
  scroller: HTMLElement,
  heading: DocumentHeading,
  behavior: ScrollBehavior,
) {
  const pos = Math.min(heading.pos, view.state.doc.length);
  const block = view.lineBlockAt(pos);
  const screenY = view.documentTop + block.top;
  const scrollerRect = scroller.getBoundingClientRect();
  const delta = screenY - scrollerRect.top - EDITOR_SAFE_SCROLL_MARGIN;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const next = Math.max(0, Math.min(scroller.scrollTop + delta, max));
  scroller.scrollTo({ top: next, behavior });
}

function buildHeadingLink(heading: DocumentHeading) {
  return `[${heading.text}](#${heading.slug})`;
}

export function SectionRail({ filePath, view, scrollContainerRef }: SectionRailProps) {
  const headings = useDocumentHeadings(filePath);
  const { activeIndex, activeByLevel } = useActiveHeadings(view, scrollContainerRef, headings);
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  useEscKey(isOpen, close);

  const handleTickClick = (heading: DocumentHeading) => {
    const scroller = scrollContainerRef.current;
    if (!view || !scroller) return;
    scrollToHeading(view, scroller, heading, "smooth");
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

  const activeLevelSet = new Set(Object.values(activeByLevel));

  return (
    <div
      className="absolute inset-y-0 left-0 z-20 pointer-events-none"
      style={{ width: isOpen ? OPEN_HOT_ZONE_WIDTH : CLOSED_HOT_ZONE_WIDTH }}
    >
      <div
        className="absolute inset-0 pointer-events-auto"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 flex flex-col"
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
              marginLeft: (heading.level - 1) * INDENT_PER_LEVEL,
              background: "currentColor",
              opacity: isActive ? 1 : 0.2,
            };
            return (
              <button
                key={`${heading.line}-${i}`}
                type="button"
                className="block cursor-pointer border-0 p-0 bg-transparent"
                style={tickStyle}
                title={heading.text}
                onClick={() => handleTickClick(heading)}
                onContextMenu={(event) => handleContextMenu(event, heading)}
              />
            );
          })}
        </div>

        {isOpen && (
          <div
            className="absolute top-1/2 -translate-y-1/2 rounded-2xl"
            style={{
              left: RAIL_LEFT + RAIL_INNER_WIDTH + POPOVER_OFFSET,
              width: POPOVER_WIDTH,
              maxHeight: "70vh",
              overflowY: "auto",
              padding: "12px 16px",
              background: "var(--surface-card)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid var(--line-subtler)",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.18)",
              isolation: "isolate",
            }}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-2xl"
              style={{
                background: "color-mix(in srgb, var(--bg-base) 55%, transparent)",
                zIndex: -1,
              }}
            />
            <ul className="flex flex-col" style={{ gap: 4 }}>
              {headings.map((heading, i) => {
                const isActive = activeLevelSet.has(i);
                return (
                  <li key={`${heading.line}-${i}`}>
                    <button
                      type="button"
                      className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left truncate"
                      style={{
                        paddingLeft: (heading.level - 1) * POPOVER_INDENT_PER_LEVEL,
                        color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                        fontWeight: isActive ? 600 : 400,
                        fontSize: 13,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.4,
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
          </div>
        )}
      </div>
    </div>
  );
}
