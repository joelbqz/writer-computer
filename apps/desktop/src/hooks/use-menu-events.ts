import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { createSettingsTab, useEditorStore } from "@/stores/editor-store";

// Native menu items that drive in-app navigation emit a Tauri event from the
// Rust menu handler. Add the (event-name → handler) pair here to subscribe;
// the hook below registers each entry once for the window's lifetime.
//
// Handlers must read store state at call time (`useStore.getState()`) rather
// than closing over hook callbacks, so the listener registration can stay
// stable across renders.
export const MENU_EVENT_HANDLERS: Record<string, () => void> = {
  "menu:open-preferences": openPreferences,
};

function openPreferences() {
  useEditorStore
    .getState()
    .openOrFocus((tab) => tab.location.kind === "settings", createSettingsTab);
}

export function useMenuEvents() {
  useEffect(() => {
    const unlistens = Object.entries(MENU_EVENT_HANDLERS).map(([event, handler]) =>
      listen(event, handler),
    );
    return () => {
      for (const p of unlistens) {
        void p.then((fn) => fn());
      }
    };
  }, []);
}
