import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdownTags } from "./markdown/tags";

/** Tags bare URLs with `.cm-url` so the host's click handling can find them. */
export const urlClassExtension = syntaxHighlighting(
  HighlightStyle.define([{ tag: markdownTags.linkURL, class: "cm-url" }]),
);
