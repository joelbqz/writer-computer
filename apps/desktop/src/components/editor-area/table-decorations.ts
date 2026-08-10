import { type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import {
  GFM,
  parser as markdownParser,
  type InlineContext,
  type MarkdownConfig,
} from "@lezer/markdown";
import * as emoji from "node-emoji";
import {
  foldableSyntaxFacet,
  prosemarkMarkdownSyntaxExtensions,
  selectAllDecorationsOnSelectExtension,
} from "@/lib/prosemark-core/main";
import { SETTINGS_SCHEMA } from "@/lib/settings-schema";
import { parseWikiLink } from "@/lib/wiki-links";

const fallbackMonospaceCodeFont =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const codeFontFamily = `var(--pm-code-font, ${fallbackMonospaceCodeFont})`;

const tableCellLineHeight = 1.4;
const tableCellVerticalPaddingEm = 1;
const tableWidgetVerticalPaddingEm = 0.5;
const tableBorderWidthPx = 1;
// Ceiling on how much width a single column may demand, at roughly half the
// editor measure. The auto table layout hands out width in proportion to each
// column's max-content, so without a ceiling one long-prose column takes
// nearly everything and its neighbours collapse toward their minimum. Capping
// the demand lets the other columns keep their natural width instead.
const tableCellMaxWidthCh = 48;
// How much room stays free between a broken-out table and each pane edge.
const breakoutGutter = "var(--writer-editor-breakout-gutter, 4rem)";

function numericSettingDefault(key: string, fallback: number): number {
  const def = SETTINGS_SCHEMA.find((entry) => entry.key === key);
  return typeof def?.default === "number" ? def.default : fallback;
}

const defaultEditorFontSizePx = numericSettingDefault("editor.font-size", 16);

type Alignment = "left" | "center" | "right";

interface ParsedTable {
  headers: string[];
  alignments: (Alignment | undefined)[];
  rows: string[][];
}

export type TableCellInlineNode =
  | { type: "text"; text: string }
  | { type: "break" }
  | {
      type: "element";
      tag: "strong" | "em" | "code" | "s" | "span";
      className?: string;
      href?: string;
      wikiTarget?: string;
      children: TableCellInlineNode[];
    };

const tableCellWikiLinkMarkdownSyntaxExtension: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkMark"],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse: (cx: InlineContext, next: number, pos: number): number => {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91 /* [ */) return -1;

        for (let end = pos + 2; end < cx.end - 1; end++) {
          if (cx.char(end) === 92 /* \ */) {
            end++;
            continue;
          }
          if (cx.char(end) !== 93 /* ] */ || cx.char(end + 1) !== 93 /* ] */) continue;

          return cx.addElement(
            cx.elt("WikiLink", pos, end + 2, [
              cx.elt("WikiLinkMark", pos, pos + 2),
              cx.elt("WikiLinkMark", end, end + 2),
            ]),
          );
        }

        return -1;
      },
    },
  ],
};

const tableCellMarkdownParser = markdownParser.configure([
  GFM,
  prosemarkMarkdownSyntaxExtensions,
  tableCellWikiLinkMarkdownSyntaxExtension,
]);
const defaultHiddenMarkdownMarks = new Set([
  "CodeMark",
  "EmphasisMark",
  "EscapeMark",
  "LinkMark",
  "StrikethroughMark",
]);
const linkHiddenMarkdownNodes = new Set([
  ...defaultHiddenMarkdownMarks,
  "LinkLabel",
  "LinkTitle",
  "URL",
]);

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function parseCells(line: string): string[] {
  const trimmed = line.trim();
  const start = trimmed.startsWith("|") ? 1 : 0;
  const end =
    trimmed.endsWith("|") && !isEscapedAt(trimmed, trimmed.length - 1)
      ? trimmed.length - 1
      : trimmed.length;
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (let i = start; i < end; i++) {
    const char = trimmed[i];
    if (char === "|" && !escaped) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    escaped = !escaped && char === "\\";
  }

  cells.push(current.trim());
  return cells;
}

