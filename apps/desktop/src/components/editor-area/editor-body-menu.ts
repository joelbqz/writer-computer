import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { buildEditorBodyMenuItemsSpec, showNativeContextMenu } from "./editor-context-menu";
import { followLink, linkHrefAtPos } from "./link-navigation";
import { runEditorCommand } from "./markdown-formatting";

/** Right-click menu over the editor body: clipboard, the command submenus,
 *  and link actions when the click landed on a link. */
export function editorBodyContextMenuExtension(
  getFilePath: () => string,
  isDisposed: () => boolean,
): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      event.preventDefault();

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const linkHref = pos === null ? null : linkHrefAtPos(view, pos);
      const hasLink = linkHref !== null;
      const filePath = getFilePath();

      void showNativeContextMenu(
        buildEditorBodyMenuItemsSpec(
          {
            onCut: () => {
              const { from, to } = view.state.selection.main;
              if (from === to) return;
              void writeText(view.state.sliceDoc(from, to));
              view.dispatch({ changes: { from, to } });
            },
            onCopy: () => {
              const { from, to } = view.state.selection.main;
              if (from === to) return;
              void writeText(view.state.sliceDoc(from, to));
            },
            onPaste: () => {
              void readText().then((text) => {
                if (!text || isDisposed()) return;
                view.dispatch(view.state.replaceSelection(text));
              });
            },
            onSelectAll: () => {
              view.dispatch({
                selection: { anchor: 0, head: view.state.doc.length },
              });
            },
            onOpenLink: hasLink
              ? () => {
                  void followLink(linkHref, view, filePath);
                }
              : undefined,
            onCopyLink: hasLink
              ? () => {
                  void writeText(linkHref);
                }
              : undefined,
            onRunCommand: (id) => {
              view.focus();
              runEditorCommand(view, id);
            },
          },
          hasLink,
        ),
      );

      return true;
    },
  });
}
