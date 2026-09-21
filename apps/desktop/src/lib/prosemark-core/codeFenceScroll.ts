import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  type EditorView,
  layer,
  type LayerMarker,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isFrontmatterNode } from "./markdown/frontmatter";

/**
 * Horizontal scrolling for fenced code blocks.
 *
 * Code lines don't wrap (`white-space: pre`, see `codeFenceTheme`), so a long
 * line overflows its `.cm-line` box and is clipped. The whole block scrolls
 * together through one offset per block, stored here by the block's start
 * position and rendered by `codeFenceExtension` as a `text-indent: -<offset>px`
 * line decoration on every line of the block.
 *
 * The lines are deliberately NOT scroll containers (`overflow-x: clip`, not
 * `auto`/`hidden`). CodeMirror's drawn caret and selection live in layers
 * outside the lines, so a line scrolling natively would leave them stale, and
 * CodeMirror's own scroll-into-view would scroll individual lines out of sync.
 * Going through a transaction instead means the decoration rebuild redraws the
 * layers, and the caret is revealed by the same offset the wheel moves. For the
 * same reason there is no native scrollbar: an overflowing block gets a thumb
 * drawn in its own layer along its bottom edge, dragged through the same effect.
 */

export type CodeBlockScroll = { from: number; offset: number };

export const setCodeBlockScroll = StateEffect.define<CodeBlockScroll>({
  map: (value, mapping) => ({ ...value, from: mapping.mapPos(value.from, 1) }),
});

export const CODE_LINE_CLASS = "cm-fenced-code-line";
export const CODE_LINE_FIRST_CLASS = "cm-fenced-code-line-first";
export const CODE_LINE_LAST_CLASS = "cm-fenced-code-line-last";
export const SCROLLBAR_THUMB_CLASS = "cm-code-scrollbar-thumb";
const SCROLLBAR_DRAGGING_CLASS = "cm-code-scrollbar-dragging";

/** Scrollbar thumb thickness, its gap from the block's bottom edge, and the
 *  shortest it gets on a very wide block. */
const THUMB_HEIGHT = 6;
const THUMB_INSET = 3;
const MIN_THUMB_WIDTH = 24;

/** Pixels per notch when a wheel reports line-based deltas (mice, not trackpads). */
const LINE_DELTA_PX = 16;

const isCodeBlockNode = (node: { name: string }): boolean =>
  node.name === "FencedCode" || isFrontmatterNode(node);

/** The fenced code (or frontmatter) block containing `pos`, if any. Tries the
 *  node ending at `pos` first so the caret after a closing fence still counts
 *  as inside the block. */
export function codeBlockAt(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(pos, side);
    while (node && !isCodeBlockNode(node)) node = node.parent;
    if (node) return node;
  }
  return null;
}

/** Offsets keyed by block start position. Entries are remapped through edits
 *  and dropped once their position no longer starts a code block. */
export const codeBlockScrollField = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update(offsets, tr) {
    let next: Map<number, number> | null = null;

    if (tr.docChanged && offsets.size > 0) {
      next = new Map();
      for (const [from, offset] of offsets) {
        const mapped = tr.changes.mapPos(from, 1);
        const block = codeBlockAt(tr.state, mapped);
        if (block && block.from === mapped) next.set(mapped, offset);
      }
    }

    for (const effect of tr.effects) {
      if (!effect.is(setCodeBlockScroll)) continue;
      const { from, offset } = effect.value;
      const current = (next ?? offsets).get(from) ?? 0;
      if (offset === current) continue;
      next ??= new Map(offsets);
      if (offset > 0) next.set(from, offset);
      else next.delete(from);
    }

    return next ?? offsets;
  },
});

export function clampOffset(offset: number, max: number): number {
  return Math.min(Math.max(0, Math.round(offset)), Math.max(0, max));
}

/** The smallest move of `offset` that brings `caretX` inside `[left, right]`. */
export function revealOffset(offset: number, caretX: number, left: number, right: number): number {
  if (caretX < left) return offset - (left - caretX);
  if (caretX > right) return offset + (caretX - right);
  return offset;
}

/** Thumb placement for a block scrolled by `offset` out of `max`, on a track
 *  as wide as the block's visible width. The thumb's share of the track is the
 *  visible share of the content; `perPixel` is how far the offset moves per
 *  pixel the thumb is dragged. */
export function thumbGeometry(
  offset: number,
  max: number,
  trackWidth: number,
): { left: number; width: number; perPixel: number } {
  const width = Math.min(
    trackWidth,
    Math.max(MIN_THUMB_WIDTH, (trackWidth * trackWidth) / (trackWidth + max)),
  );
  const travel = trackWidth - width;
  return {
    left: travel > 0 ? (travel * clampOffset(offset, max)) / max : 0,
    width,
    perPixel: travel > 0 ? max / travel : 0,
  };
}

export function wheelDeltaX(
  event: Pick<WheelEvent, "deltaX" | "deltaMode">,
  visibleWidth: number,
): number {
  switch (event.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return event.deltaX * LINE_DELTA_PX;
    case 2: // DOM_DELTA_PAGE
      return event.deltaX * visibleWidth;
    default:
      return event.deltaX;
  }
}

