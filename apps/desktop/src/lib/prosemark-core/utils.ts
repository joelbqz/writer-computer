import {
  CharCategory,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  findClusterBreak,
} from "@codemirror/state";
import {
  type Decoration,
  type DOMEventHandlers,
  type DOMEventMap,
  type EditorView,
  type WidgetType,
} from "@codemirror/view";
import type { TreeCursor } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";

/** True when the committed syntax tree advanced between two states. Tree-derived
 *  decorations (StateFields and ViewPlugins alike) must rebuild on this, not
 *  only on `docChanged` / `viewportChanged`: `forceParsing`'s parse-commit
 *  transaction changes neither, so without this guard a region scrolled into
 *  before its parse landed keeps its stale decorations until the next edit or
 *  scroll. See docs/editor.md. */
export function treeChanged(update: { state: EditorState; startState: EditorState }): boolean {
  return syntaxTree(update.state) !== syntaxTree(update.startState);
}

function isWidgetType(value: unknown): value is WidgetType {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDOM" in value &&
    typeof value.toDOM === "function"
  );
}

/** True when this is a replace decoration that shows a widget (not hide-only replace). */
export function decorationHasReplaceWidget(deco: Decoration): boolean {
  return isWidgetType((deco.spec as { widget?: unknown }).widget);
}

/* This is a reference to vim's WORD: a "word" including any non-whitespace character */
export function stateWORDAt(state: EditorState, pos: number): SelectionRange | null {
  const { text, from, length } = state.doc.lineAt(pos);
  const cat = state.charCategorizer(pos);
  let start = pos - from,
    end = pos - from;
  while (start > 0) {
    const prev = findClusterBreak(text, start, false);
    if (cat(text.slice(prev, start)) === CharCategory.Space) break;
    start = prev;
  }
  while (end < length) {
    const next = findClusterBreak(text, end);
    if (cat(text.slice(end, next)) === CharCategory.Space) break;
    end = next;
  }
  return start == end ? null : EditorSelection.range(start + from, end + from);
}

export interface RangeLike {
  from: number;
  to: number;
}

export function rangeTouchesRange(a: RangeLike, b: RangeLike): boolean {
  return a.from <= b.to && b.from <= a.to;
}

export function selectionTouchesRange(selection: readonly SelectionRange[], b: RangeLike): boolean {
  return selection.some((range) => rangeTouchesRange(range, b));
}

// function rangeSetIncludes<V extends RangeValue>(
//   from: number,
//   to: number,
//   set: RangeSet<V>,
// ) {
//   let touches = false;
//   set.between(from, to, () => {
//     touches = true;
//     return false;
//   });
//   return touches;
// }

export function iterChildren(
  cursor: TreeCursor,
  enter: (cursor: TreeCursor) => undefined | boolean,
): void {
  if (!cursor.firstChild()) return;
  do {
    if (enter(cursor)) break;
  } while (cursor.nextSibling());
  console.assert(cursor.parent());
}

export type ClassBasedEventHandlers<This> = {
  [event in keyof DOMEventMap]?: Record<string, DOMEventHandlers<This>[event]>;
};

export function eventHandlersWithClass<This>(
  handlers: ClassBasedEventHandlers<This>,
): DOMEventHandlers<This> {
  return Object.fromEntries(
    Object.entries(handlers).reduce<
      [string, (this: This, ev: Event, view: EditorView) => boolean][]
    >((acc, [event, handlers]) => {
      if (!handlers) return acc;
      acc.push([
        event,
        function (this: This, ev: Event, view: EditorView) {
          const res = [];
          for (const className in handlers) {
            if (
              ev.composedPath().some((el) => {
                if (!(el instanceof Element)) return false;

                return el.classList.contains(className);
              })
            ) {
              const handler = handlers[
                className
              ] as DOMEventHandlers<This>[keyof DOMEventHandlers<This>];
              if (handler) {
                res.push(handler.call(this, ev as DOMEventMap[keyof DOMEventMap], view));
              }
            }
          }
          return res.some((res) => !!res);
        },
      ]);
      return acc;
    }, []),
  );
}
