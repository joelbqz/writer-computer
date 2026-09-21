import { useEffect, useRef, useState } from "react";
import { EditorView, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import {
  prosemarkBasicSetup,
  prosemarkBaseThemeSetup,
  prosemarkMarkdownSyntaxExtensions,
} from "@/lib/prosemark-core/main";
import { headingDecorations } from "@/components/editor-area/heading-decorations";
import { markdownFormatting } from "@/components/editor-area/markdown-formatting";
import { viewportParsePlugin } from "@/components/editor-area/viewport-parse";
import "@/components/editor-area/prosemark-theme.css";

const SAMPLE = `# List playground

- jev limitations (quoted from docs): "Set the key in the gateway."
  Your Gateway team must allow the provider.
- im creating a sub item!!
- jev API (from the core package): an async generator yielding events.
  Candidate shape: id, description, root.
- shadcn charts: https://ui.shadcn.com/docs/components/chart

Plain paragraph after the list.
`;

// Renders the document with whitespace made visible and the caret marked,
// so what the editor did to the markdown is readable next to the rendering.
function SourceView({ doc, head }: { doc: string; head: number }) {
  const before = doc.slice(0, head);
  const after = doc.slice(head);
  const show = (s: string) =>
    s.split(/(\n| {2,}|\t)/).map((part, i) => {
      if (part === "\n") return <span key={i}>{"⏎\n"}</span>;
      if (part === "\t")
        return (
          <span key={i} className="ws">
            {"→"}
          </span>
        );
      if (/^ {2,}$/.test(part))
        return (
          <span key={i} className="ws">
            {"·".repeat(part.length)}
          </span>
        );
      return <span key={i}>{part}</span>;
    });
  return (
    <pre className="pg-source" data-testid="source">
      {show(before)}
      <span className="caret" />
      {show(after)}
    </pre>
  );
}

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState(SAMPLE);
  const [head, setHead] = useState(0);

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: SAMPLE,
        extensions: [
          markdown({ extensions: [GFM, prosemarkMarkdownSyntaxExtensions] }),
          history(),
          prosemarkBasicSetup(),
          drawSelection(),
          prosemarkBaseThemeSetup(),
          viewportParsePlugin,
          headingDecorations,
          markdownFormatting,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setDoc(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) {
              setHead(update.state.selection.main.head);
            }
          }),
        ],
      }),
    });
    // Exposed for browser automation: `window.__view.state.doc.toString()`.
    (window as unknown as { __view: EditorView; __EditorView: typeof EditorView }).__view = view;
    (window as unknown as { __EditorView: typeof EditorView }).__EditorView = EditorView;
    view.focus();
    return () => view.destroy();
  }, []);

  return (
    <div className="pg">
      <div className="pg-editor">
        <div className="pg-toolbar">rendered editor (desktop app's editor core + theme)</div>
        <div ref={host} data-testid="editor" />
      </div>
      <div>
        <div className="pg-toolbar" style={{ paddingTop: 24 }}>
          markdown source (· = two or more spaces, → = tab, ⏎ = newline)
        </div>
        <SourceView doc={doc} head={head} />
      </div>
    </div>
  );
}