/** The rendered `.cm-line` elements of the block `line` belongs to. Lines are
 *  siblings under `.cm-content`; the walk stops at the block's first/last
 *  markers, at a non-code sibling, and at viewport gaps. */
function blockLineElements(line: Element): Element[] {
  const lines = [line];
  for (let el = line; !el.classList.contains(CODE_LINE_FIRST_CLASS); ) {
    const prev = el.previousElementSibling;
    if (!prev?.classList.contains(CODE_LINE_CLASS)) break;
    lines.push(prev);
    el = prev;
  }
  for (let el = line; !el.classList.contains(CODE_LINE_LAST_CLASS); ) {
    const next = el.nextElementSibling;
    if (!next?.classList.contains(CODE_LINE_CLASS)) break;
    lines.push(next);
    el = next;
  }
  return lines;
}

/** Width of a line's inline content, independent of the text-indent it is
 *  currently rendered with. */
function contentWidth(line: Element): number {
  const range = line.ownerDocument.createRange();
  range.selectNodeContents(line);
  return range.getBoundingClientRect().width;
}

/** Screen x-range of a line's content box (inside its padding). */
function lineBox(line: Element): { left: number; right: number } {
  const rect = line.getBoundingClientRect();
  const style = getComputedStyle(line);
  return {
    left: rect.left + parseFloat(style.paddingLeft),
    right: rect.right - parseFloat(style.paddingRight),
  };
}

/** How far the block containing `line` can scroll: its widest rendered line
 *  minus the visible width. Lines outside the rendered viewport are unknown;
 *  the bound grows once they render. */
function maxScrollOffset(line: Element, box = lineBox(line)): number {
  let widest = 0;
  for (const el of blockLineElements(line)) widest = Math.max(widest, contentWidth(el));
  return Math.ceil(widest - (box.right - box.left));
}

function lineElementAt(view: EditorView, pos: number): Element | null {
  const { node } = view.domAtPos(pos);
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest(`.${CODE_LINE_CLASS}`) ?? null;
}

/** Read phase: the offsets that need to change so the caret is visible in its
 *  block and no visible block is scrolled past its content (after a resize). */
function measureScrollTargets(view: EditorView): CodeBlockScroll[] {
  const offsets = view.state.field(codeBlockScrollField);
  const targets: CodeBlockScroll[] = [];
  const handled = new Set<number>();

  const head = view.state.selection.main.head;
  const headBlock = codeBlockAt(view.state, head);
  if (headBlock) {
    const line = lineElementAt(view, head);
    const coords = view.coordsAtPos(head);
    if (line && coords) {
      handled.add(headBlock.from);
      const box = lineBox(line);
      const offset = offsets.get(headBlock.from) ?? 0;
      const wanted = clampOffset(
        revealOffset(offset, coords.left, box.left, box.right),
        maxScrollOffset(line),
      );
      if (wanted !== offset) targets.push({ from: headBlock.from, offset: wanted });
    }
  }

  if (offsets.size > handled.size) {
    const { from: viewFrom, to: viewTo } = view.viewport;
    for (const [from, offset] of offsets) {
      if (handled.has(from)) continue;
      const block = codeBlockAt(view.state, from);
      if (!block || block.from !== from || block.to < viewFrom || block.from > viewTo) continue;
      const line = lineElementAt(view, Math.max(from, viewFrom));
      if (!line) continue;
      const max = maxScrollOffset(line);
      if (offset > max) targets.push({ from, offset: clampOffset(offset, max) });
    }
  }

  return targets;
}

function handleWheel(event: WheelEvent, view: EditorView): boolean {
  // Vertical (and axis-locked diagonal) gestures keep scrolling the page.
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return false;
  if (!(event.target instanceof Element)) return false;
  const line = event.target.closest(`.${CODE_LINE_CLASS}`);
  if (!line || !view.contentDOM.contains(line)) return false;
  const block = codeBlockAt(view.state, view.posAtDOM(line));
  if (!block) return false;

  const box = lineBox(line);
  const offset = view.state.field(codeBlockScrollField).get(block.from) ?? 0;
  const next = clampOffset(
    offset + wheelDeltaX(event, box.right - box.left),
    maxScrollOffset(line),
  );
  if (next === offset) return false;
  view.dispatch({ effects: setCodeBlockScroll.of({ from: block.from, offset: next }) });
  return true;
}

class ScrollbarThumb implements LayerMarker {
  constructor(
    readonly from: number,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly max: number,
    readonly perPixel: number,
  ) {}

  draw(): HTMLElement {
    const el = document.createElement("div");
    el.className = SCROLLBAR_THUMB_CLASS;
    this.apply(el);
    return el;
  }

  update(el: HTMLElement): boolean {
    this.apply(el);
    return true;
  }

