import { create } from "zustand";

const DISMISS_AFTER_MS = 4000;

interface AnchorWarningState {
  message: string | null;
  showWarning: (message: string) => void;
  dismissWarning: () => void;
}

let dismissTimer: number | null = null;

export const useAnchorWarningStore = create<AnchorWarningState>((set, get) => ({
  message: null,
  showWarning: (message) => {
    if (dismissTimer !== null) window.clearTimeout(dismissTimer);
    set({ message });
    dismissTimer = window.setTimeout(() => {
      dismissTimer = null;
      get().dismissWarning();
    }, DISMISS_AFTER_MS);
  },
  dismissWarning: () => {
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    set({ message: null });
  },
}));

export function showAnchorWarning(message: string) {
  useAnchorWarningStore.getState().showWarning(message);
}

export function dismissAnchorWarning() {
  useAnchorWarningStore.getState().dismissWarning();
}
