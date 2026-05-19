import { useCallback, type HTMLAttributes, type ReactNode, type Ref, type UIEvent } from "react";
import { useScrollFade } from "@/hooks/use-scroll-fade";

interface ScrollFadeProps extends HTMLAttributes<HTMLDivElement> {
  axis?: "vertical" | "horizontal";
  fadeSize?: string;
  alwaysFade?: boolean;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

export function ScrollFade({
  axis = "vertical",
  fadeSize = "24px",
  alwaysFade = false,
  className,
  style,
  onScroll: onScrollProp,
  ref,
  children,
  ...rest
}: ScrollFadeProps) {
  const { setRef, scrolledStart, scrolledEnd, onScroll } = useScrollFade(axis);
  const direction = axis === "vertical" ? "bottom" : "right";
  const showStart = alwaysFade || scrolledStart;
  const showEnd = alwaysFade || scrolledEnd;
  const maskImage = `linear-gradient(to ${direction}, ${
    showStart ? `transparent, black ${fadeSize},` : "black,"
  } ${showEnd ? `black calc(100% - ${fadeSize}), transparent` : "black"})`;

  const mergedRef = useCallback(
    (el: HTMLDivElement | null) => {
      setRef(el);
      if (typeof ref === "function") {
        ref(el);
      } else if (ref) {
        (ref as { current: HTMLDivElement | null }).current = el;
      }
    },
    [setRef, ref],
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onScroll();
      onScrollProp?.(event);
    },
    [onScroll, onScrollProp],
  );

  return (
    <div
      {...rest}
      ref={mergedRef}
      onScroll={handleScroll}
      className={className}
      style={{ ...style, maskImage, WebkitMaskImage: maskImage }}
    >
      {children}
    </div>
  );
}
