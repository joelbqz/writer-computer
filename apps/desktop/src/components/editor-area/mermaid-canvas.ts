// Fixed-height canvas frame for mermaid diagrams: drag-pan, wheel/button zoom,
// fit-to-viewport reset, and an edit-code toggle. The frame is mounted by the
// CodeMirror MermaidWidget once the SVG has been rendered.

export const MERMAID_CANVAS_HEIGHT = 480;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const BUTTON_ZOOM_FACTOR = 1.2;
const KEY_ZOOM_FACTOR = 1.15;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const KEY_PAN_STEP = 24;
const FIT_MARGIN_PX = 16;

export type MermaidCanvasOptions = {
  svgHtml: string;
  ariaLabel: string;
  editMode: boolean;
  onToggleEdit: () => void;
};

type CanvasState = {
  zoom: number;
  panX: number;
  panY: number;
};

export function mountMermaidCanvas(host: HTMLElement, opts: MermaidCanvasOptions): void {
  host.replaceChildren();
  host.classList.add("cm-mermaid-canvas");
  host.tabIndex = 0;

  const viewport = document.createElement("div");
  viewport.className = "cm-mermaid-canvas-viewport";

  const stage = document.createElement("div");
  stage.className = "cm-mermaid-canvas-stage";
  stage.innerHTML = opts.svgHtml;
  // Hide the stage until the first fit. `toDOM` runs before the wrapper is in
  // the document, so `viewport.clientWidth` is 0 — we can't compute the
  // centered transform synchronously. Without this the user briefly sees the
  // diagram at top-left before it snaps to centered on the next frame.
  stage.style.opacity = "0";

  const svg = stage.querySelector("svg") as SVGSVGElement | null;
  if (svg) {
    // Keep the SVG's existing `style` attribute — beautiful-mermaid uses it
    // to declare the CSS custom properties (--bg, --fg, --_line, …) that the
    // inner <style> block references for every fill/stroke. Stripping it
    // collapses all the theming. Width/height for zoom are set via individual
    // style properties below, which merge with whatever's already there.
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.ariaLabel);
  }

  viewport.append(stage);
  host.append(viewport);

  const editButton = makeButton(
    opts.editMode ? "Preview" : "Edit code",
    opts.editMode ? "Return to preview" : "Edit code",
  );
  editButton.classList.add("cm-mermaid-canvas-edit");

  const zoomCluster = document.createElement("div");
  zoomCluster.className = "cm-mermaid-canvas-zoom";
  const zoomInButton = makeButton("+", "Zoom in");
  const zoomOutButton = makeButton("−", "Zoom out");
  zoomInButton.classList.add("cm-mermaid-canvas-zoom-btn");
  zoomOutButton.classList.add("cm-mermaid-canvas-zoom-btn");
  zoomCluster.append(zoomInButton, zoomOutButton);

  host.append(editButton, zoomCluster);

  const state: CanvasState = { zoom: 1, panX: 0, panY: 0 };
  // Natural (unzoomed) SVG dimensions in pixels. Mermaid always emits a
  // `viewBox` so we use that as the canonical source — it's robust against
  // mermaid's `width="100%"` attribute and against the fact that we strip
  // the inline style.
  let naturalW = 0;
  let naturalH = 0;

  function measureNatural(): void {
    if (!svg || naturalW > 0) return;
    const vb = svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      naturalW = vb.width;
      naturalH = vb.height;
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      naturalW = rect.width;
      naturalH = rect.height;
    }
  }

  function applyTransform(): void {
    if (svg && naturalW > 0) {
      svg.style.width = `${naturalW * state.zoom}px`;
      svg.style.height = `${naturalH * state.zoom}px`;
    }
    stage.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  }

  function clampZoom(z: number): number {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }

  function fitToViewport(): void {
    measureNatural();
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (naturalW <= 0 || naturalH <= 0 || vw <= 0 || vh <= 0) {
      applyTransform();
      return;
    }
    // Fit to fill: scale so the diagram fills one axis with FIT_MARGIN_PX
    // breathing room. Small diagrams scale up (capped at ZOOM_MAX), large
    // diagrams scale down (capped at ZOOM_MIN).
    const fit = Math.min((vw - FIT_MARGIN_PX * 2) / naturalW, (vh - FIT_MARGIN_PX * 2) / naturalH);
    state.zoom = clampZoom(fit);
    state.panX = (vw - naturalW * state.zoom) / 2;
    state.panY = (vh - naturalH * state.zoom) / 2;
    applyTransform();
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    measureNatural();
    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const stageX = (localX - state.panX) / state.zoom;
    const stageY = (localY - state.panY) / state.zoom;
    const next = clampZoom(state.zoom * factor);
    if (next === state.zoom) return;
    state.zoom = next;
    state.panX = localX - stageX * next;
    state.panY = localY - stageY * next;
    applyTransform();
  }

  function zoomAtCenter(factor: number): void {
    const rect = viewport.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  zoomInButton.addEventListener("click", () => zoomAtCenter(BUTTON_ZOOM_FACTOR));
  zoomOutButton.addEventListener("click", () => zoomAtCenter(1 / BUTTON_ZOOM_FACTOR));
  editButton.addEventListener("click", () => opts.onToggleEdit());

  // Drag-to-pan via pointer events. Capture the pointer so a drag that leaves
  // the viewport still receives moves; release on pointerup/cancel.
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanX = 0;
  let dragStartPanY = 0;

  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragPointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanX = state.panX;
    dragStartPanY = state.panY;
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add("is-dragging");
    host.focus();
    e.preventDefault();
  });

  viewport.addEventListener("pointermove", (e) => {
    if (dragPointerId !== e.pointerId) return;
    state.panX = dragStartPanX + (e.clientX - dragStartX);
    state.panY = dragStartPanY + (e.clientY - dragStartY);
    applyTransform();
  });

  const endDrag = (e: PointerEvent) => {
    if (dragPointerId !== e.pointerId) return;
    dragPointerId = null;
    viewport.classList.remove("is-dragging");
    if (viewport.hasPointerCapture(e.pointerId)) {
      viewport.releasePointerCapture(e.pointerId);
    }
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  // Wheel: only zoom when a modifier is held (Cmd/Ctrl) or when a trackpad
  // pinch fires the synthetic wheel event with ctrlKey set. Otherwise let the
  // event bubble so the surrounding document scrolls past the canvas.
  viewport.addEventListener(
    "wheel",
    (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      zoomAt(e.clientX, e.clientY, factor);
    },
    { passive: false },
  );

  host.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLButtonElement) return;
    let handled = true;
    switch (e.key) {
      case "ArrowUp":
        state.panY += KEY_PAN_STEP;
        applyTransform();
        break;
      case "ArrowDown":
        state.panY -= KEY_PAN_STEP;
        applyTransform();
        break;
      case "ArrowLeft":
        state.panX += KEY_PAN_STEP;
        applyTransform();
        break;
      case "ArrowRight":
        state.panX -= KEY_PAN_STEP;
        applyTransform();
        break;
      case "+":
      case "=":
        zoomAtCenter(KEY_ZOOM_FACTOR);
        break;
      case "-":
      case "_":
        zoomAtCenter(1 / KEY_ZOOM_FACTOR);
        break;
      case "0":
        fitToViewport();
        break;
      case "Enter":
        opts.onToggleEdit();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // First paint: fit the diagram once the layout has settled. Wait one frame
  // so the wrapper has its final width inside CodeMirror's content layout,
  // then reveal the stage.
  requestAnimationFrame(() => {
    fitToViewport();
    stage.style.opacity = "1";
  });
}

function makeButton(label: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", title);
  // Keep the editor focused when the user clicks. Without `preventDefault`
  // on mousedown, the browser focuses the button — and on the toggle path,
  // that focus shift races with the dispatch's DOM rebuild + our explicit
  // `view.contentDOM.focus()` call. The result is the editor briefly losing
  // focus and CM applying a different selection than the one we dispatched.
  // `stopPropagation` on mousedown keeps CM's editor-level pointerdown
  // handlers (which may run before `ignoreEvent` is consulted in some paths)
  // from racing with the click handler's dispatch.
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return b;
}
