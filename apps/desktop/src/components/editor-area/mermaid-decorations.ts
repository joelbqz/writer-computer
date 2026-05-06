import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { foldableSyntaxFacet } from "@prosemark/core";
import { renderMermaid, type MermaidTheme } from "./mermaid-renderer";
import { MERMAID_CANVAS_HEIGHT, mountMermaidCanvas } from "./mermaid-canvas";

let widgetCounter = 0;

// Outer widget padding (top + bottom). Kept in lockstep with the
// `.cm-mermaid-widget` rule below so `estimatedHeight` matches the rendered
// box.
const WIDGET_VERTICAL_PADDING = 16;

function currentMermaidTheme(): MermaidTheme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

const OBSERVER_KEY = Symbol("mermaidObserver");
type WrapperWithObserver = HTMLElement & { [OBSERVER_KEY]?: IntersectionObserver };

class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly id: string,
    readonly theme: MermaidTheme,
    readonly editMode: boolean,
    readonly fenceFrom: number,
    readonly fenceTo: number,
    readonly codeFrom: number,
    readonly codeTo: number,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return (
      this.source === other.source && this.theme === other.theme && this.editMode === other.editMode
    );
  }

  // The canvas frame has a fixed height regardless of diagram size, so the
  // CodeMirror heightmap can settle on a stable value immediately. No more
  // measurement-cache dance.
  get estimatedHeight(): number {
    return MERMAID_CANVAS_HEIGHT + WIDGET_VERTICAL_PADDING;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div") as WrapperWithObserver;
    wrapper.className = "cm-mermaid-widget";
    wrapper.contentEditable = "false";

    const host = document.createElement("div");
    host.className = "cm-mermaid-canvas";
    host.tabIndex = 0;
    host.textContent = "Loading diagram...";
    wrapper.append(host);

    const onToggleEdit = () => {
      const target = computeEditToggleTarget({
        editMode: this.editMode,
        fenceFrom: this.fenceFrom,
        fenceTo: this.fenceTo,
        codeFrom: this.codeFrom,
        codeTo: this.codeTo,
        docLength: view.state.doc.length,
      });
      view.dispatch({ selection: { anchor: target } });
      view.focus();
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        void renderMermaid(this.source, this.theme, this.id).then((result) => {
          if (result.svg) {
            mountMermaidCanvas(host, {
              svgHtml: result.svg,
              ariaLabel: `Mermaid diagram: ${this.source.split("\n")[0]}`,
              editMode: this.editMode,
              onToggleEdit,
            });
          } else if (result.error) {
            host.classList.remove("cm-mermaid-canvas");
            host.removeAttribute("tabindex");
            host.classList.add("cm-mermaid-error");
            host.textContent = `Diagram error: ${result.error}`;
          }
        });
      }
    });
    observer.observe(wrapper);
    wrapper[OBSERVER_KEY] = observer;

    return wrapper;
  }

  destroy(dom: HTMLElement): void {
    const observer = (dom as WrapperWithObserver)[OBSERVER_KEY];
    observer?.disconnect();
  }

  ignoreEvent(): boolean {
    // The canvas owns all pointer/keyboard interaction inside the widget —
    // pan, zoom, control buttons, edit toggle. If CodeMirror also processed
    // these events it would try to place the caret at the replaced range,
    // which immediately flips the syntax facet back into edit mode and
    // hijacks zoom/fit clicks.
    return true;
  }
}

type EditToggleInput = {
  editMode: boolean;
  fenceFrom: number;
  fenceTo: number;
  codeFrom: number;
  codeTo: number;
  docLength: number;
};

/**
 * Compute the caret position to dispatch when the user clicks the canvas's
 * edit/preview toggle.
 *
 * - In preview mode (editMode=false), move the caret into the fence — to the
 *   start of the CodeText if there is one, otherwise just past the opening
 *   CodeMark. The cursor inside [fenceFrom, fenceTo] flips the syntax facet
 *   to the non-replacing widget so the source is visible for editing.
 * - In edit mode (editMode=true), move the caret to fenceTo + 1 (clamped to
 *   document length) so it no longer touches the fence range.
 */
export function computeEditToggleTarget(input: EditToggleInput): number {
  const { editMode, fenceFrom, fenceTo, codeFrom, codeTo, docLength } = input;
  if (editMode) {
    return Math.min(fenceTo + 1, docLength);
  }
  if (codeTo > codeFrom) return codeFrom;
  return Math.min(fenceFrom + 1, fenceTo);
}

/**
 * Extract info string, code content, and child node positions for a
 * FencedCode. The Lezer markdown tree structure is:
 *   FencedCode → CodeMark, CodeInfo, CodeText, CodeMark
 */
function parseFencedCode(
  state: { doc: { sliceString(from: number, to: number): string } },
  node: {
    node: {
      from: number;
      to: number;
      firstChild: {
        name: string;
        from: number;
        to: number;
        nextSibling: typeof node.node.firstChild;
      } | null;
    };
  },
): { info: string; source: string; codeFrom: number; codeTo: number } | undefined {
  let info = "";
  let source = "";
  let codeFrom = node.node.to;
  let codeTo = node.node.to;

  let child = node.node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") {
      info = state.doc.sliceString(child.from, child.to);
    } else if (child.name === "CodeText") {
      source = state.doc.sliceString(child.from, child.to);
      codeFrom = child.from;
      codeTo = child.to;
    }
    child = child.nextSibling;
  }

  if (!info) return undefined;
  return { info, source, codeFrom, codeTo };
}

