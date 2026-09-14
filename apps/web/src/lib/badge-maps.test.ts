import { describe, expect, it } from "vitest";

import { buildRunSegments, runToBadge } from "./badge-maps";

describe("badge-maps", () => {
  describe("runToBadge", () => {
    it("maps 0-step runs to warn NO STEPS", () => {
      expect(runToBadge("ERROR", { total_steps: 0, passed_steps: 0, failed_steps: 0 })).toEqual({
        status: "warn",
        label: "NO STEPS",
      });
      expect(runToBadge("PASS", { total_steps: 0, passed_steps: 0, failed_steps: 0 })).toEqual({
        status: "warn",
        label: "NO STEPS",
      });
    });

    it("maps all-skipped runs to warn SKIP", () => {
      expect(runToBadge("PASS", { total_steps: 5, passed_steps: 0, failed_steps: 0 })).toEqual({
        status: "warn",
        label: "SKIP",
      });
    });

    it("maps standard runs correctly", () => {
      expect(runToBadge("PASS", { total_steps: 5, passed_steps: 5, failed_steps: 0 })).toEqual({
        status: "pass",
      });
      expect(runToBadge("FAIL", { total_steps: 5, passed_steps: 3, failed_steps: 2 })).toEqual({
        status: "fail",
      });
      expect(runToBadge("RUNNING", { total_steps: 5, passed_steps: 1, failed_steps: 0 })).toEqual({
        status: "running",
      });
      expect(runToBadge("CANCELLED", { total_steps: 5, passed_steps: 2, failed_steps: 0 })).toEqual({
        status: "fail",
        label: "ABORTED",
      });
    });
  });

  describe("buildRunSegments", () => {
    it("handles 0-step runs with a warning segment", () => {
      const segs = buildRunSegments("ERROR", { total_steps: 0, passed_steps: 0, failed_steps: 0 });
      expect(segs).toEqual([{ value: 100, variant: "warn", label: "No steps defined" }]);
    });

    it("handles 0-step cancelled runs with a fail segment", () => {
      const segs = buildRunSegments("CANCELLED", { total_steps: 0, passed_steps: 0, failed_steps: 0 });
      expect(segs).toEqual([{ value: 100, variant: "fail", label: "Aborted" }]);
    });

    it("handles multi-outcome completed runs with fail and aborted steps", () => {
      const segs = buildRunSegments("FAIL", { total_steps: 10, passed_steps: 7, failed_steps: 2 });
      expect(segs).toEqual([
        { value: 7, variant: "pass", label: "7 passed" },
        { value: 2, variant: "fail", label: "2 failed" },
        { value: 1, variant: "warn", label: "1 aborted" },
      ]);
    });

    it("handles PASS runs with unexecuted steps as skipped", () => {
      const segs = buildRunSegments("PASS", { total_steps: 10, passed_steps: 8, failed_steps: 0 });
      expect(segs).toEqual([
        { value: 8, variant: "pass", label: "8 passed" },
        { value: 2, variant: "skip", label: "2 skipped" },
      ]);
    });

    it("handles cancelled/aborted runs with red aborted segment for unexecuted steps", () => {
      const segs = buildRunSegments("CANCELLED", { total_steps: 10, passed_steps: 6, failed_steps: 0 });
      expect(segs).toEqual([
        { value: 6, variant: "pass", label: "6 passed" },
        { value: 4, variant: "fail", label: "4 aborted" },
      ]);
    });

    it("handles active running runs with live pulse segment", () => {
      const segs = buildRunSegments("RUNNING", { total_steps: 10, passed_steps: 3, failed_steps: 1 });
      expect(segs).toEqual([
        { value: 3, variant: "pass", label: "3 passed" },
        { value: 1, variant: "fail", label: "1 failed" },
        { value: 1, variant: "running", label: "Running" },
      ]);
    });

    it("handles all-skipped runs", () => {
      const segs = buildRunSegments("PASS", { total_steps: 4, passed_steps: 0, failed_steps: 0 });
      expect(segs).toEqual([{ value: 4, variant: "skip", label: "4 skipped" }]);
    });

    it("handles error before steps run", () => {
      const segs = buildRunSegments("ERROR", { total_steps: 4, passed_steps: 0, failed_steps: 0 });
      expect(segs).toEqual([{ value: 4, variant: "error", label: "Run failed before steps completed" }]);
    });

    it("handles cancelled before steps run or when all executed steps passed", () => {
      const segs0 = buildRunSegments("CANCELLED", { total_steps: 4, passed_steps: 0, failed_steps: 0 });
      expect(segs0).toEqual([{ value: 4, variant: "fail", label: "Aborted" }]);

      const segsAllPass = buildRunSegments("CANCELLED", { total_steps: 4, passed_steps: 4, failed_steps: 0 });
      expect(segsAllPass).toEqual([{ value: 4, variant: "fail", label: "Aborted" }]);
    });

    it("handles queued runs with neutral segment", () => {
      const segs = buildRunSegments("QUEUED", { total_steps: 5, passed_steps: 0, failed_steps: 0 });
      expect(segs).toEqual([{ value: 5, variant: "neutral", label: "Queued" }]);
    });
  });
});
