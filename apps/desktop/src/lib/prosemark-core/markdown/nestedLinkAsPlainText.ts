import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

function parseBracketedSegment(cx: InlineContext, start: number): number {
  if (cx.char(start) !== 91 /* [ */) return -1;

  let depth = 0;
  for (let pos = start + 1; pos < cx.end; pos++) {
    const next = cx.char(pos);

    if (next === 92 /* \\ */) {
      pos++;
      continue;
    }

    if (next === 91 /* [ */) {
      depth++;
      continue;
    }

    if (next === 93 /* ] */) {
      if (depth === 0) {
        return pos + 1;
      }
      depth--;
    }
  }

  return -1;
}

function parseParenthesizedSegment(cx: InlineContext, start: number): number {
  if (cx.char(start) !== 40 /* ( */) return -1;

  let depth = 1;
  for (let pos = start + 1; pos < cx.end; pos++) {
    const next = cx.char(pos);

    if (next === 92 /* \\ */) {
      pos++;
      continue;
    }

    if (next === 40 /* ( */) {
      depth++;
      continue;
    }

    if (next === 41 /* ) */) {
      depth--;
      if (depth === 0) {
        return pos + 1;
      }
    }
  }

  return -1;
}

export const nestedLinkAsPlainText: MarkdownConfig = {
  parseInline: [
    {
      name: "NestedLinkAsPlainText",
      before: "Link",
      parse: (cx: InlineContext, next: number, pos: number): number => {
        if (next !== 91 /* [ */ || !cx.hasOpenLink) return -1;

        const labelEnd = parseBracketedSegment(cx, pos);
        if (labelEnd === -1) {
          return pos + 1;
        }

        const afterLabel = cx.char(labelEnd);
        if (afterLabel === 40 /* ( */) {
          const destinationEnd = parseParenthesizedSegment(cx, labelEnd);
          return destinationEnd === -1 ? labelEnd : destinationEnd;
        }

        if (afterLabel === 91 /* [ */) {
          const referenceEnd = parseBracketedSegment(cx, labelEnd);
          return referenceEnd === -1 ? labelEnd : referenceEnd;
        }

        return labelEnd;
      },
    },
  ],
};
