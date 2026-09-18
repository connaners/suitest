import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Assistant chat panel state slice.
 *
 * Persisted in `localStorage` under `suitest.aiPanelOpen` so the user's
 * layout preference (expanded vs. collapsed / minimized) persists across
 * page reloads and screen transitions.
 */
interface AiPanelState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useAiPanel = create<AiPanelState>()(
  persist(
    (set) => ({
      isOpen: true,
      setOpen: (open) => set({ isOpen: open }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
    }),
    {
      name: "suitest.aiPanelOpen",
    },
  ),
);
