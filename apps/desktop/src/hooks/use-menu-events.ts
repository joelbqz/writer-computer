import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useOpenSettingsTab } from "./use-tabs";

export function useMenuEvents() {
  const openSettingsTab = useOpenSettingsTab();

  useEffect(() => {
    const unlisten = listen("menu:open-preferences", () => {
      openSettingsTab();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openSettingsTab]);
}
