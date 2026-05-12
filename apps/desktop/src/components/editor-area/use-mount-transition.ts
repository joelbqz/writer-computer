import { useEffect, useState } from "react";

export interface MountTransition {
  shouldRender: boolean;
  phase: "open" | "closed";
}

export function useMountTransition(active: boolean, durationMs: number): MountTransition {
  const [shouldRender, setShouldRender] = useState(false);
  const [phase, setPhase] = useState<"open" | "closed">("closed");

  useEffect(() => {
    if (active) {
      setShouldRender(true);
      const frame = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(frame);
    }
    setPhase("closed");
    const timer = window.setTimeout(() => setShouldRender(false), durationMs);
    return () => clearTimeout(timer);
  }, [active, durationMs]);

  return { shouldRender, phase };
}
