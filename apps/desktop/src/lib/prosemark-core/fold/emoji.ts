import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import { markdownTags } from "../markdown/tags";
import { Decoration, WidgetType } from "@codemirror/view";
import { foldableSyntaxFacet } from "./core";
import * as emoji from "node-emoji";

const emojiDelimiter = { resolve: "Emoji", mark: "EmojiMark" };

export const emojiMarkdownSyntaxExtension: MarkdownConfig = {
  defineNodes: [
    {
      name: "Emoji",
      style: markdownTags.emoji,
    },
    {
      name: "EmojiMark",
      style: markdownTags.emojiMark,
    },
  ],
  parseInline: [
    {
      name: "Emoji",
      parse: (cx: InlineContext, next: number, pos: number): number => {
        if (next !== 58 /* : */) return -1;

        const open = /^\w+:/.test(cx.slice(pos + 1, cx.end));
        const close = /:\w+$/.test(cx.slice(cx.offset, pos));

        if (!open && !close) {
          return -1;
        }

        return cx.addDelimiter(emojiDelimiter, pos, pos + 1, open, close);
      },
      before: "Emphasis",
    },
  ],
};

class EmojiWidget extends WidgetType {
  constructor(public emoji: string) {
    super();
  }

  eq(other: EmojiWidget): boolean {
    return this.emoji === other.emoji;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-emoji";
    span.innerHTML = this.emoji;
    return span;
  }
}

export const emojiExtension = foldableSyntaxFacet.of({
  nodePath: "Emoji",
  buildDecorations: (state, node) => {
    const emojiName = state.doc.sliceString(node.from + 1, node.to - 1);
    const emoji_ = emoji.get(emojiName);
    if (!emoji_) {
      return;
    }

    return Decoration.replace({
      widget: new EmojiWidget(emoji_),
    }).range(node.from, node.to);
  },
});
