import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Assistant chat panel state slice.
 *
 * Persisted in `localStorage` under `suitest.aiPanelOpen` and synchronized with
 * `suitest.agentPanelCollapsed` for cross-component compatibility.
 */
interface AiPanelState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

function readInitialOpen(): boolean {
  try {
    if (localStorage.getItem("suitest.agentPanelCollapsed") === "1") {
      return false;
    }
    const val = localStorage.getItem("suitest.aiPanelOpen");
    if (val !== null) {
      return val === "true" || val === "1";
    }
    return true;
  } catch {
    return true;
  }
}

function syncCollapsedStorage(open: boolean): void {
  try {
    localStorage.setItem("suitest.agentPanelCollapsed", open ? "0" : "1");
  } catch {
    /* private browsing */
  }
}

export const useAiPanel = create<AiPanelState>()(
  persist(
    (set) => ({
      isOpen: readInitialOpen(),
      setOpen: (open) => {
        syncCollapsedStorage(open);
        set({ isOpen: open });
      },
      toggle: () =>
        set((state) => {
          const next = !state.isOpen;
          syncCollapsedStorage(next);
          return { isOpen: next };
        }),
    }),
    {
      name: "suitest.aiPanelOpen",
    },
  ),
);
