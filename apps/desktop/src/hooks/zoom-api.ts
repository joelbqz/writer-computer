import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_ZOOM, ZOOM_SETTING_KEY, zoomInFrom, zoomOutFrom } from "@/lib/zoom";

// Imperative zoom actions for the keyboard handler and the command palette.
// Every path writes the `window.zoom` setting; the settings store applies it
// to the webview as a side effect, so there is one write path. A rejected
// `setZoom` (only a missing permission can cause it) is logged by
// `applyWindowZoom` and retried on the next change.

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
