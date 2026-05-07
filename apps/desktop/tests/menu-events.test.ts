import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@/lib/theme", () => ({
  applyTheme: vi.fn(),
  applyCssVarBindings: vi.fn(),
}));

import { MENU_EVENT_HANDLERS } from "../src/hooks/use-menu-events";
import { useEditorStore } from "../src/stores/editor-store";

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    openFiles: new Map(),
    tabs: [],
    activeTabId: null,
    activeFilePath: null,
  });
});

describe("menu-events", () => {
  test("menu:open-preferences opens a settings tab", () => {
    const handler = MENU_EVENT_HANDLERS["menu:open-preferences"];
    expect(handler).toBeDefined();

    handler!();

    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.location.kind).toBe("settings");
    expect(useEditorStore.getState().activeTabId).toBe(tabs[0]!.id);
  });

  test("menu:open-preferences focuses the existing settings tab instead of duplicating", () => {
    const handler = MENU_EVENT_HANDLERS["menu:open-preferences"]!;

    handler();
    const firstId = useEditorStore.getState().activeTabId;
    handler();
    const secondId = useEditorStore.getState().activeTabId;

    const settingsTabs = useEditorStore
      .getState()
      .tabs.filter((tab) => tab.location.kind === "settings");
    expect(settingsTabs).toHaveLength(1);
    expect(secondId).toBe(firstId);
  });
});
