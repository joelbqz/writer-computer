import { EditorSelection } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { foldExtension, foldableSyntaxFacet } from "@/lib/prosemark-core/main";
import type { BlockParser, BlockContext, Line, MarkdownConfig } from "@lezer/markdown";
import DOMPurify from "dompurify";
import { dragFrozenSelectionField, rangesTouchInclusive } from "./drag-selection-gate";

const ALLOWED_TAGS = [
  "div",
  "p",
  "span",
  "br",
  "hr",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "details",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "code",
  "pre",
  "blockquote",
  "kbd",
  "mark",
  "small",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "figure",
  "figcaption",
  "a",
  "ruby",
  "rt",
  "rp",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "width",
  "height",
  "align",
  "valign",
  "colspan",
  "rowspan",
  "id",
  "class",
  "style",
  "dir",
  "lang",
  "open",
  "controls",
  "autoplay",
  "loop",
  "muted",
  "poster",
  "rel",
  "target",
];

// Defer DOMPurify.addHook to first sanitize call. Running it at module load
// breaks Node-environment tests that load this module transitively — DOMPurify
// needs a DOM and the hook API fails without one.
let sanitizerReady = false;
function ensureSanitizer() {
  if (sanitizerReady) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("rel", "noopener noreferrer nofollow");
      node.setAttribute("target", "_blank");
    }
  });
  sanitizerReady = true;
}

function convertInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function convertMarkdownInHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    if (textNode.parentElement?.closest("pre, code")) continue;
    const original = textNode.textContent ?? "";
    const converted = convertInlineMarkdown(original);
    if (converted !== original) {
      const template = doc.createElement("template");
      template.innerHTML = converted;
      textNode.replaceWith(template.content);
    }
  }

  return doc.body.innerHTML;
}

function sanitizeHTML(html: string): string {
  ensureSanitizer();
  const withMarkdown = convertMarkdownInHtml(html);
  return DOMPurify.sanitize(withMarkdown, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

class HtmlBlockWidget extends WidgetType {
  constructor(
    readonly sanitizedHtml: string,
    readonly rawText: string,
  ) {
    super();
  }

  eq(other: HtmlBlockWidget): boolean {
    return this.rawText === other.rawText;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-html-block-widget";
    wrapper.contentEditable = "false";
    wrapper.innerHTML = this.sanitizedHtml;
    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function isInteractiveHtmlTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest("a,button,input,select,textarea,summary,video,audio,label,[role='button']") !==
      null
  );
}

const htmlBlockFoldExtension = foldableSyntaxFacet.of({
  nodePath: "HTMLBlock",
  // `keepDecorationOnUnfold: true` makes prosemark always delegate the
  // decoration choice to us instead of short-circuiting when the live
  // selection touches the block. Without it, the drag-freeze override below
  // would be bypassed and the block would unfurl mid-drag the moment the
  // extending selection enters the block.
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node, selectionTouchesRange) => {
    const frozen = state.field(dragFrozenSelectionField, false);
    const touches = frozen ? rangesTouchInclusive(frozen, node) : selectionTouchesRange;
    if (touches) return undefined;

    const text = state.doc.sliceString(node.from, node.to);

    const trimmed = text.trimStart();
    if (/^<(?:script|style)[\s>]/i.test(trimmed)) return undefined;

    const sanitized = sanitizeHTML(text);
    if (!sanitized.trim()) return undefined;

    return Decoration.replace({
      widget: new HtmlBlockWidget(sanitized, text),
      block: true,
      inclusiveStart: true,
    }).range(node.from, node.to);
  },
});

const htmlBlockTheme = EditorView.baseTheme({
  ".cm-html-block-widget": {
    padding: "0.25em 0",
    lineHeight: "1.6",
  },
  ".cm-html-block-widget h1, .cm-html-block-widget h2, .cm-html-block-widget h3, .cm-html-block-widget h4, .cm-html-block-widget h5, .cm-html-block-widget h6":
    {
      marginTop: "0.5em",
      marginBottom: "0.25em",
      fontWeight: "600",
      lineHeight: "1.3",
    },
  ".cm-html-block-widget h1": { fontSize: "1.6em" },
  ".cm-html-block-widget h2": { fontSize: "1.4em" },
  ".cm-html-block-widget h3": { fontSize: "1.2em" },
  ".cm-html-block-widget p": { margin: "0.5em 0" },
  ".cm-html-block-widget a": {
    color: "var(--link-color, #4fc1ff)",
    textDecoration: "underline",
  },
  ".cm-html-block-widget img": {
    maxWidth: "100%",
    height: "auto",
  },
  ".cm-html-block-widget table": {
    borderCollapse: "collapse",
    width: "100%",
  },
  ".cm-html-block-widget th, .cm-html-block-widget td": {
    border: "1px solid var(--border-color, #3e3e42)",
    padding: "0.4em 0.8em",
  },
  ".cm-html-block-widget th": {
    fontWeight: "600",
    backgroundColor: "var(--code-bg, #2d2d2d)",
  },
  ".cm-html-block-widget pre": {
    backgroundColor: "var(--code-bg, #2d2d2d)",
    padding: "0.75em 1em",
    borderRadius: "4px",
    overflow: "auto",
  },
  ".cm-html-block-widget code": {
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: "0.9em",
  },
  ".cm-html-block-widget blockquote": {
    borderLeft: "3px solid var(--blockquote-border, #4e4e52)",
    paddingLeft: "1em",
    margin: "0.5em 0",
    color: "var(--text-muted, #858585)",
  },
  ".cm-html-block-widget hr": {
    border: "none",
    borderTop: "1px solid var(--border-color, #3e3e42)",
    margin: "0.75em 0",
  },
  ".cm-html-block-widget ul, .cm-html-block-widget ol": {
    paddingLeft: "1.5em",
    margin: "0.25em 0",
  },
  ".cm-html-block-widget details": {
    border: "1px solid var(--border-color, #3e3e42)",
    borderRadius: "4px",
    padding: "0.5em",
  },
  ".cm-html-block-widget summary": {
    cursor: "pointer",
    fontWeight: "600",
  },
});

const htmlBlockSelectOnMouseDown = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    if (!target.closest(".cm-html-block-widget")) return false;
    if (isInteractiveHtmlTarget(target)) return false;

    const ranges = view.state.selection.ranges;
    if (ranges.length === 0 || ranges[0]?.anchor !== ranges[0]?.head) return false;

    const pos = view.posAtDOM(target);
    view.state.field(foldExtension).between(pos, pos, (from, to) => {
      setTimeout(() => {
        view.dispatch({ selection: EditorSelection.single(to, from) });
      }, 0);
      return false;
    });

    return false;
  },
});

