import { useUIStore } from "@/stores/ui-store";

export type { CommandPaletteIntent } from "@/stores/ui-store";

export function useIsCommandPaletteOpen() {
  return useUIStore((s) => s.isCommandPaletteOpen);
}

export function useCommandPaletteIntent() {
  return useUIStore((s) => s.commandPaletteIntent);
}

export function useOpenCommandPalette() {
  return useUIStore((s) => s.openCommandPalette);
}

export function useCloseCommandPalette() {
  return useUIStore((s) => s.closeCommandPalette);
}

export function useCommandPaletteSearch() {
  return useUIStore((s) => s.commandPaletteSearch);
}

export function useCommandPaletteSession() {
  return useUIStore((s) => s.commandPaletteSession);
}

export function useSetCommandPaletteSearch() {
  return useUIStore((s) => s.setCommandPaletteSearch);
}
