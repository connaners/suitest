import type { StatusBadgeStatus } from "@/components/shared/StatusBadge";
import type { components } from "@/lib/api-types";

type RunStepPublic = components["schemas"]["RunStepPublic"];
type StepOutcome = components["schemas"]["StepOutcome"];
type ArtifactPublic = components["schemas"]["ArtifactPublic"];
type RunCaseSummary = components["schemas"]["RunCaseSummary"];
type RunStatus = components["schemas"]["RunStatus"];

/** Rolled-up status for a case, derived from its steps or queue state. */
export type CaseRollup = "pass" | "fail" | "running" | "skipped" | "queued" | "aborted" | "neutral";

/** Human-readable label for a step. Never a case id — falls back to type + relative order. */
export function stepTitle(step: RunStepPublic, relativeIndex?: number): string {
  const title = step.title?.trim();
  if (title) return title;
  const type = step.type?.trim() ?? "step";
  const order = relativeIndex !== undefined ? relativeIndex : step.step_order;
  return `${type} · step ${order.toString()}`;
}

/** Small tag label for a step's type (action/assertion/navigation/wait/api). */
export function stepTypeLabel(type: string | null | undefined): string {
  const t = type?.trim();
  return t && t.length > 0 ? t : "step";
}

/** One test case's rolled-up view over the run's steps + artifacts. */
export interface CaseGroup {
  caseId: string;
  casePublicId: string;
  caseName: string;
  steps: RunStepPublic[];
  total: number;
  passed: number;
  failed: number;
  rollup: CaseRollup;
  durationMs: number;
  /** "frontend" when the case has any screenshot/video, else "api". */
  kind: "frontend" | "api";
  /** First failure message across the case's steps, if any. */
  firstFailure: string | null;
}

/** Statuses considered still in-flight for the running rollup. */
const RUNNING_OUTCOMES: ReadonlySet<StepOutcome> = new Set<StepOutcome>(["PENDING"]);

export function rollupOf(
  steps: RunStepPublic[],
  totalSteps?: number,
  runStatus?: RunStatus,
): CaseRollup {
  if (steps.length === 0) return "neutral";
  if (steps.some((s) => s.outcome === "FAIL" || s.outcome === "ERROR")) return "fail";
  if (steps.some((s) => RUNNING_OUTCOMES.has(s.outcome))) return "running";

  if (runStatus === "RUNNING") {
    if (totalSteps !== undefined && totalSteps > 0 && steps.length < totalSteps) {
      return "running";
    }
  }

  if (steps.every((s) => s.outcome === "SKIP")) return "skipped";
  if (steps.every((s) => s.outcome === "PASS" || s.outcome === "SKIP")) return "pass";
  return "neutral";
}

/**
 * Group a run's steps into test cases, ordered by their first step's order
 * or planned cases sequence if available.
 */
