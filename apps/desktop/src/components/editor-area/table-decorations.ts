import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  foldableSyntaxFacet,
  selectAllDecorationsOnSelectExtension,
} from "@/lib/prosemark-core/main";
import { dragFrozenSelectionField, rangesTouchInclusive } from "./drag-selection-gate";

type Alignment = "left" | "center" | "right";

interface ParsedTable {
  headers: string[];
  alignments: (Alignment | undefined)[];
  rows: string[][];
}

function parseCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const stripped = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return stripped.split("|").map((c) => c.trim());
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

  // Verify delimiter row contains only dashes/colons
  const isDelimiter = delimiterCells.every((c) => /^:?-+:?$/.test(c));
  if (!isDelimiter) return undefined;

  const alignments = delimiterCells.map(parseAlignment);
  const rows = lines.slice(2).map(parseCells);

  return { headers, alignments, rows };
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: ParsedTable,
    readonly rawText: string,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return this.rawText === other.rawText;
  }

  toDOM(): HTMLElement {
    const { headers, alignments, rows } = this.table;

    const wrapper = document.createElement("div");
    wrapper.className = "cm-table-widget";
    wrapper.contentEditable = "false";

    const table = wrapper.appendChild(document.createElement("table"));

    // Header
    const thead = table.appendChild(document.createElement("thead"));
    const headerRow = thead.appendChild(document.createElement("tr"));
    for (let i = 0; i < headers.length; i++) {
      const th = headerRow.appendChild(document.createElement("th"));
      th.textContent = headers[i];
      const hAlign = alignments[i];
      if (hAlign) th.style.textAlign = hAlign;
    }

    // Body
    const tbody = table.appendChild(document.createElement("tbody"));
    for (const row of rows) {
      const tr = tbody.appendChild(document.createElement("tr"));
      for (let i = 0; i < headers.length; i++) {
        const td = tr.appendChild(document.createElement("td"));
        td.textContent = row[i] ?? "";
        const dAlign = alignments[i];
        if (dAlign) td.style.textAlign = dAlign;
      }
    }

    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const tableFoldExtension = foldableSyntaxFacet.of({
  nodePath: "Table",
  // `keepDecorationOnUnfold: true` makes prosemark always delegate the
  // decoration choice to us instead of short-circuiting when the live
  // selection touches the table range. Without it, the drag-freeze override
  // below would be bypassed and the table would unfurl mid-drag the moment
  // the extending selection enters the table.
  keepDecorationOnUnfold: true,
  buildDecorations: (state, node, selectionTouchesRange) => {
    const frozen = state.field(dragFrozenSelectionField, false);
    const touches = frozen ? rangesTouchInclusive(frozen, node) : selectionTouchesRange;
    if (touches) return undefined;

    const text = state.doc.sliceString(node.from, node.to);
    const parsed = parseMarkdownTable(text);
    if (!parsed) return undefined;

    return Decoration.replace({
      widget: new TableWidget(parsed, text),
      block: true,
      inclusiveStart: true,
    }).range(node.from, node.to);
  },
});

const tableTheme = EditorView.baseTheme({
  ".cm-table-widget": {
    padding: "0.25em 0",
    overflowX: "auto",
  },
  ".cm-table-widget table": {
    borderCollapse: "collapse",
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: "0.9em",
  },
  ".cm-table-widget th, .cm-table-widget td": {
    border: "1px solid var(--border-color, #3e3e42)",
    padding: "0.4em 0.8em",
    minWidth: "10em",
  },
  ".cm-table-widget th": {
    fontWeight: "600",
    backgroundColor: "var(--code-bg, #2d2d2d)",
  },
});

/**
 * Workaround: foldExtension only rebuilds on docChanged/selection, not on syntax
 * tree progression. When the incremental parser finishes after initial load, folds
 * stay stale. This plugin detects tree changes and nudges a rebuild.
 */
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
    selectAllDecorationsOnSelectExtension("cm-table-widget"),
    foldTreeSync,
  ];
}
