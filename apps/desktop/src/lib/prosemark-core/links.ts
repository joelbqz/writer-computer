import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { normalizeMarkdownDestination } from "@/lib/paths";

/** Destination of the markdown `Link` node covering `pos`, normalised, or
 *  `undefined` when `pos` isn't inside a link. */
export function linkUrlAt(state: EditorState, pos: number): string | undefined {
  let url: string | undefined;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(node) {
      if (node.name !== "Link") return;
      const target = node.node.getChild("URL");
      if (target) url = normalizeMarkdownDestination(state.doc.sliceString(target.from, target.to));
      return false;
    },
  });
  return url;
}

/** A bare `URL` node (autolink / raw URL) covering `pos`, normalised, or
 *  `undefined`. URLs that belong to a `Link` are excluded; use `linkUrlAt`. */
export function rawUrlAt(state: EditorState, pos: number): string | undefined {
  let url: string | undefined;
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter(node) {
      if (node.name !== "URL") return;
      if (node.node.parent?.name === "Link") return false;
      url = normalizeMarkdownDestination(state.doc.sliceString(node.from, node.to));
      return false;
    },
  });
  return url;
}