function parseAlignment(cell: string): Alignment | undefined {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

function parseMarkdownTable(text: string): ParsedTable | undefined {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return undefined;

  const headers = parseCells(lines[0]);
  const delimiterCells = parseCells(lines[1]);

  const isDelimiter = delimiterCells.every((c) => /^:?-+:?$/.test(c));
  if (!isDelimiter) return undefined;

  const alignments = delimiterCells.map(parseAlignment);
  const rows = lines.slice(2).map(parseCells);

  return { headers, alignments, rows };
}

function estimateTableWidgetHeight(table: ParsedTable): number {
  const visualRows = 1 + table.rows.length;
  const rowHeight = defaultEditorFontSizePx * (tableCellLineHeight + tableCellVerticalPaddingEm);
  const wrapperPadding = defaultEditorFontSizePx * tableWidgetVerticalPaddingEm;
  const horizontalBorders = Math.max(0, visualRows + 1) * tableBorderWidthPx;

  return Math.ceil(wrapperPadding + visualRows * rowHeight + horizontalBorders);
}

function tableSourceLineClass(isFirst: boolean, isLast: boolean): string {
  let className = "cm-table-source-line";
  if (isFirst) className += " cm-table-source-line-first";
  if (isLast) className += " cm-table-source-line-last";
  return className;
}

function buildTableSourceLineDecorations(
  state: EditorState,
  node: { from: number; to: number },
): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  const firstLine = state.doc.lineAt(node.from);

  for (let pos = firstLine.from; pos <= node.to; ) {
    const line = state.doc.lineAt(pos);
    const isFirst = line.from === firstLine.from;
    const isLast = line.to >= node.to;

    decorations.push(
      Decoration.line({ class: tableSourceLineClass(isFirst, isLast) }).range(line.from),
    );

    if (isLast) break;
    pos = line.to + 1;
  }

  return decorations;
}

function pushText(nodes: TableCellInlineNode[], text: string) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    last.text += text;
    return;
  }
  nodes.push({ type: "text", text });
}

function pushNodes(nodes: TableCellInlineNode[], next: TableCellInlineNode[]) {
  for (const node of next) {
    if (node.type === "text") {
      pushText(nodes, node.text);
    } else {
      nodes.push(node);
    }
  }
}

function decodeMarkdownEntity(entity: string): string {
  const fromCodePoint = (codePoint: number): string =>
    Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;

  if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
    return fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
  }
  if (entity.startsWith("&#")) {
    return fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
  }

  switch (entity) {
    case "&amp;":
      return "&";
    case "&apos;":
      return "'";
    case "&gt;":
      return ">";
    case "&lt;":
      return "<";
    case "&nbsp;":
      return "\u00a0";
    case "&quot;":
      return '"';
    default:
      return entity;
  }
}

function renderMarkdownChildren(
  markdown: string,
  node: SyntaxNode,
  hiddenNames = defaultHiddenMarkdownMarks,
): TableCellInlineNode[] {
  const nodes: TableCellInlineNode[] = [];
  let pos = node.from;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) {
      pushText(nodes, markdown.slice(pos, child.from));
    }
    if (!hiddenNames.has(child.name)) {
      pushNodes(nodes, renderMarkdownNode(markdown, child));
    }
    pos = child.to;
  }

  if (node.to > pos) {
    pushText(nodes, markdown.slice(pos, node.to));
  }

  return nodes;
}

function markdownElement(
  tag: Extract<TableCellInlineNode, { type: "element" }>["tag"],
  children: TableCellInlineNode[],
  options: { className?: string; href?: string; wikiTarget?: string } = {},
): TableCellInlineNode[] {
  return [{ type: "element", tag, children, ...options }];
}

function linkHref(markdown: string, node: SyntaxNode): string | undefined {
  const url = node.getChild("URL");
  if (!url) return undefined;
  return markdown.slice(url.from, url.to).trim();
}

