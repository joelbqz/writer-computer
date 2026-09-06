import { keymap, dropCursor, EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultHideExtensions } from "./hide";
import { defaultFoldableSyntaxExtensions } from "./fold";
import { urlClassExtension } from "./urlClass";
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
export { prosemarkMarkdownSyntaxExtensions } from "./markdown";

// What the host is expected to add on top: `history()` (in its own
// compartment so it can be reset per document), link click handling, search
// (Writer runs its own overlay; the panel-based `searchKeymap` is not used),
// autocompletion sources, and the markdown formatting keymap. Code-editor
// defaults that make no sense for prose (fold gutter, bracket matching,
// indent-on-input, lint) are deliberately absent.
export const prosemarkBasicSetup = (): Extension => [
  // ProseMark Setup
  defaultHideExtensions,
  defaultFoldableSyntaxExtensions,
  revealBlockOnArrowExtension,
  urlClassExtension,
  listExtension,
  fixedTabWidthExtension,
  codeBlockDecorationsExtension,

  // Basic CodeMirror Setup
  dropCursor(),
  closeBrackets(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    // Multi-cursor selection helpers from @codemirror/search, without the
    // rest of `searchKeymap` (whose Escape/Mod-f bindings assume its panel).
    { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
    { key: "Mod-Shift-l", run: selectSelectionMatches },
    indentWithTab,
  ]),
  EditorView.lineWrapping,
];

export const prosemarkBaseThemeSetup = (): Extension => [
  baseSyntaxHighlights,
  generalSyntaxHighlights,
  baseTheme,
  codeFenceTheme,
];

export const prosemarkLightThemeSetup = (): Extension => [prosemarkBaseThemeSetup(), lightTheme];
