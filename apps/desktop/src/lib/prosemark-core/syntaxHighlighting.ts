import { EditorView } from "@codemirror/view";
import { styleTags, Tag, tags } from "@lezer/highlight";
import { markdownTags } from "./markdown/tags";
import { HighlightStyle, syntaxHighlighting, type TagStyle } from "@codemirror/language";
import type { MarkdownConfig } from "@lezer/markdown";

const fallbackMonospaceCodeFont =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const codeFontFamily = `var(--pm-code-font, ${fallbackMonospaceCodeFont})`;

export const additionalMarkdownSyntaxTags: MarkdownConfig = {
  // Define new nodes with tags here
  defineNodes: [],
  props: [
    // Override tags here
    styleTags({
      HeaderMark: markdownTags.headerMark,
      FencedCode: markdownTags.fencedCode,
      URL: markdownTags.linkURL,
      ListMark: markdownTags.listMark,
    }),
  ],
};

const headingTagStyles = (fontSizes: (string | null)[]): TagStyle[] =>
  fontSizes.map((fontSize, i) => ({
    tag: tags[`heading${(i + 1).toString()}` as keyof typeof tags] as Tag,
    fontSize,
    fontWeight: "bold",
  }));

export const baseSyntaxHighlights = syntaxHighlighting(
  HighlightStyle.define([
    ...headingTagStyles(["1.6em", "1.4em", "1.2em", null, null, null]),
    {
      tag: markdownTags.headerMark,
      color: "var(--pm-header-mark-color)",
    },
    {
      tag: tags.strong,
      fontWeight: "bold",
    },
    {
      tag: tags.emphasis,
      fontStyle: "italic",
    },
    {
      tag: tags.strikethrough,
      textDecoration: "line-through",
    },
    {
      tag: tags.meta,
      color: "var(--pm-muted-color)",
    },
    {
      tag: tags.comment,
      color: "var(--pm-muted-color)",
    },
    {
      tag: markdownTags.listMark,
      color: "var(--pm-muted-color)",
    },
    {
      tag: markdownTags.escapeMark,
      color: "var(--pm-muted-color)",
    },
    {
      tag: markdownTags.linkURL,
      color: "var(--pm-link-color)",
      textDecoration: "underline",
      cursor: "pointer",
    },
  ]),
);

export const baseTheme = EditorView.theme({
  ".cm-content": {
    fontFamily: "var(--font)",
    fontSize: "0.9rem",
    caretColor: "var(--pm-cursor-color)",
  },
  ".cm-editor .cm-cursor, .cm-editor .cm-dropCursor": {
    borderLeftColor: "var(--pm-cursor-color)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
  },
  ".cm-rendered-link": {
    textDecoration: "underline",
    cursor: "pointer",
    color: "var(--pm-link-color)",
  },
  ".cm-rendered-list-mark": {
    color: "var(--pm-muted-color)",
    margin: "0 0.2em",
  },
  ".cm-blockquote-line": {
    position: "relative",
    "&:before": {
      content: '""',
      display: "block",
      borderLeft: "solid 0.3em var(--pm-blockquote-vertical-line-background-color)",
      position: "absolute",
      top: "0px",
      bottom: "0px",
      insetInlineStart: "6px",
      zIndex: -10,
    },
  },
  ".cm-nested-blockquote-border": {
    display: "block",
    borderLeft: "solid 0.3em var(--pm-blockquote-vertical-line-background-color)",
    position: "absolute",
    top: "0px",
    bottom: "0px",
    insetInlineStart: "calc(6px + var(--blockquote-border-offset))",
    zIndex: -10,
  },
  ".cm-image-block": {
    paddingLeft: "6px",
  },
  ".cm-inline-code": {
    fontFamily: codeFontFamily,
    fontVariantLigatures: "none",
    fontFeatureSettings: '"calt" 0',
    fontKerning: "none",
    padding: "0.2rem",
    borderRadius: "0.4rem",
    fontSize: "0.8rem",
    backgroundColor: "var(--pm-code-background-color)",
  },
});

export const generalSyntaxHighlights = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: tags.link,
      color: "var(--pm-syntax-link)",
    },
    {
      tag: tags.keyword,
      color: "var(--pm-syntax-keyword)",
    },
    {
      tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
      color: "var(--pm-syntax-atom)",
    },
    {
      tag: [tags.literal, tags.inserted],
      color: "var(--pm-syntax-literal)",
    },
    {
      tag: [tags.string, tags.deleted],
      color: "var(--pm-syntax-string)",
    },
    {
      tag: [tags.regexp, tags.escape, tags.special(tags.string)],
      color: "var(--pm-syntax-regexp)",
    },
    {
      tag: tags.definition(tags.variableName),
      color: "var(--pm-syntax-definition-variable)",
    },
    {
      tag: tags.local(tags.variableName),
      color: "var(--pm-syntax-local-variable)",
    },
    {
      tag: [tags.typeName, tags.namespace],
      color: "var(--pm-syntax-type-namespace)",
    },
    {
      tag: tags.className,
      color: "var(--pm-syntax-class-name)",
    },
    {
      tag: [tags.special(tags.variableName), tags.macroName],
      color: "var(--pm-syntax-special-variable-macro)",
    },
    {
      tag: tags.definition(tags.propertyName),
      color: "var(--pm-syntax-definition-property)",
    },
    {
      tag: tags.comment,
      color: "var(--pm-syntax-comment)",
    },
    {
      tag: tags.invalid,
      color: "var(--pm-syntax-invalid)",
    },
  ]),
);

export const lightTheme = EditorView.theme({
  ".cm-content": {
    "--pm-cursor-color": "black",
    "--pm-header-mark-color": "oklch(82.8% 0.111 230.318)",
    "--pm-link-color": "oklch(58.8% 0.158 241.966)",
    "--pm-muted-color": "oklch(37.2% 0.044 257.287)",
    "--pm-code-background-color": "oklch(92.9% 0.013 255.508)",
    "--pm-code-btn-background-color": "oklch(86.9% 0.022 252.894)",
    "--pm-code-btn-hover-background-color": "oklch(70.4% 0.04 256.788)",
    "--pm-blockquote-vertical-line-background-color": "oklch(70.4% 0.04 256.788)",
    "--pm-syntax-link": "oklch(62.75% 0.188 259.38)",
    "--pm-syntax-keyword": "oklch(58.13% 0.248 297.57)",
    "--pm-syntax-atom": "oklch(51.29% 0.219 260.63)",
    "--pm-syntax-literal": "oklch(57.38% 0.111 170.31)",
    "--pm-syntax-string": "oklch(54.86% 0.184 25.53)",
    "--pm-syntax-regexp": "oklch(65.88% 0.184 43.8)",
    "--pm-syntax-definition-variable": "oklch(45.32% 0.171 260.3)",
    "--pm-syntax-local-variable": "oklch(64.13% 0.09 184.42)",
    "--pm-syntax-type-namespace": "oklch(49.1% 0.091 165.52)",
    "--pm-syntax-class-name": "oklch(64.42% 0.11 168.83)",
    "--pm-syntax-special-variable-macro": "oklch(52.58% 0.212 282.71)",
    "--pm-syntax-definition-property": "oklch(42.1% 0.142 260.08)",
    "--pm-syntax-comment": "oklch(62.79% 0.022 252.89)",
    "--pm-syntax-invalid": "oklch(64.62% 0.203 29.2)",
  },
});
