import type { StatusBadgeStatus } from "@/components/shared/StatusBadge";
import type { components } from "@/lib/api-types";

type RunStatus = components["schemas"]["RunStatus"];
type StepOutcome = components["schemas"]["StepOutcome"];
type RunSummary = components["schemas"]["RunSummary"];

/**
 * Map a run status onto the shared status palette. The narrowed return type is
 * a subset of `StatusBadgeStatus` that is also assignable to `SourceDotStatus`,
 * so call sites can feed either `<StatusBadge>` or `<SourceDot>`.
 */
export function statusToBadge(status: RunStatus): "pass" | "fail" | "warn" | "running" | "neutral" {
  switch (status) {
    case "PASS":
      return "pass";
    case "FAIL":
    case "ERROR":
      return "fail";
    case "RUNNING":
      return "running";
    case "CANCELLED":
      return "warn";
    default:
      return "neutral";
  }
}

export interface RunBadgeDescriptor {
  status: "pass" | "fail" | "warn" | "running" | "neutral";
  label?: string;
}

/**
 * Enhanced badge mapping for a run: maps 100% skipped runs to warn / SKIP.
 */
export function runToBadge(
  status: RunStatus,
  summary?: RunSummary | null,
): RunBadgeDescriptor {
  if (
    status === "PASS" &&
    summary !== undefined &&
    summary !== null &&
    summary.total_steps > 0 &&
    summary.passed_steps === 0
  ) {
    return { status: "warn", label: "SKIP" };
  }
  return { status: statusToBadge(status) };
}

/** Map a step outcome onto the shared status-badge palette. */
export function outcomeToBadge(outcome: StepOutcome): StatusBadgeStatus {
  switch (outcome) {
    case "PASS":
      return "pass";
    case "FAIL":
    case "ERROR":
      return "fail";
    case "SKIP":
      return "warn";
    default:
      return "neutral";
  }
}
