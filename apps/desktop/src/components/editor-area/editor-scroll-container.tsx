import type { ReactNode, Ref } from "react";

const FADE_DISTANCE = 120;
const SCROLLBAR_GUTTER = "18px";
const FADE_MASK_VERTICAL = `linear-gradient(to bottom, transparent 5%, black 15%, black 85%, transparent)`;
const FADE_MASK_GUTTER = `linear-gradient(to right, black ${SCROLLBAR_GUTTER}, transparent ${SCROLLBAR_GUTTER}, transparent calc(100% - ${SCROLLBAR_GUTTER}), black calc(100% - ${SCROLLBAR_GUTTER}))`;
const FADE_MASK = `${FADE_MASK_VERTICAL}, ${FADE_MASK_GUTTER}`;

// Vertical inset to keep content (e.g. the active search match) clear of both
// the FADE_MASK_VERTICAL gradient and the ProgressiveBlur overlay.
export const EDITOR_SAFE_SCROLL_MARGIN = FADE_DISTANCE + 20;
export const EDITOR_SCROLLBAR_GUTTER = SCROLLBAR_GUTTER;

function ProgressiveBlur({ position }: { position: "top" | "bottom" }) {
  const isTop = position === "top";

  const topFade = `linear-gradient(to bottom, black 40%, transparent 80%)`;
  const bottomFade = `linear-gradient(to top, black 20%, transparent 60%)`;
  return (
    <div
      className="pointer-events-none absolute z-10"
      style={{
        height: FADE_DISTANCE,
        left: SCROLLBAR_GUTTER,
        right: SCROLLBAR_GUTTER,
        [isTop ? "top" : "bottom"]: 0,
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        maskImage: isTop ? topFade : bottomFade,
        WebkitMaskImage: isTop ? topFade : bottomFade,
      }}
    />
  );
}

interface EditorScrollContainerProps {
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

export function EditorScrollContainer({ ref, children }: EditorScrollContainerProps) {
  return (
    <div className="relative h-full">
      <div
        ref={ref}
        className="h-full overflow-y-auto [scrollbar-gutter:stable_both-edges]"
        style={{
          maskImage: FADE_MASK,
          WebkitMaskImage: FADE_MASK,
          maskComposite: "add",
          WebkitMaskComposite: "source-over",
          borderTop: "12px solid transparent",
          borderBottom: "12px solid transparent",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
      <ProgressiveBlur position="top" />
      <ProgressiveBlur position="bottom" />
    </div>
  );
}
