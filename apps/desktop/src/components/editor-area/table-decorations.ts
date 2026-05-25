import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  foldableSyntaxFacet,
  selectAllDecorationsOnSelectExtension,
} from "@/lib/prosemark-core/main";

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

  const isDelimiter = delimiterCells.every((c) => /^:?-+:?$/.test(c));
  if (!isDelimiter) return undefined;

  const alignments = delimiterCells.map(parseAlignment);
  const rows = lines.slice(2).map(parseCells);

  return { headers, alignments, rows };
}

// --- Widget ---

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

  ignoreEvent(): boolean {
    return false;
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
      th.textContent = headers[i];
      const a = alignments[i];
      if (a) th.style.textAlign = a;
    }

    const tbody = tableEl.appendChild(document.createElement("tbody"));
    for (let r = 0; r < rows.length; r++) {
      const tr = tbody.appendChild(document.createElement("tr"));
      for (let c = 0; c < headers.length; c++) {
        const td = tr.appendChild(document.createElement("td"));
        td.textContent = rows[r][c] ?? "";
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
      th.textContent = headers[i];
      th.style.textAlign = alignments[i] ?? "";
    });

    existingTrs.forEach((tr, rowIdx) => {
      tr.querySelectorAll<HTMLElement>("td").forEach((td, colIdx) => {
        td.textContent = rows[rowIdx]?.[colIdx] ?? "";
        td.style.textAlign = alignments[colIdx] ?? "";
      });
    });

    return true;
  }
}

// --- Extensions ---

const tableFoldExtension = foldableSyntaxFacet.of({
  nodePath: "Table",
  buildDecorations: (state, node, selectionTouchesRange) => {
    if (selectionTouchesRange) return undefined;
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
  },
  ".cm-table-inner": {
    display: "inline-block",
  },
  ".cm-table-widget table": {
    borderCollapse: "separate",
    borderSpacing: "0",
    border: "1px solid var(--border-color, #3e3e42)",
    borderRadius: "8px",
    overflow: "hidden",
    fontFamily: "inherit",
    fontSize: "inherit",
    width: "auto",
  },
  ".cm-table-widget th, .cm-table-widget td": {
    padding: "0.5em 0.8em",
    minWidth: "6em",
    fontSize: "inherit",
    lineHeight: "1.4",
    borderBottom: "1px solid var(--border-color, #3e3e42)",
    borderRight: "1px solid var(--border-color, #3e3e42)",
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
