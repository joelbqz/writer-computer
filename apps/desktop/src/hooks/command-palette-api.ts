import { useUIStore } from "@/stores/ui-store";

export function getCommandPaletteSession() {
  return useUIStore.getState().commandPaletteSession;
}
