import { dashMarkdownSyntaxExtension, emojiMarkdownSyntaxExtension } from "../fold";
import { escapeMarkdownSyntaxExtension } from "../hide";
import { additionalMarkdownSyntaxTags } from "../syntaxHighlighting";
import { frontmatterMarkdownSyntaxExtension } from "./frontmatter";
import { nestedLinkAsPlainText } from "./nestedLinkAsPlainText";
import { mathMarkdownSyntaxExtension } from "./mathMarkdown";
import { spaceDestinationLinksMarkdownSyntaxExtension } from "./spaceDestinationLinks";

export { markdownTags } from "./tags";
export {
  FRONTMATTER_LANGUAGE_LABEL,
  isFrontmatterNode,
  frontmatterMarkdownSyntaxExtension,
} from "./frontmatter";
export { nestedLinkAsPlainText } from "./nestedLinkAsPlainText";
export { escapeMarkdownSyntaxExtension } from "../hide";
export { additionalMarkdownSyntaxTags } from "../syntaxHighlighting";
export { emojiMarkdownSyntaxExtension, dashMarkdownSyntaxExtension } from "../fold";
export { mathDelimiterTag, mathFormulaTag, mathMarkdownSyntaxExtension } from "./mathMarkdown";
export { spaceDestinationLinksMarkdownSyntaxExtension } from "./spaceDestinationLinks";

export const prosemarkMarkdownSyntaxExtensions = [
  additionalMarkdownSyntaxTags,
  frontmatterMarkdownSyntaxExtension,
  spaceDestinationLinksMarkdownSyntaxExtension,
  nestedLinkAsPlainText,
  escapeMarkdownSyntaxExtension,
  emojiMarkdownSyntaxExtension,
  dashMarkdownSyntaxExtension,
  mathMarkdownSyntaxExtension,
];
