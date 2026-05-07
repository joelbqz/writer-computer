import { useEffect } from "react";
import { useUIStore } from "@/stores/ui-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { toggleSidebar } from "@/hooks/use-sidebar";

function isEditableTargetFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
  if ((active as HTMLElement).isContentEditable) return true;
  // CodeMirror editors render a contenteditable inside .cm-editor
  return active.closest(".cm-editor") !== null;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Read current state at event time
      const { openCommandPalette } = useUIStore.getState();
      const { root } = useWorkspaceStore.getState();
      const {
        tabs,
        activeTabId,
        setActiveTab,
        openNewTab,
        closeActiveTab,
        navigateBack,
        navigateForward,
      } = useEditorStore.getState();

      // Alt+Arrow: history navigation when no editable target is focused;
      // inside the editor, let CodeMirror handle word-wise cursor motion.
      if (e.altKey && !e.shiftKey && e.key === "ArrowLeft" && !isEditableTargetFocused()) {
        e.preventDefault();
        void navigateBack();
        return;
      }

      if (e.altKey && !e.shiftKey && e.key === "ArrowRight" && !isEditableTargetFocused()) {
        e.preventDefault();
        void navigateForward();
        return;
      }

      // Cmd+P / Cmd+Shift+P — unified search (files + commands)
      if (mod && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        if (e.shiftKey || root) openCommandPalette("search");
        return;
      }

      // Cmd+W — close current tab
      if (mod && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeActiveTab();
        return;
      }

      // Cmd+\ — toggle sidebar
      if (mod && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+N — create new note
      if (mod && e.key === "n") {
        e.preventDefault();
        if (root) openCommandPalette("create-file");
        return;
      }

      // Cmd+O — go to file
      if (mod && e.key === "o") {
        e.preventDefault();
        if (root) openCommandPalette("search");
        return;
      }

      // Cmd+T — new tab
      if (mod && e.key === "t") {
        e.preventDefault();
        if (root) openNewTab();
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        if (tabs.length === 0 || !activeTabId) return;
        const idx = tabs.findIndex((tab) => tab.id === activeTabId);
        if (idx === -1) return;
        const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        setActiveTab(tabs[next]!.id);
        return;
      }

      // Cmd+1 through Cmd+9 — jump to Nth tab
      if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const n = parseInt(e.key) - 1;
        if (n < tabs.length) {
          setActiveTab(tabs[n]!.id);
        }
        return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
