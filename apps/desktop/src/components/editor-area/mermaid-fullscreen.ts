// Fullscreen overlay for the mermaid canvas. Mounts a fixed-position div at
// the document body, renders a fresh copy of the canvas (pan + zoom + reset
// controls) inside it, and tears the node down on close. Esc, the ✕ button, or a
// backdrop click dismiss. Implemented as a plain div (not a `<dialog>`) so
// styling, layering, and event handling stay under our control and don't
// depend on the user agent's modal-dialog quirks.

import { mountMermaidCanvas } from "./mermaid-canvas";
import { renderMermaid } from "./mermaid-renderer";

export function openMermaidFullscreen(source: string, ariaLabel: string): void {
  const result = renderMermaid(source);
  if (!result.svg) return;

  const overlay = document.createElement("div");
  overlay.className = "cm-mermaid-fullscreen";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.tabIndex = -1;

  const host = document.createElement("div");
  host.className = "cm-mermaid-canvas cm-mermaid-fullscreen-canvas";
  host.tabIndex = 0;
  overlay.append(host);

  // Capture whatever was focused before we steal focus to the canvas, so we
  // can restore it on close. Without this, the editor's contentDOM stays
  // blurred after dismiss and the next Edit-code click hits a focus race in
  // CodeMirror's selection-sync that scrolls back to the stale caret.
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    previouslyFocused?.focus({ preventScroll: true });

    // Play the exit animation (CSS handles opacity + scale via the
    // `.is-open` toggle), then remove the overlay from the DOM once the
    // canvas transition finishes. The setTimeout is a safety net for the
    // case where `transitionend` doesn't fire (e.g. the user closes
    // before the entry animation committed).
    overlay.classList.remove("is-open");
    let removed = false;
    const finalize = () => {
      if (removed) return;
      removed = true;
      overlay.remove();
    };
    host.addEventListener("transitionend", finalize, { once: true });
    setTimeout(finalize, 240);
  };

  // Capture-phase listener so Esc dismisses the overlay before any inner
  // handler (e.g. CodeMirror) sees the event.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKeyDown, true);

  // Click on the overlay itself (the backdrop area outside the canvas host)
  // closes. Clicks inside the canvas bubble up but have a different target,
  // so this filter leaves pan/zoom interactions alone.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  mountMermaidCanvas(host, {
    svgHtml: result.svg,
    ariaLabel,
    onClose: close,
  });

  document.body.append(overlay);
  host.focus();

  // Trigger the entrance animation. Force a layout read first so the
  // browser commits the closed state, then flip to `.is-open` on the next
  // frame so the transition has a starting point to interpolate from.
  void overlay.getBoundingClientRect();
  requestAnimationFrame(() => overlay.classList.add("is-open"));
}
