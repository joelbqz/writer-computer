import { InlineContext, type MarkdownConfig } from "@lezer/markdown";

interface DestinationRange {
  contentFrom: number;
  contentTo: number;
  closeParen: number;
}

interface TitleSplit {
  urlFrom: number;
  urlTo: number;
  titleFrom?: number;
  titleTo?: number;
}

function isInlineSpace(char: number): boolean {
  return char === 32 || char === 9;
}

function trimInlineSpaceEnd(cx: InlineContext, from: number, to: number): number {
  let end = to;
  while (end > from && isInlineSpace(cx.char(end - 1))) end--;
  return end;
}

function isEscaped(cx: InlineContext, pos: number): boolean {
  let backslashes = 0;
  for (let index = pos - 1; cx.char(index) === 92; index--) backslashes++;
  return backslashes % 2 === 1;
}

function parseDestination(cx: InlineContext, openParen: number): DestinationRange | null {
  if (cx.char(openParen) !== 40) return null;

  const contentFrom = cx.skipSpace(openParen + 1);
  let depth = 0;
  let escaped = false;

  for (let pos = contentFrom; pos < cx.end; pos++) {
    const char = cx.char(pos);
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === 92) {
      escaped = true;
      continue;
    }
    if (char === 10) return null;
    if (char === 40) {
      depth++;
      continue;
    }
    if (char === 41) {
      if (depth === 0) {
        return {
          contentFrom,
          contentTo: trimInlineSpaceEnd(cx, contentFrom, pos),
          closeParen: pos,
        };
      }
      depth--;
    }
  }

  return null;
}

function findOpeningQuote(cx: InlineContext, from: number, to: number, quote: number) {
  for (let pos = to - 2; pos >= from; pos--) {
    if (cx.char(pos) === quote && !isEscaped(cx, pos)) return pos;
  }
  return -1;
}

function findOpeningParenTitle(cx: InlineContext, from: number, to: number) {
  let depth = 0;
  for (let pos = to - 1; pos >= from; pos--) {
    const char = cx.char(pos);
    if (isEscaped(cx, pos)) continue;
    if (char === 41) {
      depth++;
      continue;
    }
    if (char === 40) {
      depth--;
      if (depth === 0) return pos;
    }
  }
  return -1;
}

function splitTrailingTitle(cx: InlineContext, contentFrom: number, contentTo: number): TitleSplit {
  if (contentTo <= contentFrom) return { urlFrom: contentFrom, urlTo: contentTo };

  const last = cx.char(contentTo - 1);
  if ((last === 34 || last === 39) && !isEscaped(cx, contentTo - 1)) {
    const opening = findOpeningQuote(cx, contentFrom, contentTo, last);
    if (opening > contentFrom && isInlineSpace(cx.char(opening - 1))) {
      return {
        urlFrom: contentFrom,
        urlTo: trimInlineSpaceEnd(cx, contentFrom, opening - 1),
        titleFrom: opening,
        titleTo: contentTo,
      };
    }
  }

  if (last === 41 && !isEscaped(cx, contentTo - 1)) {
    const opening = findOpeningParenTitle(cx, contentFrom, contentTo);
    if (opening > contentFrom && isInlineSpace(cx.char(opening - 1))) {
      return {
        urlFrom: contentFrom,
        urlTo: trimInlineSpaceEnd(cx, contentFrom, opening - 1),
        titleFrom: opening,
        titleTo: contentTo,
      };
    }
  }

  return { urlFrom: contentFrom, urlTo: contentTo };
}

function hasDestinationSpace(cx: InlineContext, from: number, to: number): boolean {
  for (let pos = from; pos < to; pos++) {
    const char = cx.char(pos);
    if (isInlineSpace(char)) return true;
  }
  return false;
}

function getOpeningDelimiter(cx: InlineContext) {
  const linkOpening = cx.findOpeningDelimiter(InlineContext.linkStart);
  const imageOpening = cx.findOpeningDelimiter(InlineContext.imageStart);
  const openings = [linkOpening, imageOpening].filter((value): value is number => value !== null);
  if (openings.length === 0) return null;

  const index = Math.max(...openings);
  const delimiter = cx.getDelimiterAt(index);
  if (!delimiter) return null;

  return {
    index,
    from: delimiter.from,
    to: delimiter.to,
    nodeName: delimiter.type === InlineContext.imageStart ? "Image" : "Link",
  };
}

export const spaceDestinationLinksMarkdownSyntaxExtension: MarkdownConfig = {
  parseInline: [
    {
      name: "SpaceDestinationLinkEnd",
      before: "LinkEnd",
      parse(cx, next, closeBracket) {
        if (next !== 93) return -1;

        const opening = getOpeningDelimiter(cx);
        if (!opening) return -1;

        const openParen = closeBracket + 1;
        if (cx.char(openParen) !== 40) return -1;

        const destination = parseDestination(cx, openParen);
        if (!destination) return -1;

        const split = splitTrailingTitle(cx, destination.contentFrom, destination.contentTo);
        if (!hasDestinationSpace(cx, split.urlFrom, split.urlTo)) return -1;

        const content = cx.takeContent(opening.index);
        content.unshift(cx.elt("LinkMark", opening.from, opening.to));
        content.push(
          cx.elt("LinkMark", closeBracket, closeBracket + 1),
          cx.elt("LinkMark", openParen, openParen + 1),
          cx.elt("URL", split.urlFrom, split.urlTo),
        );
        if (split.titleFrom !== undefined && split.titleTo !== undefined) {
          content.push(cx.elt("LinkTitle", split.titleFrom, split.titleTo));
        }
        content.push(cx.elt("LinkMark", destination.closeParen, destination.closeParen + 1));

        return cx.addElement(
          cx.elt(opening.nodeName, opening.from, destination.closeParen + 1, content),
        );
      },
    },
  ],
};