function renderLink(markdown: string, node: SyntaxNode): TableCellInlineNode[] {
  const children = renderMarkdownChildren(markdown, node, linkHiddenMarkdownNodes);
  const href = linkHref(markdown, node);
  if (children.length === 0 && href) {
    pushText(children, href);
  }
  return markdownElement("span", children, { className: "cm-rendered-link", href });
}

function renderMarkdownNode(markdown: string, node: SyntaxNode): TableCellInlineNode[] {
  switch (node.name) {
    case "Document":
    case "Paragraph":
      return renderMarkdownChildren(markdown, node);
    case "StrongEmphasis":
      return markdownElement("strong", renderMarkdownChildren(markdown, node));
    case "Emphasis":
      return markdownElement("em", renderMarkdownChildren(markdown, node));
    case "Strikethrough":
      return markdownElement("s", renderMarkdownChildren(markdown, node));
    case "InlineCode":
      return markdownElement("code", renderMarkdownChildren(markdown, node), {
        className: "cm-inline-code",
      });
    case "Link":
    case "Autolink":
      return renderLink(markdown, node);
    case "WikiLink": {
      const rawTarget = markdown.slice(node.from + 2, node.to - 2);
      return markdownElement(
        "span",
        [{ type: "text", text: parseWikiLink(rawTarget).displayText }],
        {
          className: "cm-wiki-link",
          wikiTarget: rawTarget,
        },
      );
    }
    case "URL":
      return markdownElement("span", [{ type: "text", text: markdown.slice(node.from, node.to) }], {
        className: "cm-rendered-link",
        href: markdown.slice(node.from, node.to),
      });
    case "Image": {
      const alt = renderMarkdownChildren(markdown, node, linkHiddenMarkdownNodes);
      return alt.length > 0 ? alt : [{ type: "text", text: markdown.slice(node.from, node.to) }];
    }
    case "Escape":
      return [{ type: "text", text: markdown.slice(node.from + 1, node.to) }];
    case "Entity":
      return [{ type: "text", text: decodeMarkdownEntity(markdown.slice(node.from, node.to)) }];
    case "HardBreak":
      return [{ type: "break" }];
    case "Dash": {
      const dashCount = node.to - node.from;
      if (dashCount === 2) return [{ type: "text", text: "\u2013" }];
      if (dashCount === 3) return [{ type: "text", text: "\u2014" }];
      return [{ type: "text", text: markdown.slice(node.from, node.to) }];
    }
    case "Emoji": {
      const emojiName = markdown.slice(node.from + 1, node.to - 1);
      return [{ type: "text", text: emoji.get(emojiName) || markdown.slice(node.from, node.to) }];
    }
    default:
      if (node.firstChild) return renderMarkdownChildren(markdown, node);
      return [{ type: "text", text: markdown.slice(node.from, node.to) }];
  }
}

export function parseTableCellInlineMarkdown(markdown: string): TableCellInlineNode[] {
  return renderMarkdownNode(markdown, tableCellMarkdownParser.parse(markdown).topNode);
}

function appendInlineMarkdownNodes(parent: HTMLElement, nodes: TableCellInlineNode[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.appendChild(document.createTextNode(node.text));
      continue;
    }
    if (node.type === "break") {
      parent.appendChild(document.createElement("br"));
      continue;
    }

    const child = document.createElement(node.tag);
    if (node.className) child.className = node.className;
    if (node.href) child.dataset.href = node.href;
    if (node.wikiTarget) child.dataset.wikiTarget = node.wikiTarget;
    appendInlineMarkdownNodes(child, node.children);
    parent.appendChild(child);
  }
}

function setCellMarkdownContent(cell: HTMLElement, markdown: string) {
  cell.replaceChildren();
  appendInlineMarkdownNodes(cell, parseTableCellInlineMarkdown(markdown));
}

// --- Widget ---

class TableWidget extends WidgetType {
  constructor(
    readonly table: ParsedTable,
    readonly rawText: string,
    private readonly heightEstimate: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.rawText === other.rawText;
  }

