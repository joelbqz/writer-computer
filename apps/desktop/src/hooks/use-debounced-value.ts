import { useEffect, useState } from "react";

/** Trailing-debounced copy of `value`. Use for derivations that are expensive
 *  on large inputs and only feed display (document headings, stats), so the
 *  keystroke path stays free of full-document passes. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  // Debouncing is inherently a timer-driven sync of external input to state.
  // eslint-disable-next-line react-doctor/no-event-handler
  useEffect(() => {
    if (Object.is(debounced, value)) return;
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs, debounced]);
  return debounced;
}
