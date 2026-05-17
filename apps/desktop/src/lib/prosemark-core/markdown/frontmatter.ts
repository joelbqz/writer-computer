import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import { parseMixed, type Input, type SyntaxNodeRef } from "@lezer/common";
import { parser as yamlParser } from "@lezer/yaml";

const FRONTMATTER_DELIMITER = "---";
const FRONTMATTER_DELIMITER_LENGTH = FRONTMATTER_DELIMITER.length;
export const FRONTMATTER_LANGUAGE_LABEL = "YAML (FRONTMATTER)";

const isFrontmatterDelimiterLine = (line: Line): boolean => {
  if (line.pos !== 0) return false;
  if (
    line.text.slice(line.pos, line.pos + FRONTMATTER_DELIMITER_LENGTH) !== FRONTMATTER_DELIMITER
  ) {
    return false;
  }
  return line.skipSpace(line.pos + FRONTMATTER_DELIMITER_LENGTH) === line.text.length;
};

const hasClosingDelimiterAhead = (cx: BlockContext, afterPos: number): boolean => {
  const input = (cx as unknown as { input?: Input }).input;
  if (!input) return true;
  const rest = input.read(afterPos, input.length);
  return /(?:^|\n)---[ \t]*(?:\n|$)/.test(rest);
};

export const isFrontmatterNode = (node: Pick<SyntaxNodeRef, "name">): boolean =>
  node.name === "Frontmatter";

const frontmatterYamlMixedParser = parseMixed((node) => {
  if (!isFrontmatterNode(node)) return null;
  return {
    parser: yamlParser,
    overlay: (inner) => inner.name === "FrontmatterContent",
  };
});

export const frontmatterMarkdownSyntaxExtension: MarkdownConfig = {
  defineNodes: [
    { name: "Frontmatter", block: true },
    { name: "FrontmatterMark" },
    { name: "FrontmatterContent" },
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse: (cx: BlockContext, line: Line): boolean => {
        if (cx.lineStart !== 0 || !isFrontmatterDelimiterLine(line)) return false;
        if (!hasClosingDelimiterAhead(cx, cx.lineStart + line.text.length + 1)) return false;

        const from = cx.lineStart;
        const openingDelimiterFrom = cx.lineStart + line.pos;
        const openingLineEnd = cx.lineStart + line.text.length;
        const elements = [
          cx.elt(
            "FrontmatterMark",
            openingDelimiterFrom,
            openingDelimiterFrom + FRONTMATTER_DELIMITER_LENGTH,
          ),
        ];

        while (cx.nextLine()) {
          if (!isFrontmatterDelimiterLine(line)) continue;

          const closingDelimiterFrom = cx.lineStart + line.pos;
          const contentFrom = openingLineEnd + 1;
          const contentTo = closingDelimiterFrom - 1;

          if (contentFrom < contentTo) {
            elements.push(cx.elt("FrontmatterContent", contentFrom, contentTo));
          }

          elements.push(
            cx.elt(
              "FrontmatterMark",
              closingDelimiterFrom,
              closingDelimiterFrom + FRONTMATTER_DELIMITER_LENGTH,
            ),
          );

          cx.nextLine();
          cx.addElement(cx.elt("Frontmatter", from, cx.prevLineEnd(), elements));
          return true;
        }

        return false;
      },
    },
  ],
  wrap: frontmatterYamlMixedParser,
};
