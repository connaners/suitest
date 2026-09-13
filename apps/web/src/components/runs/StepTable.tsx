import { StatusBadge, type StatusBadgeStatus } from "@/components/shared/StatusBadge";
import type { components } from "@/lib/api-types";
import { cleanErrorMessage } from "@/lib/error-formatter";
import { formatDuration } from "@/lib/test-case-format";
import { cn } from "@/lib/utils";

import { stepTitle, stepTypeLabel } from "./case-grouping";

type StepOutcome = components["schemas"]["StepOutcome"];

export type StepDisplayOutcome = StepOutcome | "RUNNING" | "QUEUED" | "ABORTED" | "PENDING";

export interface DisplayStep {
  id: string;
  case_id: string;
  step_order: number;
  title?: string | null;
  type?: string | null;
  outcome: StepDisplayOutcome;
  duration_ms?: number | null;
  error_message?: string | null;
  stdout?: string | null;
  isPlannedOnly?: boolean;
}

interface StepTableProps {
  steps: DisplayStep[];
  /** id of the currently-previewed step (its screenshot is shown on the right). */
  selectedStepId?: string | null;
  /** Click a row to preview that step's screenshot ("Preview: Step N"). */
  onSelectStep?: (stepId: string) => void;
}

function displayOutcomeLabel(outcome: StepDisplayOutcome): string {
  switch (outcome) {
    case "PASS":
      return "PASS";
    case "FAIL":
      return "FAIL";
    case "SKIP":
      return "SKIP";
    case "ERROR":
      return "ERROR";
    case "RUNNING":
      return "RUNNING";
    case "QUEUED":
      return "QUEUED";
    case "ABORTED":
      return "ABORTED";
    default:
      return "PENDING";
  }
}

function displayOutcomeBadge(outcome: StepDisplayOutcome): StatusBadgeStatus {
  switch (outcome) {
    case "PASS":
      return "pass";
    case "FAIL":
    case "ERROR":
    case "ABORTED":
      return "fail";
    case "SKIP":
      return "warn";
    case "RUNNING":
      return "running";
    default:
      return "neutral";
  }
}

export function StepTable({
  steps,
  selectedStepId,
  onSelectStep,
}: StepTableProps): React.ReactElement {
  if (steps.length === 0) {
    return (
      <div
        className="rounded-md border border-border bg-bg-elev-1 p-3 text-[12px] text-fg-4"
        data-testid="step-table-empty"
      >
        No steps recorded yet.
      </div>
    );
  }
  return (
    <div
      className="overflow-x-auto rounded-md border border-border bg-bg-elev-1"
      data-testid="step-table"
    >
      <table className="w-full min-w-[480px] text-[12px]">
        <thead className="text-fg-5">
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-wide">
              #
            </th>
            <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-wide">
              Step
            </th>
            <th className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-wide">
              Outcome
            </th>
            <th className="px-3 py-2 text-right font-mono text-[10.5px] uppercase tracking-wide">
              Duration
            </th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, idx) => (
            <tr
              key={s.id}
              className={cn(
                "border-b border-border align-top transition-colors last:border-b-0",
                onSelectStep && "cursor-pointer hover:bg-bg-elev-2",
                selectedStepId === s.id && "bg-accent/[0.08]",
              )}
              data-testid="step-row"
              data-outcome={s.outcome}
              data-selected={selectedStepId === s.id ? "true" : undefined}
              onClick={onSelectStep ? () => onSelectStep(s.id) : undefined}
            >
              <td className="px-3 py-2 font-mono text-[11px] text-fg-4">{idx + 1}</td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-fg-2" data-testid="step-title">
                      {stepTitle(s, idx + 1)}
                    </span>
                    <span
                      className="shrink-0 rounded bg-bg-elev-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-4"
                      data-testid="step-type-badge"
                    >
                      {stepTypeLabel(s.type)}
                    </span>
                  </div>
                  {s.error_message ? (
                    <div
                      className={cn(
                        "overflow-x-auto rounded-md p-2 font-mono text-[11px]",
                        s.outcome === "ERROR"
                          ? "border border-red/40 bg-red/[0.08] text-red"
                          : "bg-bg-code text-red",
                      )}
                      data-testid="step-error-message"
                    >
                      {s.outcome === "ERROR" ? (
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red">
                          Environment Error
                        </div>
                      ) : null}
                      <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                        {cleanErrorMessage(s.error_message)}
                      </pre>
                    </div>
                  ) : null}
                  {s.stdout ? (
                    <details data-testid="step-output">
                      <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-wide text-fg-5">
                        Output
                      </summary>
                      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-bg-code p-2 font-mono text-[11px] text-fg-3">
                        {s.stdout}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2">
                <StatusBadge
                  status={displayOutcomeBadge(s.outcome)}
                  label={displayOutcomeLabel(s.outcome)}
                />
              </td>
              <td className="px-3 py-2 text-right font-mono text-[11px] text-fg-4 tabular-nums">
                {s.duration_ms !== null && s.duration_ms !== undefined
                  ? formatDuration(s.duration_ms)
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
