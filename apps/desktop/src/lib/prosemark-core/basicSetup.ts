import { keymap, dropCursor, EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { defaultHideExtensions } from "./hide";
import { defaultFoldableSyntaxExtensions } from "./fold";
import { clickLinkExtension, defaultClickLinkHandler } from "./clickLink";
import { codeBlockDecorationsExtension, codeFenceTheme } from "./codeFenceExtension";
import {
  baseSyntaxHighlights,
  baseTheme,
  generalSyntaxHighlights,
  lightTheme,
} from "./syntaxHighlighting";
import { fixedTabWidthExtension } from "./tabWidthExtension";
import { listExtension } from "./list";
import { revealBlockOnArrowExtension } from "./revealBlockOnArrow";
import { prosemarkMarkdownFormattingKeymap } from "./markdownFormattingKeymap";
export { prosemarkMarkdownSyntaxExtensions } from "./markdown";

export const prosemarkBasicSetup = (): Extension => [
  // ProseMark Setup
  defaultHideExtensions,
  defaultFoldableSyntaxExtensions,
  revealBlockOnArrowExtension,
  clickLinkExtension,
  defaultClickLinkHandler,
  listExtension,
  fixedTabWidthExtension,
  codeBlockDecorationsExtension,

  // Basic CodeMirror Setup. `history()` is deliberately absent: the host
  // provides it in its own compartment so undo history can be reset per
  // document without tearing down everything else in this bundle.
  dropCursor(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  keymap.of([
    ...prosemarkMarkdownFormattingKeymap,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
  ]),
  foldGutter(),
  EditorView.lineWrapping,
];

export const prosemarkBaseThemeSetup = (): Extension => [
  baseSyntaxHighlights,
  generalSyntaxHighlights,
  baseTheme,
  codeFenceTheme,
];

export const prosemarkLightThemeSetup = (): Extension => [prosemarkBaseThemeSetup(), lightTheme];
