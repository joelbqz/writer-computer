import type { InlineContext, MarkdownConfig } from "@lezer/markdown";
import { styleTags, Tag } from "@lezer/highlight";

/** Highlight tag for `$` / `$$` math delimiters. */
export const mathDelimiterTag = Tag.define();

/** Highlight tag for raw math source between delimiters. */
export const mathFormulaTag = Tag.define();

const isEscapedDollar = (cx: InlineContext, pos: number): boolean => {
  let backslashes = 0;
  for (let p = pos - 1; p >= cx.offset; p--) {
    if (cx.char(p) !== 92 /* \ */) break;
    backslashes++;
  }
  return backslashes % 2 === 1;
};

const findClosingDoubleDollar = (cx: InlineContext, from: number): number => {
  for (let pos = from; pos < cx.end - 1; pos++) {
    if (cx.char(pos) === 36 /* $ */ && cx.char(pos + 1) === 36 /* $ */) {
      if (!isEscapedDollar(cx, pos)) return pos;
    }
  }
  return -1;
};

const findClosingSingleDollar = (cx: InlineContext, from: number): number => {
  for (let pos = from; pos < cx.end; pos++) {
    if (cx.char(pos) !== 36 /* $ */) continue;
    if (isEscapedDollar(cx, pos)) continue;
    return pos;
  }
  return -1;
};

/**
 * `$...$` and `$$...$$` math delimiters (TeX-style). A literal dollar is `\$`.
 *
 * The outer node is **`Math`** so the same tree can be used with LaTeX (MathJax),
 * Typst, or other renderers in `@prosemark/*` packages.
 */
export const mathMarkdownSyntaxExtension: MarkdownConfig = {
  defineNodes: [{ name: "Math" }, { name: "MathMark" }, { name: "MathFormula" }],
  props: [
    styleTags({
      MathMark: mathDelimiterTag,
      MathFormula: mathFormulaTag,
    }),
  ],
  parseInline: [
    {
      name: "Math",
      parse: (cx: InlineContext, next: number, pos: number): number => {
        if (next !== 36 /* $ */) return -1;
        if (isEscapedDollar(cx, pos)) return -1;

        const display = pos + 1 < cx.end && cx.char(pos + 1) === 36; /* $ */
        const contentFrom = display ? pos + 2 : pos + 1;
        const closePos = display
          ? findClosingDoubleDollar(cx, contentFrom)
          : findClosingSingleDollar(cx, contentFrom);
        if (closePos < 0) return -1;

        const contentTo = closePos;
        const outerTo = display ? closePos + 2 : closePos + 1;

        const openEnd = display ? pos + 2 : pos + 1;
        return cx.addElement(
          cx.elt("Math", pos, outerTo, [
            cx.elt("MathMark", pos, openEnd),
            cx.elt("MathFormula", contentFrom, contentTo),
            cx.elt("MathMark", contentTo, outerTo),
          ]),
        );
      },
      before: "Escape",
    },
  ],
};
