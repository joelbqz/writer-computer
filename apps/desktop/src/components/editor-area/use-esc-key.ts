import { useEffect, useRef } from "react";

export function useEscKey(active: boolean, onEsc: () => void) {
  // Hold the latest callback in a ref so consumers can pass inline arrows
  // without re-registering the listener on every parent render.
  const onEscRef = useRef(onEsc);
  onEscRef.current = onEsc;

  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active]);
}
