import type { EditorView } from "@codemirror/view";
import { useProsemarkEditor } from "./use-prosemark-editor";
import "./prosemark-theme.css";

interface ProseMarkEditorProps {
  filePath: string;
  getScrollContainer?: () => HTMLElement | null;
  autoFocus?: boolean;
  onViewChange?: (view: EditorView | null) => void;
}

export function ProseMarkEditor({
  filePath,
  getScrollContainer,
  autoFocus,
  onViewChange,
}: ProseMarkEditorProps) {
  const editorRef = useProsemarkEditor(
    filePath,
    getScrollContainer,
    autoFocus ?? false,
    onViewChange,
  );
  // `min-h-full`, not `h-full`: CodeMirror's scroll-into-view clips the caret
  // rect to every ancestor whose content overflows it, so a viewport-high
  // mount would stop the outer scroller once the caret passed its bottom.
  return <div ref={editorRef} className="min-h-full" />;
}
