import type { HTMLAttributes, Ref } from "react";

interface SurfaceCardProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
}

// Floating card surface used by popovers and dialogs (command palette,
// editor search overlay, section-rail outline). Carries the translucent
// background, blur, subtle border, rounded corners, and a `::before` layer
// that paints bg-base at 55% so the card reads opaque enough to be a card
// rather than fully transparent chrome. The shared visual rules live in
// App.css under `.surface-card, [cmdk-dialog]` so cmdk's library-rendered
// dialog picks them up via its attribute selector without needing a
// component wrapper.
//
// Consumers must position the card themselves (`absolute`/`fixed`/`relative`)
// so the `::before` layer can anchor to it.
export function SurfaceCard({ className, children, ...rest }: SurfaceCardProps) {
  const merged = ["surface-card", className].filter(Boolean).join(" ");
  return (
    <div className={merged} {...rest}>
      {children}
    </div>
  );
}