export function groupStepsByCase(
  steps: RunStepPublic[],
  artifacts: ArtifactPublic[],
  plannedCases?: RunCaseSummary[],
  runStatus?: RunStatus,
): CaseGroup[] {
  const byCase = new Map<string, RunStepPublic[]>();
  const firstIndex = new Map<string, number>();
  steps.forEach((s, i) => {
    const list = byCase.get(s.case_id);
    if (list) {
      list.push(s);
    } else {
      byCase.set(s.case_id, [s]);
      firstIndex.set(s.case_id, i);
    }
  });

  // A case is "frontend" if any of its steps produced a screenshot/video.
  const mediaStepIds = new Set(
    artifacts
      .filter((a) => a.kind === "SCREENSHOT" || a.kind === "VIDEO")
      .map((a) => a.run_step_id),
  );

  const groups: CaseGroup[] = [];
  for (const [caseId, caseSteps] of byCase) {
    const ordered = [...caseSteps].sort((a, b) => a.step_order - b.step_order);
    const passed = ordered.filter((s) => s.outcome === "PASS").length;
    const failed = ordered.filter((s) => s.outcome === "FAIL" || s.outcome === "ERROR").length;
    const durationMs = ordered.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);
    const hasMedia = ordered.some((s) => mediaStepIds.has(s.id));
    const failing = ordered.find((s) => s.outcome === "FAIL" || s.outcome === "ERROR");
    const first = ordered[0];
    groups.push({
      caseId,
      casePublicId: first?.case_public_id ?? caseId,
      caseName:
        first?.case_title?.trim() ||
        (first?.case_name?.trim() ?? first?.case_public_id ?? "Untitled case"),
      steps: ordered,
      total: ordered.length,
      passed,
      failed,
      rollup: rollupOf(ordered, undefined, runStatus),
      durationMs,
      kind: hasMedia ? "frontend" : "api",
      firstFailure: failing?.error_message?.trim() ?? null,
    });
  }

  // If plannedCases are provided, ensure every planned case is represented in the list.
  if (plannedCases && plannedCases.length > 0) {
    const groupsByCaseId = new Map(groups.map((g) => [g.caseId, g]));
    const result: CaseGroup[] = [];

    // Helper: has a case finished all of its planned steps?
    const isFinished = (
      existingGroup: CaseGroup | undefined,
      totalSteps: number,
    ): boolean => {
      if (!existingGroup || existingGroup.steps.length === 0) return false;
      if (runStatus !== "RUNNING") return true;
      if (totalSteps > 0) {
        return existingGroup.steps.length >= totalSteps;
      }
      return !existingGroup.steps.some((s) => RUNNING_OUTCOMES.has(s.outcome));
    };

    let allPriorFinished = true;

    for (const pc of plannedCases) {
      const existing = groupsByCaseId.get(pc.case_id);
      const totalSteps = pc.totalSteps ?? (pc as { total_steps?: number }).total_steps ?? 0;
      const targetTotal = totalSteps > 0 ? totalSteps : (existing?.steps.length ?? 0);

      if (existing) {
        const finished = isFinished(existing, totalSteps);
        const rollup = rollupOf(existing.steps, totalSteps, runStatus);

        if (!finished) {
          allPriorFinished = false;
        }

        result.push({
          ...existing,
          casePublicId: pc.case_public_id || existing.casePublicId,
          caseName: pc.case_title || existing.caseName,
          total: targetTotal,
          rollup,
        });
      } else {
        let rollup: CaseRollup = "queued";
        if (runStatus === "CANCELLED") {
          rollup = "aborted";
        } else if (runStatus === "RUNNING") {
          if (allPriorFinished) {
            rollup = "running";
            allPriorFinished = false;
          } else {
            rollup = "queued";
          }
        } else {
          rollup = "queued";
        }

        result.push({
          caseId: pc.case_id,
          casePublicId: pc.case_public_id,
          caseName: pc.case_title || pc.case_public_id,
          steps: [],
          total: targetTotal,
          passed: 0,
          failed: 0,
          rollup,
          durationMs: 0,
          kind: "frontend",
          firstFailure: null,
        });
      }
    }

    return result;
  }

  groups.sort((a, b) => (firstIndex.get(a.caseId) ?? 0) - (firstIndex.get(b.caseId) ?? 0));
  return groups;
}

export function rollupLabel(rollup: CaseRollup): string {
  switch (rollup) {
    case "pass":
      return "PASS";
    case "fail":
      return "FAIL";
    case "running":
      return "RUNNING";
    case "skipped":
      return "SKIP";
    case "queued":
      return "QUEUED";
    case "aborted":
      return "ABORTED";
    default:
      return "PENDING";
  }
}

export function rollupToBadge(rollup: CaseRollup): StatusBadgeStatus {
  switch (rollup) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "running":
      return "running";
    case "skipped":
      return "warn";
    case "queued":
      return "neutral";
    case "aborted":
      return "fail";
    default:
      return "neutral";
  }
}
