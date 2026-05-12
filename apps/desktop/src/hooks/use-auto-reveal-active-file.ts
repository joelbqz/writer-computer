import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { revealPathInSidebar } from "@/lib/reveal-in-sidebar";

/**
 * Subscribe to `editor-store.activeFilePath` and reveal the file in the
 * sidebar whenever it changes to a non-null path. Every file-open entry
 * point (sidebar click, wikilink Cmd-click, command palette, drag-drop,
 * welcome, recents, back/forward, session restore) converges here, so one
 * subscription covers all of them.
 *
 * Auto-reveal does not force the sidebar open — that's the explicit menu
 * action's job.
 */
export function useAutoRevealActiveFile() {
  useEffect(() => {
    let lastPath: string | null = null;
    const handle = (path: string | null) => {
      if (path === lastPath) return;
      lastPath = path;
      if (path) void revealPathInSidebar(path);
    };

    handle(useEditorStore.getState().activeFilePath);
    return useEditorStore.subscribe((state) => handle(state.activeFilePath));
  }, []);
}