  ignoreEvent(): boolean {
    return false;
  }

  get estimatedHeight(): number {
    return this.heightEstimate;
  }

  toDOM(): HTMLElement {
    const { headers, alignments, rows } = this.table;

    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";

    const inner = wrapper.appendChild(document.createElement("div"));
    inner.className = "cm-table-inner";
    const tableEl = inner.appendChild(document.createElement("table"));

    const thead = tableEl.appendChild(document.createElement("thead"));
    const headerRow = thead.appendChild(document.createElement("tr"));
    for (let i = 0; i < headers.length; i++) {
      const th = headerRow.appendChild(document.createElement("th"));
      setCellMarkdownContent(th, headers[i]);
      const a = alignments[i];
      if (a) th.style.textAlign = a;
    }

    const tbody = tableEl.appendChild(document.createElement("tbody"));
    for (let r = 0; r < rows.length; r++) {
      const tr = tbody.appendChild(document.createElement("tr"));
      for (let c = 0; c < headers.length; c++) {
        const td = tr.appendChild(document.createElement("td"));
        setCellMarkdownContent(td, rows[r][c] ?? "");
        const a = alignments[c];
        if (a) td.style.textAlign = a;
      }
    }

    return wrapper;
  }

  updateDOM(dom: HTMLElement): boolean {
    const { headers, alignments, rows } = this.table;

    const existingThs = dom.querySelectorAll<HTMLElement>("thead th");
    const existingTrs = dom.querySelectorAll("tbody tr");
    if (existingThs.length !== headers.length || existingTrs.length !== rows.length) return false;

    existingThs.forEach((th, i) => {
      setCellMarkdownContent(th, headers[i]);
      th.style.textAlign = alignments[i] ?? "";
    });

    existingTrs.forEach((tr, rowIdx) => {
      tr.querySelectorAll<HTMLElement>("td").forEach((td, colIdx) => {
        setCellMarkdownContent(td, rows[rowIdx]?.[colIdx] ?? "");
        td.style.textAlign = alignments[colIdx] ?? "";
      });
    });

    return true;
  }
}

// --- Extensions ---

const tableFoldExtension = foldableSyntaxFacet.of({
  nodePath: "Table",
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node, selectionTouchesRange) => {
    const text = state.doc.sliceString(node.from, node.to);
    const parsed = parseMarkdownTable(text);
    if (!parsed) return undefined;

    if (selectionTouchesRange) {
      return buildTableSourceLineDecorations(state, node);
    }

    return Decoration.replace({
      widget: new TableWidget(parsed, text, estimateTableWidgetHeight(parsed)),
      block: true,
      inclusiveStart: true,
    }).range(node.from, node.to);
  },
});