/**
 * Custom block parser that recognizes self-closing HTML tags (e.g. <br/>, <img ... />)
 * as HTML blocks. The Lezer Type 7 regex doesn't handle self-closing syntax.
 */
const selfClosingBlockParser: BlockParser = {
  name: "SelfClosingHTMLBlock",
  before: "HTMLBlock",
  parse(cx: BlockContext, line: Line) {
    if (line.text.charCodeAt(line.pos) !== 60 /* '<' */) return false;
    if (!/^\s*<[a-z][\w-]*(?:\s+[^>]*)?\s*\/\s*>\s*$/i.test(line.text)) return false;
    const from = cx.lineStart + line.pos;
    cx.nextLine();
    cx.addElement(cx.elt("HTMLBlock", from, cx.prevLineEnd()));
    return true;
  },
};

/**
 * Custom block parser for <details> blocks. The default Type 6 parser ends at
 * blank lines, but <details> should consume everything until </details>.
 */
const detailsBlockParser: BlockParser = {
  name: "DetailsHTMLBlock",
  before: "HTMLBlock",
  parse(cx: BlockContext, line: Line) {
    if (!/^\s*<details(?:\s|>|$)/i.test(line.text)) return false;
    const from = cx.lineStart + line.pos;
    const endPattern = /<\/details\s*>/i;
    while (!endPattern.test(line.text) && cx.nextLine()) {
      // continue consuming lines until </details>
    }
    cx.nextLine();
    cx.addElement(cx.elt("HTMLBlock", from, cx.prevLineEnd()));
    return true;
  },
};

export const htmlBlockParserExtension: MarkdownConfig = {
  parseBlock: [detailsBlockParser, selfClosingBlockParser],
};

export function htmlBlockDecorations() {
  return [htmlBlockFoldExtension, htmlBlockTheme, htmlBlockSelectOnMouseDown];
}
