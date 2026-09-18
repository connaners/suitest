import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAiPanel } from "@/stores/use-ai-panel";

const STORAGE_KEY = "suitest.aiPanelOpen";

describe("useAiPanel", () => {
  beforeEach(() => {
    useAiPanel.getState().setOpen(true);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  });

  afterEach(() => {
    useAiPanel.getState().setOpen(true);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  });

  it("defaults to isOpen === true", () => {
    expect(useAiPanel.getState().isOpen).toBe(true);
  });

  it("setOpen updates the store synchronously", () => {
    useAiPanel.getState().setOpen(false);
    expect(useAiPanel.getState().isOpen).toBe(false);

    useAiPanel.getState().setOpen(true);
    expect(useAiPanel.getState().isOpen).toBe(true);
  });

  it("toggle flips the open state", () => {
    expect(useAiPanel.getState().isOpen).toBe(true);
    useAiPanel.getState().toggle();
    expect(useAiPanel.getState().isOpen).toBe(false);
    useAiPanel.getState().toggle();
    expect(useAiPanel.getState().isOpen).toBe(true);
  });

  it("persists isOpen to localStorage under the suitest namespace", () => {
    useAiPanel.getState().setOpen(false);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as {
      state?: { isOpen?: boolean };
    };
    expect(parsed.state?.isOpen).toBe(false);
  });
});