const tableTheme = EditorView.baseTheme({
  ".cm-table-widget": {
    padding: `${tableWidgetVerticalPaddingEm / 2}em 0`,
    // A table wider than the editor measure breaks out of it instead of being
    // compressed into prose width. The inner box is allowed to grow past this
    // wrapper, and `justify-content: center` splits that overhang evenly, so a
    // broken-out table stays centred on the measure.
    display: "flex",
    justifyContent: "center",
  },
  ".cm-table-inner": {
    // `min-width: 100%` keeps a table that already fits flush with the left
    // edge of the measure: the box spans the measure and the table inside it is
    // still shrink-wrapped, so narrow tables render exactly as before.
    minWidth: "100%",
    width: "max-content",
    // Grow to the pane minus a gutter on each side, never below the measure
    // (`100%` here — the wrapper's containing block is `.cm-content`'s content
    // box). Composed here rather than in a `:root` custom property because
    // var() references are substituted where a custom property is declared, and
    // `--writer-editor-pane-width` is published on the editor pane, not on
    // `:root`; a pre-composed shorthand would only ever see the fallback.
    maxWidth: `max(100%, calc(var(--writer-editor-pane-width, 0px) - 2 * ${breakoutGutter}))`,
    // Never let the flex layout shrink the box back to the measure.
    flex: "none",
    // Past the break-out ceiling the table scrolls inside its own box, so the
    // document itself never scrolls sideways.
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    scrollbarGutter: "stable",
  },
  ".cm-table-widget table": {
    borderCollapse: "separate",
    borderSpacing: "0",
    border: `${tableBorderWidthPx}px solid var(--border-color, #3e3e42)`,
    borderRadius: "8px",
    overflow: "hidden",
    fontFamily: "inherit",
    fontSize: "inherit",
    // `max-content`, not `auto`: an auto table shrinks to whatever box it is
    // given, which is the compression this widget is trying to avoid. At
    // max-content every column gets the width it asks for (bounded per cell by
    // `tableCellMaxWidthCh`) and the inner box scrolls if the total doesn't fit.
    width: "max-content",
  },
  ".cm-table-widget th, .cm-table-widget td": {
    padding: `${tableCellVerticalPaddingEm / 2}em 0.8em`,
    maxWidth: `${tableCellMaxWidthCh}ch`,
    // `EditorView.lineWrapping` applies `overflow-wrap: anywhere` (plus
    // Safari's `word-break: break-word`) to `.cm-content`, and these cells
    // inherit it. Unlike `break-word`, `anywhere` contributes its break
    // opportunities to min-content sizing, so every column's minimum collapses
    // to a single character and the auto table layout is free to squeeze a
    // column until ordinary words shred mid-word. Resetting to `break-word`
    // puts the column minimum back at "longest word": an overlong token still
    // breaks, but only once it cannot fit on a line at all.
    overflowWrap: "break-word",
    wordBreak: "normal",
    // Short cells sit against the first line of a tall wrapped row rather than
    // floating in the middle of it.
    verticalAlign: "top",
    fontSize: "inherit",
    lineHeight: `${tableCellLineHeight}`,
    borderBottom: `${tableBorderWidthPx}px solid var(--border-color, #3e3e42)`,
    borderRight: `${tableBorderWidthPx}px solid var(--border-color, #3e3e42)`,
  },
  ".cm-table-widget th:last-child, .cm-table-widget td:last-child": {
    borderRight: "none",
  },
  ".cm-table-widget tbody tr:last-child td": {
    borderBottom: "none",
  },
  ".cm-table-widget th": {
    fontWeight: "600",
    backgroundColor: "var(--surface-subtle, var(--code-bg, #2d2d2d))",
    // Headers match their left-aligned bodies instead of taking the browser's
    // centered `th` default. An alignment parsed from the delimiter row is set
    // as an inline style on the cell, so `:---:` / `---:` still win here.
    textAlign: "left",
  },
  ".cm-table-source-line": {
    display: "block",
    marginLeft: "0",
    paddingLeft: "12px",
    paddingRight: "12px",
    backgroundColor: "var(--pm-code-background-color)",
    fontFamily: codeFontFamily,
    fontVariantLigatures: "none",
    fontFeatureSettings: '"calt" 0',
    fontKerning: "none",
  },
  ".cm-activeLine.cm-table-source-line": {
    backgroundColor: "var(--pm-code-background-color)",
  },
  ".cm-table-source-line-first": {
    borderTopLeftRadius: "0.4rem",
    borderTopRightRadius: "0.4rem",
  },
  ".cm-table-source-line-last": {
    borderBottomLeftRadius: "0.4rem",
    borderBottomRightRadius: "0.4rem",
  },
});

const foldTreeSync = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.docChanged && syntaxTree(update.state) !== syntaxTree(update.startState)) {
        setTimeout(() => {
          update.view.dispatch({ selection: update.view.state.selection });
        });
      }
    }
  },
);

export function tableDecorations() {
  return [
    tableFoldExtension,
    tableTheme,
    foldTreeSync,
    selectAllDecorationsOnSelectExtension("cm-table-widget"),
  ];
}
