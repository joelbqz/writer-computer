import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { WidgetType } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { FRONTMATTER_LANGUAGE_LABEL, isFrontmatterNode } from "./markdown/frontmatter";
import {
  CODE_LINE_CLASS,
  CODE_LINE_FIRST_CLASS,
  CODE_LINE_LAST_CLASS,
  codeBlockScrollExtension,
  codeBlockScrollField,
} from "./codeFenceScroll";
import { treeChanged } from "./utils";

const fallbackMonospaceCodeFont =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const codeFontFamily = `var(--pm-code-font, ${fallbackMonospaceCodeFont})`;
const editorFontSize = "var(--writer-editor-font-size, 16px)";

type Range = { from: number; to: number };

/** Line decorations for every fenced code / frontmatter block touching
 *  `ranges`, with each block's horizontal scroll `offsets` (by block start)
 *  rendered as a negative `text-indent` on all of its lines. */
const buildCodeBlockDecorations = (
  state: EditorState,
  ranges: readonly Range[],
  offsets: ReadonlyMap<number, number>,
): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();

  // If there are multiple visible ranges, it's possible to see
  // the same code block multiple times
  const visited = new Set<string>();

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const isFencedCode = node.name === "FencedCode";
        const isFrontmatter = isFrontmatterNode(node);

        if (isFencedCode || isFrontmatter) {
          const key = JSON.stringify([node.from, node.to]);
          if (visited.has(key)) return;
          visited.add(key);

          let lang = "";
          let code = "";
          if (isFrontmatter) {
            lang = FRONTMATTER_LANGUAGE_LABEL;
            const contentNode = node.node.getChild("FrontmatterContent");
            code = contentNode ? state.doc.sliceString(contentNode.from, contentNode.to) : "";
          } else {
            const codeInfoNode = node.node.getChild("CodeInfo");
            if (codeInfoNode) {
              lang = state.doc.sliceString(codeInfoNode.from, codeInfoNode.to).toUpperCase();
            }
            const firstLine = state.doc.lineAt(node.from);
            const codeStart = firstLine.to + 1;
            const codeEnd = Math.max(codeStart, node.to - 4);
            code = state.doc.sliceString(codeStart, codeEnd);
          }

          const offset = offsets.get(node.from) ?? 0;
          const attributes = offset > 0 ? { style: `text-indent:-${offset}px` } : undefined;

          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            const isFirstLine = pos === node.from;
            const isLastLine = line.to >= node.to;

            builder.add(
              line.from,
              line.from,
              Decoration.line({
                class: `${CODE_LINE_CLASS} ${isFirstLine ? CODE_LINE_FIRST_CLASS : ""} ${
                  isLastLine ? CODE_LINE_LAST_CLASS : ""
                }`,
                ...(attributes ? { attributes } : {}),
              }),
            );

            if (isFirstLine) {
              builder.add(
                line.from,
                line.from,
                Decoration.widget({
                  widget: new CodeBlockInfoWidget(lang, code),
                }),
              );
            }

            pos = line.to + 1;
          }
        }
      },
    });
  }

  return builder.finish();
};

const codeBlockDecorations = (view: EditorView) =>
  buildCodeBlockDecorations(view.state, view.visibleRanges, view.state.field(codeBlockScrollField));

class CodeBlockInfoWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string,
  ) {
    super();
  }

  eq(other: CodeBlockInfoWidget) {
    return other.lang === this.lang && other.code === this.code;
  }

  toDOM() {
    const container = document.createElement("span");
    container.className = "cm-code-block-info";
    container.setAttribute("contenteditable", "false");

    const langContainer = document.createElement("span");
    langContainer.className = "cm-code-block-lang-container";
    langContainer.innerText = this.lang;
    container.appendChild(langContainer);

    const copyButton = document.createElement("button");
    copyButton.className = "cm-code-block-copy-button";
    // Copy icon from Lucide
    copyButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg"
        width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="lucide lucide-copy-icon lucide-copy">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>`;
    copyButton.onclick = () => {
      void navigator.clipboard.writeText(this.code);
    };
    container.appendChild(copyButton);

    return container;
  }

  ignoreEvent(_event: Event): boolean {
    return true;
  }
}

const codeBlockDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = codeBlockDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        treeChanged(update) ||
        update.state.field(codeBlockScrollField) !== update.startState.field(codeBlockScrollField)
      ) {
        this.decorations = codeBlockDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

export const codeBlockDecorationsExtension: Extension = [
  codeBlockScrollExtension,
  codeBlockDecorationsPlugin,
];

const codeFenceThemeSpec = {
  ".cm-fenced-code-line": {
    display: "block",
    marginLeft: "6px",
    backgroundColor: "var(--pm-code-background-color)",
    fontFamily: codeFontFamily,
    fontSize: editorFontSize,
    fontVariantLigatures: "none",
    fontFeatureSettings: '"calt" 0',
    fontKerning: "none",
    // Code never wraps. Overflow is clipped (not scrolled: a line must not
    // become a scroll container, see codeFenceScroll.ts) and the block scrolls
    // as one through the `text-indent` decoration on each of its lines.
    whiteSpace: "pre",
    overflowX: "clip",
  },
  // In case the active line color changes
  ".cm-activeLine.cm-fenced-code-line": {
    backgroundColor: "var(--pm-code-background-color)",
  },
  ".cm-fenced-code-line-first": {
    borderTopLeftRadius: "0.4rem",
    borderTopRightRadius: "0.4rem",
  },
  ".cm-fenced-code-line-last": {
    borderBottomLeftRadius: "0.4rem",
    borderBottomRightRadius: "0.4rem",
  },
  // Drawn by `codeBlockScrollbarLayer` along the bottom of a block whose
  // lines overflow; styled like the app's overlay scrollbars.
  ".cm-code-scrollbar-thumb": {
    borderRadius: "3px",
    backgroundColor: "var(--scrollbar-thumb, rgba(128, 128, 128, 0.5))",
    opacity: "0.6",
    transition: "opacity 120ms",
  },
  ".cm-code-scrollbar-thumb:hover, .cm-code-scrollbar-thumb.cm-code-scrollbar-dragging": {
    opacity: "1",
  },
  ".cm-code-block-info": {
    float: "right",
    padding: "0.2rem",
    display: "flex",
    gap: "0.3rem",
    alignItems: "center",
  },
  ".cm-code-block-lang-container": {
    fontSize: "0.8rem",
    color: "var(--pm-muted-color)",
  },
  ".cm-code-block-copy-button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    padding: "0.2rem",
    borderRadius: "0.2rem",
    cursor: "pointer",
    backgroundColor: "var(--pm-code-btn-background-color)",
    color: "var(--pm-muted-color)",
  },
  ".cm-code-block-copy-button:hover": {
    backgroundColor: "var(--pm-code-btn-hover-background-color)",
  },
  ".cm-code-block-copy-button svg": {
    width: "16px",
    height: "16px",
  },
};

export const codeFenceTheme = EditorView.theme(codeFenceThemeSpec);

export const __testCodeFenceExtension = {
  codeFenceThemeSpec,
  buildCodeBlockDecorations,
};
