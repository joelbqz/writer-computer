import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_ZOOM, ZOOM_SETTING_KEY, zoomInFrom, zoomOutFrom } from "@/lib/zoom";

// Imperative zoom actions for the keyboard handler and the command palette.
// Every path writes the `editor.zoom` setting; the settings store pushes it
// to `--writer-editor-zoom` through the generic cssVar binding, so there is
// one write path and no zoom-specific side effect.

function writeZoom(next: number) {
  const { settings, setSetting } = useSettingsStore.getState();
  // `setSetting` skips the optimistic update for an equal value but still
  // queues the disk write; at a bound (300% and Cmd+=) that would be churn.
  if (settings[ZOOM_SETTING_KEY] === next) return;
  void setSetting(ZOOM_SETTING_KEY, next);
}

export function zoomIn() {
  writeZoom(zoomInFrom(useSettingsStore.getState().settings[ZOOM_SETTING_KEY]));
}

export function zoomOut() {
  writeZoom(zoomOutFrom(useSettingsStore.getState().settings[ZOOM_SETTING_KEY]));
}

export function resetZoom() {
  writeZoom(DEFAULT_ZOOM);
}
