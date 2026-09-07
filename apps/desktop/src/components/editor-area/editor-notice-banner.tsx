import { dismissEditorNotice, useEditorNoticeStore } from "./editor-notice-store";

export function EditorNoticeBanner() {
  const message = useEditorNoticeStore((s) => s.message);
  if (!message) return null;
  return (
    <button
      type="button"
      onClick={dismissEditorNotice}
      className="pointer-events-auto absolute left-1/2 top-6 z-30 max-w-[90%] -translate-x-1/2 cursor-pointer rounded-lg border-0 px-3 py-2 text-left text-[13px]"
      style={{
        background: "var(--surface-card)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
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
