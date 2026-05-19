import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { foldableSyntaxFacet } from "@/lib/prosemark-core/main";
import { renderMermaid } from "./mermaid-renderer";
import { MERMAID_CANVAS_HEIGHT, MermaidCanvasHandle, mountMermaidCanvas } from "./mermaid-canvas";
import { openMermaidFullscreen } from "./mermaid-fullscreen";
import "./mermaid-canvas.css";

// Outer widget padding (top + bottom). `mermaid-canvas.css` splits this
// evenly across top/bottom so `estimatedHeight` matches the rendered box.
const WIDGET_VERTICAL_PADDING = 16;

// Map keyed by wrapper DOM element so `updateDOM` and `destroy` can find the
// live canvas handle without round-tripping through CodeMirror state. Weak so
// disposed wrappers don't leak.
const widgetHandles = new WeakMap<HTMLElement, MermaidCanvasHandle>();

/**
 * Mermaid widget. Identity is `(body, fenceText)` — the body drives the SVG
 * cache and the fence text drives the inline editor's content. The Edit-code
 * toggle lives entirely inside the canvas frame, so it never participates in
 * widget identity and a toggle never triggers a CodeMirror rebuild.
 */
class MermaidWidget extends WidgetType {
  constructor(
    readonly body: string,
    readonly fenceText: string,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return this.body === other.body && this.fenceText === other.fenceText;
  }

  // Fixed height regardless of diagram size, so the heightmap settles on a
  // stable value immediately.
  get estimatedHeight(): number {
    return MERMAID_CANVAS_HEIGHT + WIDGET_VERTICAL_PADDING;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-mermaid-widget";
    wrapper.contentEditable = "false";

    const host = document.createElement("div");
    host.className = "cm-mermaid-canvas";
    host.tabIndex = 0;
    wrapper.append(host);

    const ariaLabel = `Mermaid diagram: ${this.body.split("\n")[0]}`;
    const onExpand = () => openMermaidFullscreen(this.body, ariaLabel);
    const onSourceChange = (next: string) => writeFenceText(view, host, next);

    // Synchronous render. beautiful-mermaid is sync and the SVG cache makes
    // repeat calls O(map lookup), so the wrapper paints with its final SVG in
    // the same frame it enters the DOM — no IntersectionObserver, no async
    // gap that can leave the user stuck on a placeholder.
    const result = renderMermaid(this.body);
    const handle = mountMermaidCanvas(host, {
      svgHtml: result.svg ?? "",
      ariaLabel,
      source: this.fenceText,
      onSourceChange,
      onExpand,
    });
    if (result.error) handle.updateSource("", this.fenceText, result.error);
    widgetHandles.set(wrapper, handle);

    return wrapper;
  }

  // Called when the new widget isn't `eq` to the old one but CM is willing to
  // reuse the existing DOM. Returning `true` keeps the DOM (and the nested
  // editor's focus, selection, scroll, history) intact across source changes.
  updateDOM(dom: HTMLElement, _view: EditorView): boolean {
    const handle = widgetHandles.get(dom);
    if (!handle) return false;
    const result = renderMermaid(this.body);
    handle.updateSource(result.svg ?? "", this.fenceText, result.error);
    return true;
  }

  destroy(dom: HTMLElement): void {
    const handle = widgetHandles.get(dom);
    handle?.destroy();
    widgetHandles.delete(dom);
  }

  ignoreEvent(): boolean {
    // The canvas owns all pointer/keyboard interaction inside the widget.
    // Without this CodeMirror would also process clicks and try to place the
    // caret at the replaced range, hijacking the toggle and zoom buttons.
    return true;
  }
}

/**
 * Find the FencedCode node enclosing the position of `host` in the document.
 *
 * `posAtDOM` for a Decoration.replace widget that covers `[node.from, node.to]`
 * resolves at the boundary; we try side=-1 first and fall back to side=1.
 */
function findEnclosingFencedCode(view: EditorView, host: HTMLElement) {
  const pos = view.posAtDOM(host);
  const tree = syntaxTree(view.state);
  for (const side of [-1, 1] as const) {
    let node = tree.resolveInner(pos, side);
    while (node.name !== "FencedCode" && node.parent) node = node.parent;
    if (node.name === "FencedCode") return node;
  }
  return null;
}

/**
 * Dispatch a transaction on the outer view replacing the *entire fence*
 * (opening marker, info string, body, closing marker) with `next`. Position
 * is resolved live from the syntax tree at call time, so it stays correct
 * even as text above the fence shifts.
 *
 * If the user breaks the fence syntax mid-edit (e.g. they delete the closing
 * ```), the parser stops recognizing it as a FencedCode on the next rebuild
 * and the widget collapses to raw markdown — that's the natural consequence
 * of editing the full fence, and the user can recover by completing the
 * fence again.
 */
function writeFenceText(view: EditorView, host: HTMLElement, next: string): void {
  const fence = findEnclosingFencedCode(view, host);
  if (!fence) return;
  if (view.state.doc.sliceString(fence.from, fence.to) === next) return;
  view.dispatch({
    changes: { from: fence.from, to: fence.to, insert: next },
    // No `selection` field: leave the outer selection where it was. The
    // widget owns its own focus (inside the nested editor) and we don't
    // want to scroll the outer viewport.
  });
}

/**
 * Extract info string and code content for a FencedCode node. Lezer's tree:
 *   FencedCode → CodeMark, CodeInfo, CodeText, CodeMark
 * Multiple CodeText children can occur (e.g. blockquoted fences); we
 * concatenate their slices.
 */
function parseFencedCode(
  state: { doc: { sliceString(from: number, to: number): string } },
  node: {
    node: {
      firstChild: {
        name: string;
        from: number;
        to: number;
        nextSibling: typeof node.node.firstChild;
      } | null;
    };
  },
): { info: string; source: string } | undefined {
  let info = "";
  let source = "";

  let child = node.node.firstChild;
  while (child) {
    if (child.name === "CodeInfo") {
      info = state.doc.sliceString(child.from, child.to);
    } else if (child.name === "CodeText") {
      source += state.doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }

  if (!info) return undefined;
  return { info, source };
}

const mermaidFoldExtension = foldableSyntaxFacet.of({
  nodePath: "FencedCode",
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node) => {
    const parsed = parseFencedCode(state, node);
    if (!parsed) return undefined;

    if (!parsed.info.trim().toLowerCase().startsWith("mermaid")) return undefined;

    const body = parsed.source.trim();
    if (!body) return undefined;

    const fenceText = state.doc.sliceString(node.from, node.to);
    const widget = new MermaidWidget(body, fenceText);
    // Always replace the entire fence with the rendered canvas. Editing
    // happens inside the canvas (a nested editor panel), not by exposing
    // the underlying markdown via selection — so there's no preview/edit
    // decoration switch.
    return Decoration.replace({ widget, block: true, inclusiveStart: true }).range(
      node.from,
      node.to,
    );
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
  return [mermaidFoldExtension, foldTreeSync];
}
