import { blockQuoteExtension } from "../blockQuote";
import { dashExtension } from "./dashes";
import { emojiExtension } from "./emoji";
import { horizonalRuleExtension } from "./horizontalRule";
import { imageExtension } from "./image";
import { taskExtension } from "./task";

export { foldExtension, foldableSyntaxFacet, selectAllDecorationsOnSelectExtension } from "./core";
export { emojiExtension, emojiMarkdownSyntaxExtension } from "./emoji";
export { dashMarkdownSyntaxExtension, dashExtension } from "./dashes";
export { horizonalRuleExtension } from "./horizontalRule";
export { imageExtension } from "./image";
export { taskExtension } from "./task";
export { blockQuoteExtension } from "../blockQuote";

export const defaultFoldableSyntaxExtensions = [
  blockQuoteExtension,
  taskExtension,
  imageExtension,
  emojiExtension,
  horizonalRuleExtension,
  dashExtension,
];
