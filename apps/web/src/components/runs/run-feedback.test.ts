import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRunFeedback,
  getRunFeedback,
  setRunCaseFeedback,
} from "./run-feedback";

describe("run-feedback storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns empty object when no feedback exists", () => {
    expect(getRunFeedback("run_1")).toEqual({});
  });

  it("persists and retrieves feedback for specific test cases", () => {
    setRunCaseFeedback("run_1", "tc_1", "Timeout on login button");
    setRunCaseFeedback("run_1", "tc_2", "Database deadlock in checkout");

    const feedback = getRunFeedback("run_1");
    expect(feedback).toEqual({
      tc_1: "Timeout on login button",
      tc_2: "Database deadlock in checkout",
    });
  });

  it("isolates feedback between different runs", () => {
    setRunCaseFeedback("run_1", "tc_1", "Note for run 1");
    setRunCaseFeedback("run_2", "tc_1", "Note for run 2");

    expect(getRunFeedback("run_1")["tc_1"]).toBe("Note for run 1");
    expect(getRunFeedback("run_2")["tc_1"]).toBe("Note for run 2");
  });

  it("clears feedback for a run", () => {
    setRunCaseFeedback("run_1", "tc_1", "Note");
    clearRunFeedback("run_1");
    expect(getRunFeedback("run_1")).toEqual({});
  });

  it("handles storage exceptions gracefully using in-memory cache fallback", () => {
    const originalSetItem = sessionStorage.setItem;
    sessionStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    setRunCaseFeedback("run_fallback", "tc_x", "Fallback note");
    expect(getRunFeedback("run_fallback")["tc_x"]).toBe("Fallback note");

    sessionStorage.setItem = originalSetItem;
  });
});
