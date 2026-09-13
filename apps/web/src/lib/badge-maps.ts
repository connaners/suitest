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
      return "fail";
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
  if (
    (status === "ERROR" || status === "PASS") &&
    summary !== undefined &&
    summary !== null &&
    summary.total_steps === 0
  ) {
    return { status: "warn", label: "NO STEPS" };
  }
  if (status === "CANCELLED") {
    return { status: "fail", label: "ABORTED" };
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

import type { ProgressBarSegment } from "@/components/shared/ProgressBar";

/**
 * Builds multi-color progress bar segments based on run status and summary counters.
 */
export function buildRunSegments(
  status: RunStatus,
  summary?: RunSummary | null,
): ProgressBarSegment[] {
  const total = summary?.total_steps ?? 0;
  const passed = summary?.passed_steps ?? 0;
  const failed = summary?.failed_steps ?? 0;

  // Empty selection or 0-step runs (e.g. R-1072, R-1073)
  if (total === 0) {
    if (status === "PASS" || status === "ERROR") {
      return [{ value: 100, variant: "warn", label: "No steps defined" }];
    }
    if (status === "RUNNING") {
      return [{ value: 100, variant: "running", label: "Running" }];
    }
    if (status === "CANCELLED") {
      return [{ value: 100, variant: "fail", label: "Aborted" }];
    }
    return [];
  }

  // Queued status: steps are waiting to be executed, not skipped
  if (status === "QUEUED") {
    return [{ value: total > 0 ? total : 100, variant: "neutral", label: "Queued" }];
  }

  // Active running status: show completed passed, failed, and the currently running step
  if (status === "RUNNING") {
    const executed = passed + failed;
    const runningCount = Math.min(1, Math.max(0, total - executed));
    const segments: ProgressBarSegment[] = [];
    if (passed > 0) {
      segments.push({ value: passed, variant: "pass", label: `${passed} passed` });
    }
    if (failed > 0) {
      segments.push({ value: failed, variant: "fail", label: `${failed} failed` });
    }
    if (runningCount > 0) {
      segments.push({ value: runningCount, variant: "running", label: "Running" });
    }
    return segments;
  }

  // Failed / errored before any steps could run
  if ((status === "ERROR" || status === "FAIL") && passed === 0 && failed === 0) {
    return [{ value: total, variant: "error", label: "Run failed before steps completed" }];
  }

  // Cancelled run handling
  if (status === "CANCELLED") {
    const remaining = Math.max(0, total - (passed + failed));
    if (remaining <= 0 || (passed === 0 && failed === 0)) {
      return [{ value: total > 0 ? total : 100, variant: "fail", label: "Aborted" }];
    }
    const segments: ProgressBarSegment[] = [];
    if (passed > 0) {
      segments.push({ value: passed, variant: "pass", label: `${passed} passed` });
    }
    if (failed > 0) {
      segments.push({ value: failed, variant: "fail", label: `${failed} failed` });
    }
    segments.push({ value: remaining, variant: "fail", label: `${remaining} aborted` });
    return segments;
  }

  // All skipped run
  if (status === "PASS" && passed === 0 && total > 0) {
    return [{ value: total, variant: "skip", label: `${total} skipped` }];
  }

  // Normal terminal run (PASS, FAIL, ERROR)
  const remaining = Math.max(0, total - (passed + failed));
  const segments: ProgressBarSegment[] = [];
  if (passed > 0) {
    segments.push({ value: passed, variant: "pass", label: `${passed} passed` });
  }
  if (failed > 0) {
    segments.push({
      value: failed,
      variant: status === "ERROR" ? "error" : "fail",
      label: `${failed} ${status === "ERROR" ? "errored" : "failed"}`,
    });
  }
  if (remaining > 0) {
    segments.push({ value: remaining, variant: "skip", label: `${remaining} skipped` });
  }

  return segments;
}