const mermaidFoldExtension = foldableSyntaxFacet.of({
  nodePath: "FencedCode",
  buildDecorations: (state, node, selectionTouchesRange) => {
    const parsed = parseFencedCode(state, node);
    if (!parsed) return undefined;

    if (!parsed.info.trim().toLowerCase().startsWith("mermaid")) return undefined;

    const source = parsed.source.trim();
    if (!source) return undefined;

    const id = `mermaid-${++widgetCounter}`;
    const theme = currentMermaidTheme();
    const widget = new MermaidWidget(
      source,
      id,
      theme,
      selectionTouchesRange,
      node.from,
      node.to,
      parsed.codeFrom,
      parsed.codeTo,
    );

    if (selectionTouchesRange) {
      // Cursor is inside: show raw source and render a preview widget below the fence
      return Decoration.widget({ widget, block: true }).range(node.to);
    }

    // Cursor is outside: replace the entire fence with the rendered canvas
    return Decoration.replace({ widget, block: true, inclusiveStart: true }).range(
      node.from,
      node.to,
    );
  },
});

/**
 * Watch the document's `data-theme` attribute. When the app theme changes,
 * nudge the editor to rebuild decorations so diagrams re-render under the
 * new theme.
 */
const themeSync = ViewPlugin.fromClass(
  class {
    private readonly observer: MutationObserver;

    constructor(view: EditorView) {
      this.observer = new MutationObserver(() => {
        view.dispatch({ selection: view.state.selection });
      });
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }

    destroy() {
      this.observer.disconnect();
    }
  },
);

const mermaidTheme = EditorView.baseTheme({
  ".cm-mermaid-widget": {
    padding: "8px 0",
  },
  ".cm-mermaid-canvas": {
    position: "relative",
    height: `${MERMAID_CANVAS_HEIGHT}px`,
    border: "1px solid var(--bg-3, rgba(127, 127, 127, 0.3))",
    borderRadius: "6px",
    backgroundColor: "var(--bg, transparent)",
    overflow: "hidden",
    outline: "none",
  },
  ".cm-mermaid-canvas:focus-visible": {
    boxShadow: "0 0 0 2px var(--accent, #0066cc)",
  },
  ".cm-mermaid-canvas-viewport": {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
  },
  ".cm-mermaid-canvas-viewport.is-dragging": {
    cursor: "grabbing",
  },
  ".cm-mermaid-canvas-stage": {
    position: "absolute",
    top: "0",
    left: "0",
    transformOrigin: "0 0",
  },
  ".cm-mermaid-canvas-stage svg": {
    display: "block",
    maxWidth: "none",
  },
  // Edge labels render with an opaque background that defaults to white;
  // align them with the editor background so diagrams blend with both themes.
  ".cm-mermaid-canvas-stage svg .edgeLabel, .cm-mermaid-canvas-stage svg .edgeLabel foreignObject div, .cm-mermaid-canvas-stage svg .edgeLabel span":
    {
      backgroundColor: "var(--bg) !important",
    },
  ".cm-mermaid-canvas-stage svg .edgeLabel rect, .cm-mermaid-canvas-stage svg .labelBkg": {
    fill: "var(--bg) !important",
  },
  ".cm-mermaid-canvas-controls": {
    position: "absolute",
    bottom: "8px",
    right: "8px",
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "3px 4px",
    backgroundColor: "var(--bg-2, rgba(127, 127, 127, 0.12))",
    border: "1px solid var(--bg-3, rgba(127, 127, 127, 0.2))",
    borderRadius: "6px",
    opacity: "0",
    transition: "opacity 120ms ease-out",
    pointerEvents: "auto",
    fontSize: "12px",
  },
  ".cm-mermaid-canvas:hover .cm-mermaid-canvas-controls, .cm-mermaid-canvas:focus-within .cm-mermaid-canvas-controls":
    {
      opacity: "1",
    },
  ".cm-mermaid-canvas-controls button": {
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    padding: "3px 7px",
    borderRadius: "4px",
    font: "inherit",
    lineHeight: "1",
  },
  ".cm-mermaid-canvas-controls button:hover": {
    backgroundColor: "var(--bg-3, rgba(127, 127, 127, 0.25))",
  },
  ".cm-mermaid-canvas-controls button:focus-visible": {
    outline: "2px solid var(--accent, #0066cc)",
    outlineOffset: "1px",
  },
  ".cm-mermaid-canvas-zoom-label": {
    minWidth: "3.5ch",
    textAlign: "center",
    opacity: "0.75",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-mermaid-canvas-edit-toggle": {
    marginLeft: "4px",
    paddingLeft: "8px !important",
    borderLeft: "1px solid var(--bg-3, rgba(127, 127, 127, 0.25)) !important",
    borderRadius: "0 4px 4px 0 !important",
  },
  ".cm-mermaid-error": {
    padding: "0.5em 1em",
    color: "var(--text-error, #ff6b6b)",
    backgroundColor: "var(--code-bg, #2d2d2d)",
    borderRadius: "4px",
    fontSize: "0.85em",
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
});

/**
 * Workaround: foldExtension only rebuilds on docChanged/selection, not on syntax
 * tree progression. When the incremental parser finishes after initial load, folds
 * stay stale. This plugin detects tree changes and nudges a rebuild.
 * (Same pattern as table-decorations.ts)
 */
const foldTreeSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) !== syntaxTree(update.startState)) {
        setTimeout(() => {
          update.view.dispatch({ selection: update.view.state.selection });
        });
      }
    }
  },
);

export function mermaidDecorations() {
  return [mermaidFoldExtension, mermaidTheme, foldTreeSync, themeSync];
}
