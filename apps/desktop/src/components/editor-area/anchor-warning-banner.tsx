import { dismissAnchorWarning, useAnchorWarningStore } from "./anchor-warning-store";

export function AnchorWarningBanner() {
  const message = useAnchorWarningStore((s) => s.message);
  if (!message) return null;
  return (
    <button
      type="button"
      onClick={dismissAnchorWarning}
      className="pointer-events-auto absolute left-1/2 top-6 z-30 max-w-[90%] -translate-x-1/2 cursor-pointer rounded-lg border-0 px-3 py-2 text-left text-[13px]"
      style={{
        background: "var(--surface-card)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid var(--line-subtler)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
        color: "var(--text-secondary)",
        letterSpacing: "-0.01em",
      }}
    >
      {message}
    </button>
  );
}