  eq(other: ScrollbarThumb): boolean {
    return (
      this.from === other.from &&
      this.left === other.left &&
      this.top === other.top &&
      this.width === other.width &&
      this.max === other.max &&
      this.perPixel === other.perPixel
    );
  }

  private apply(el: HTMLElement) {
    el.style.left = `${this.left}px`;
    el.style.top = `${this.top}px`;
    el.style.width = `${this.width}px`;
    el.style.height = `${THUMB_HEIGHT}px`;
    el.dataset.from = String(this.from);
    el.dataset.max = String(this.max);
    el.dataset.perPixel = String(this.perPixel);
  }
}

/** Read phase: one thumb per overflowing block whose closing line is rendered,
 *  laid along that line's content box, just above its bottom edge. */
function scrollbarMarkers(view: EditorView): ScrollbarThumb[] {
  const offsets = view.state.field(codeBlockScrollField);
  const scroller = view.scrollDOM.getBoundingClientRect();
  const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
  const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
  const thumbs: ScrollbarThumb[] = [];
  const seen = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (!isCodeBlockNode(node)) return;
        if (seen.has(node.from) || node.to > view.viewport.to) return false;
        seen.add(node.from);
        const last = lineElementAt(view, node.to);
        if (!last?.classList.contains(CODE_LINE_LAST_CLASS)) return false;

        const box = lineBox(last);
        const max = maxScrollOffset(last, box);
        if (max <= 0) return false;
        const trackWidth = box.right - box.left;
        const thumb = thumbGeometry(offsets.get(node.from) ?? 0, max, trackWidth);
        thumbs.push(
          new ScrollbarThumb(
            node.from,
            box.left + thumb.left - baseLeft,
            last.getBoundingClientRect().bottom - THUMB_INSET - THUMB_HEIGHT - baseTop,
            thumb.width,
            max,
            thumb.perPixel,
          ),
        );
        return false;
      },
    });
  }

  return thumbs;
}

/** Drags a thumb. Moves are tracked on the window for the length of the drag
 *  (so the thumb keeps following the pointer outside it, and a redraw that
 *  replaces thumb elements doesn't end the drag), dispatching the block's
 *  offset as the pointer moves. */
function mountScrollbarDrag(dom: HTMLElement, view: EditorView) {
  dom.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !(event.target instanceof HTMLElement)) return;
    const thumb = event.target.closest<HTMLElement>(`.${SCROLLBAR_THUMB_CLASS}`);
    if (!thumb) return;
    event.preventDefault();

    const from = Number(thumb.dataset.from);
    const max = Number(thumb.dataset.max);
    const perPixel = Number(thumb.dataset.perPixel);
    const startX = event.clientX;
    const startOffset = view.state.field(codeBlockScrollField).get(from) ?? 0;
    const win = dom.ownerDocument.defaultView ?? window;

    const move = (moveEvent: MouseEvent) => {
      const next = clampOffset(startOffset + (moveEvent.clientX - startX) * perPixel, max);
      if (next === (view.state.field(codeBlockScrollField).get(from) ?? 0)) return;
      view.dispatch({ effects: setCodeBlockScroll.of({ from, offset: next }) });
    };
    const up = () => {
      thumb.classList.remove(SCROLLBAR_DRAGGING_CLASS);
      win.removeEventListener("mousemove", move);
      win.removeEventListener("mouseup", up);
    };
    thumb.classList.add(SCROLLBAR_DRAGGING_CLASS);
    win.addEventListener("mousemove", move);
    win.addEventListener("mouseup", up);
  });
}

const codeBlockScrollbarLayer = layer({
  above: true,
  class: "cm-code-scrollbar-layer",
  markers: scrollbarMarkers,
  update: (update) =>
    update.docChanged ||
    update.viewportChanged ||
    update.state.field(codeBlockScrollField) !== update.startState.field(codeBlockScrollField),
  mount: mountScrollbarDrag,
});

const codeBlockScrollPlugin = ViewPlugin.fromClass(
  class {
    private destroyed = false;
    private pending: ReturnType<typeof setTimeout> | null = null;
    private targets: CodeBlockScroll[] = [];
    private readonly measure = {
      key: this,
      read: measureScrollTargets,
      write: (targets: CodeBlockScroll[], view: EditorView) => {
        if (targets.length === 0) return;
        this.targets = targets;
        // Measure writes run inside CodeMirror's update cycle, where
        // dispatching is illegal; defer to the next macrotask.
        this.pending ??= setTimeout(() => {
          this.pending = null;
          if (this.destroyed) return;
          view.dispatch({ effects: this.targets.map((t) => setCodeBlockScroll.of(t)) });
        }, 0);
      },
    };

    update(update: ViewUpdate) {
      if (update.selectionSet || update.geometryChanged) {
        update.view.requestMeasure(this.measure);
      }
    }

    destroy() {
      this.destroyed = true;
      if (this.pending !== null) clearTimeout(this.pending);
    }
  },
  { eventHandlers: { wheel: handleWheel } },
);

export const codeBlockScrollExtension = [
  codeBlockScrollField,
  codeBlockScrollPlugin,
  codeBlockScrollbarLayer,
];
