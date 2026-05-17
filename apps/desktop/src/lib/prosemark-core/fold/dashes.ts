import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import { markdownTags } from "../markdown/tags";
import { Decoration, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "./core";

export const dashMarkdownSyntaxExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "Dash",
      style: markdownTags.dash,
    },
  ],
  parseInline: [
    {
      name: "Dash",
      parse: (cx: InlineContext, next: number, pos: number): number => {
        if (next !== 45 /* - */ || (pos > 1 && cx.char(pos - 1) == 45)) return -1;

        let i;
        for (i = pos; i < cx.end && cx.char(i) === 45; i++);
        if (i - pos > 3) return -1;

        return cx.addElement(cx.elt("Dash", pos, i));
      },
      before: "Emphasis",
    },
  ],
};

class DashWidget extends WidgetType {
  constructor(public dashCount: number) {
    super();
  }

  eq(other: DashWidget): boolean {
    return this.dashCount === other.dashCount;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-dash";
    if (this.dashCount === 2) {
      span.innerHTML = "&#8211;"; // en dash
    } else if (this.dashCount === 3) {
      span.innerHTML = "&#8212;"; // em dash
    } else {
      // Not used, just in case something weird happens
      span.innerHTML = "-".repeat(this.dashCount);
    }
    return span;
  }
}

export const dashExtension = foldableSyntaxFacet.of({
  nodePath: "Dash",
  buildDecorations: (_state, node) => {
    const dashCount = node.to - node.from;
    if (dashCount < 2 || dashCount > 3) {
      return;
    }
    return Decoration.replace({
      widget: new DashWidget(dashCount),
    }).range(node.from, node.to);
  },
});
