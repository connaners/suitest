import { describe, expect, it } from "vitest";

import { groupStepsByCase, rollupOf } from "@/components/runs/case-grouping";
import type { components } from "@/lib/api-types";

type RunStepPublic = components["schemas"]["RunStepPublic"];
type RunCaseSummary = components["schemas"]["RunCaseSummary"];

function makeStep(overrides: Partial<RunStepPublic> = {}): RunStepPublic {
  return {
    id: "step_1",
    run_id: "run_1",
    case_id: "case_1",
    case_public_id: "TC-101",
    step_order: 1,
    outcome: "PASS",
    ...overrides,
  } as RunStepPublic;
}

describe("case-grouping", () => {
  describe("rollupOf", () => {
    it("returns immediate fail if any step has FAIL or ERROR", () => {
      const steps = [
        makeStep({ id: "s1", outcome: "PASS" }),
        makeStep({ id: "s2", outcome: "FAIL", error_message: "assertion failed" }),
      ];
      expect(rollupOf(steps, 3, "RUNNING")).toBe("fail");
      expect(rollupOf(steps, 2, "PASS")).toBe("fail");
    });

    it("returns running if any step is PENDING", () => {
      const steps = [
        makeStep({ id: "s1", outcome: "PASS" }),
        makeStep({ id: "s2", outcome: "PENDING" }),
      ];
      expect(rollupOf(steps, 3, "RUNNING")).toBe("running");
    });

    it("returns running when run is RUNNING and steps.length < totalSteps", () => {
      const steps = [makeStep({ id: "s1", outcome: "PASS" })];
      // 1 out of 3 steps done -> in progress
      expect(rollupOf(steps, 3, "RUNNING")).toBe("running");
    });

    it("returns pass when run is RUNNING and steps.length >= totalSteps and all pass", () => {
      const steps = [
        makeStep({ id: "s1", outcome: "PASS" }),
        makeStep({ id: "s2", outcome: "PASS" }),
      ];
      // 2 out of 2 steps done -> completed and pass
      expect(rollupOf(steps, 2, "RUNNING")).toBe("pass");
    });

    it("returns pass in completed run if all steps pass", () => {
      const steps = [makeStep({ id: "s1", outcome: "PASS" })];
      expect(rollupOf(steps, 1, "PASS")).toBe("pass");
    });

    it("returns skipped if all steps are SKIP", () => {
      const steps = [makeStep({ id: "s1", outcome: "SKIP" })];
      expect(rollupOf(steps, 1, "PASS")).toBe("skipped");
    });
  });

  describe("groupStepsByCase with plannedCases", () => {
    const plannedCases: RunCaseSummary[] = [
      { case_id: "c1", case_public_id: "TC-101", case_title: "Login", totalSteps: 3 },
      { case_id: "c2", case_public_id: "TC-102", case_title: "Checkout", totalSteps: 2 },
      { case_id: "c3", case_public_id: "TC-103", case_title: "Logout", totalSteps: 1 },
    ];

    it("marks the first case as running and subsequent cases as queued when run starts with 0 steps", () => {
      const groups = groupStepsByCase([], [], plannedCases, "RUNNING");
      expect(groups).toHaveLength(3);

      expect(groups[0]?.casePublicId).toBe("TC-101");
      expect(groups[0]?.rollup).toBe("running");
      expect(groups[0]?.total).toBe(3);

      expect(groups[1]?.casePublicId).toBe("TC-102");
      expect(groups[1]?.rollup).toBe("queued");
      expect(groups[1]?.total).toBe(2);

      expect(groups[2]?.casePublicId).toBe("TC-103");
      expect(groups[2]?.rollup).toBe("queued");
      expect(groups[2]?.total).toBe(1);
    });

    it("keeps active case running while 1 of 3 steps completed, and subsequent cases queued", () => {
      const steps = [makeStep({ id: "s1", case_id: "c1", step_order: 1, outcome: "PASS" })];
      const groups = groupStepsByCase(steps, [], plannedCases, "RUNNING");

      expect(groups[0]?.rollup).toBe("running");
      expect(groups[0]?.passed).toBe(1);
      expect(groups[0]?.total).toBe(3);

      expect(groups[1]?.rollup).toBe("queued");
      expect(groups[2]?.rollup).toBe("queued");
    });

    it("immediately marks active case as fail if a step errors, without marking next cases running yet", () => {
      const steps = [
        makeStep({
          id: "s1",
          case_id: "c1",
          step_order: 1,
          outcome: "FAIL",
          error_message: "Network Timeout",
        }),
      ];
      const groups = groupStepsByCase(steps, [], plannedCases, "RUNNING");

      expect(groups[0]?.rollup).toBe("fail");
      expect(groups[0]?.failed).toBe(1);
      expect(groups[0]?.firstFailure).toBe("Network Timeout");

      // Case 1 is not finished executing (1 < 3 steps), so Case 2 remains queued
      expect(groups[1]?.rollup).toBe("queued");
      expect(groups[2]?.rollup).toBe("queued");
    });

    it("transitions next case to running once the first case finishes all its steps", () => {
      const steps = [
        makeStep({ id: "s1", case_id: "c1", step_order: 1, outcome: "PASS" }),
        makeStep({ id: "s2", case_id: "c1", step_order: 2, outcome: "PASS" }),
        makeStep({ id: "s3", case_id: "c1", step_order: 3, outcome: "PASS" }),
      ];
      const groups = groupStepsByCase(steps, [], plannedCases, "RUNNING");

      // Case 1 completed all 3 steps
      expect(groups[0]?.rollup).toBe("pass");
      expect(groups[0]?.passed).toBe(3);

      // Case 2 is now actively starting
      expect(groups[1]?.rollup).toBe("running");
      expect(groups[1]?.total).toBe(2);

      // Case 3 is still queued
      expect(groups[2]?.rollup).toBe("queued");
    });

    it("marks unexecuted cases as aborted when run is CANCELLED", () => {
      const groups = groupStepsByCase([], [], plannedCases, "CANCELLED");
      expect(groups.every((g) => g.rollup === "aborted")).toBe(true);
    });

    it("marks unexecuted cases as queued when run is QUEUED", () => {
      const groups = groupStepsByCase([], [], plannedCases, "QUEUED");
      expect(groups.every((g) => g.rollup === "queued")).toBe(true);
    });
  });
});
