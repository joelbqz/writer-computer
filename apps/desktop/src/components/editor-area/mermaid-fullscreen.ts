// Fullscreen dialog for the mermaid canvas. Mounts a native <dialog> at the
// document body, renders a fresh copy of the canvas (pan + zoom controls)
// inside it, and tears the node down on close. The dialog uses
// `showModal()` so backdrop, focus trap, and Esc-to-close come for free.

import { mountMermaidCanvas } from "./mermaid-canvas";
import { renderMermaid } from "./mermaid-renderer";

export function openMermaidFullscreen(source: string, ariaLabel: string): void {
  const result = renderMermaid(source);
  if (!result.svg) return;

  const dialog = document.createElement("dialog");
  dialog.className = "cm-mermaid-fullscreen";

  const host = document.createElement("div");
  host.className = "cm-mermaid-canvas cm-mermaid-fullscreen-canvas";
  host.tabIndex = 0;
  dialog.append(host);

  const close = () => {
    if (dialog.open) dialog.close();
  };

  mountMermaidCanvas(host, {
    svgHtml: result.svg,
    ariaLabel,
    onClose: close,
  });

  // Click on backdrop (the dialog element itself, not the inner host) closes.
  // The native <dialog> backdrop is the dialog element's own padding/box
  // around the centered child — click events on the host bubble up but have
  // a target inside, so we filter on `e.target === dialog`.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  // Native <dialog> closes on Esc; on `close` we tear down the DOM.
  dialog.addEventListener("close", () => {
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  host.focus();
}
