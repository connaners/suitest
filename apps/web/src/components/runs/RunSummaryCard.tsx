import { MessageSquare } from "lucide-react";
import { useMemo } from "react";

import type { CaseGroup } from "@/components/runs/case-grouping";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { buildRunSegments, runToBadge } from "@/lib/badge-maps";
import { formatTimestamp } from "@/lib/date";
import { formatDuration } from "@/lib/test-case-format";

import type { RunDetail } from "@/hooks/use-runs";

interface RunSummaryCardProps {
  run: RunDetail | undefined;
  groups?: CaseGroup[] | undefined;
  feedback?: Record<string, string> | undefined;
  onOpenFeedbackModal?: () => void;
}


function coveragePercent(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "percent" in value &&
    typeof value.percent === "number"
  ) {
    return `${value.percent.toFixed(1)}%`;
  }
  return "—";
}

export function RunSummaryCard({
  run,
  groups,
  feedback,
  onOpenFeedbackModal,
}: RunSummaryCardProps): React.ReactElement {
  if (!run) {
    return (
      <section
        data-testid="run-summary-card-skeleton"
        className="rounded-md border border-border bg-bg-elev-1 p-[14px] text-[12px] text-fg-4"
      >
        Loading run…
      </section>
    );
  }

  const failedGroups = useMemo(
    () => (groups ?? []).filter((g) => g.rollup === "fail" || g.rollup === "aborted"),
    [groups],
  );
  const totalStepsFromCases =
    run.cases && run.cases.length > 0
      ? run.cases.reduce((acc, c) => acc + (c.total_steps ?? 0), 0)
      : 0;
  const totalSteps =
    totalStepsFromCases > 0
      ? Math.max(totalStepsFromCases, run.summary?.total_steps ?? 0)
      : run.summary?.total_steps ?? 0;
  const effectiveSummary = run.summary
    ? { ...run.summary, total_steps: totalSteps }
    : { total_steps: totalSteps, passed_steps: 0, failed_steps: 0, duration_ms: 0 };
  const badge = runToBadge(run.status, effectiveSummary);
  const segments = buildRunSegments(run.status, effectiveSummary);
  const passedSteps = effectiveSummary.passed_steps;
  const failedSteps = effectiveSummary.failed_steps;
  const skippedSteps = Math.max(0, totalSteps - (passedSteps + failedSteps));
  const isRunning = run.status === "RUNNING";
  const isQueued = run.status === "QUEUED";
  const isTerminal =
    run.status === "PASS" ||
    run.status === "FAIL" ||
    run.status === "ERROR" ||
    run.status === "CANCELLED" ||
    run.status === "INTERRUPTED";

  return (
    <section
      data-testid="run-summary-card"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev-1 p-[14px]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={badge.status} label={badge.label} />
          <span className="font-mono text-[12px] text-fg-3">{run.public_id}</span>
          <span className="font-mono text-[11px] text-fg-5">via {run.trigger}</span>
        </div>
      </div>
      <h2 className="text-[18px] font-semibold leading-tight tracking-[-.01em] text-fg-1">
        {run.name}
      </h2>

      <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="run-progress-section">
        <ProgressBar
          segments={segments}
          total={totalSteps > 0 ? totalSteps : 100}
          className="h-2"
        />
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-fg-4">
          {totalSteps === 0 ? (
            run.status === "CANCELLED" ? (
              <span className="flex items-center gap-1.5 text-red">
                <span className="inline-block h-2 w-2 rounded-full bg-red" />
                Run aborted (No steps executed)
              </span>
            ) : run.status === "INTERRUPTED" ? (
              <span className="flex items-center gap-1.5 text-amber">
                <span className="inline-block h-2 w-2 rounded-full bg-amber" />
                Run interrupted (No steps executed)
              </span>
            ) : run.status === "ERROR" ? (
              <span className="flex items-center gap-1.5 text-red">
                <span className="inline-block h-2 w-2 rounded-full bg-red" />
                Run errored (No steps executed)
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber">
                <span className="inline-block h-2 w-2 rounded-full bg-amber" />
                No steps defined (Skipped)
              </span>
            )
          ) : isQueued ? (
            <span className="flex items-center gap-1.5 text-fg-3">
              <span className="inline-block h-2 w-2 rounded-full bg-fg-4" />
              Queued ({totalSteps} {totalSteps === 1 ? "step" : "steps"} pending)
            </span>
          ) : (
            <>
              {passedSteps > 0 || isTerminal ? (
                <span className="flex items-center gap-1.5 text-fg-3">
                  <span className="inline-block h-2 w-2 rounded-full bg-accent" />
                  {passedSteps} passed
                </span>
              ) : null}
              {failedSteps > 0 ? (
                <span className="flex items-center gap-1.5 text-red">
                  <span className="inline-block h-2 w-2 rounded-full bg-red" />
                  {failedSteps} failed
                </span>
              ) : null}
              {run.status === "CANCELLED" ? (
                <span className="flex items-center gap-1.5 text-red">
                  <span className="inline-block h-2 w-2 rounded-full bg-red" />
                  {skippedSteps > 0 ? `${skippedSteps} aborted` : "Run aborted"}
                </span>
              ) : run.status === "INTERRUPTED" ? (
                <span className="flex items-center gap-1.5 text-amber">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber" />
                  {skippedSteps > 0 ? `${skippedSteps} interrupted` : "Run interrupted"}
                </span>
              ) : isTerminal && skippedSteps > 0 ? (
                <span className="flex items-center gap-1.5 text-amber">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber" />
                  {run.status === "FAIL" || run.status === "ERROR"
                    ? `${skippedSteps} aborted`
                    : `${skippedSteps} skipped`}
                </span>
              ) : null}
              {isRunning ? (
                <span className="flex items-center gap-1.5 text-blue">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue suitest-pulse" />
                  Running live
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>

      <dl
        className="grid grid-cols-4 gap-3 border-t border-border pt-3 font-mono text-[11px]"
        data-testid="run-summary-meta"
      >
        <Stat label="Started" value={formatTimestamp(run.started_at)} />
        <Stat label="Duration" value={formatDuration(run.duration_ms)} />
        <Stat
          label="Steps"
          value={`${effectiveSummary.passed_steps.toString()} / ${effectiveSummary.total_steps.toString()} passed`}
          subtext={
            run.status === "INTERRUPTED" && skippedSteps > 0 ? (
              <span className="text-amber font-medium">{skippedSteps} interrupted</span>
            ) : run.status === "CANCELLED" && skippedSteps > 0 ? (
              <span className="text-red font-medium">{skippedSteps} aborted</span>
            ) : failedSteps > 0 ? (
              <span className="text-red font-medium">{failedSteps} failed</span>
            ) : run.status === "PASS" && totalSteps > 0 ? (
              <span className="text-accent font-medium">all passed</span>
            ) : isRunning && totalSteps > passedSteps ? (
              <span className="text-blue font-medium">{totalSteps - passedSteps} in progress</span>
            ) : undefined
          }
        />
        {run.status === "INTERRUPTED" && failedSteps === 0 ? (
          <Stat
            label="Incomplete"
            value={skippedSteps.toString()}
            valueClassName="text-amber font-semibold"
          />
        ) : run.status === "CANCELLED" && failedSteps === 0 ? (
          <Stat
            label="Aborted"
            value={skippedSteps.toString()}
            valueClassName="text-red font-semibold"
          />
        ) : (
          <Stat
            label="Failed"
            value={failedSteps.toString()}
            valueClassName={failedSteps > 0 ? "text-red font-semibold" : undefined}
          />
        )}
      </dl>

      {failedGroups.length > 0 && onOpenFeedbackModal ? (
        <div
          data-testid="run-feedback-preview-section"
          className="flex flex-col gap-2.5 border-t border-border pt-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-red" />
              <span className="text-xs font-semibold text-fg-1">Failed Test Review</span>
              <span className="font-mono text-[11px] text-fg-4">
                ({failedGroups.filter((g) => Boolean(feedback?.[g.caseId]?.trim())).length} of {failedGroups.length} noted)
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="open-feedback-threads-btn"
              onClick={onOpenFeedbackModal}
              className="h-7 text-xs gap-1.5 border-border bg-bg-elev-2/80 hover:bg-bg-elev-3 hover:text-fg-1 text-fg-2"
            >
              <MessageSquare className="h-3 w-3 text-accent" />
              Review Notes & Print ({failedGroups.length})
            </Button>
          </div>

          <div className="flex flex-col gap-1.5 font-mono text-[11px]">
            {failedGroups.slice(0, 2).map((g) => {
              const note = feedback?.[g.caseId]?.trim();
              return (
                <div
                  key={g.caseId}
                  className="flex items-baseline justify-between gap-2 rounded bg-bg-elev-2/40 px-2.5 py-1 text-fg-3 border border-border/50"
                >
                  <span className="truncate font-sans font-medium text-fg-2">
                    <span className="font-mono text-fg-4 mr-1.5">{g.casePublicId}:</span>
                    {g.caseName}
                  </span>
                  <span className="truncate max-w-[50%] text-[10.5px] italic text-fg-4">
                    {note || "(No notes entered yet)"}
                  </span>
                </div>
              );
            })}
            {failedGroups.length > 2 ? (
              <div className="text-[10px] text-fg-5 italic pl-1">
                + {failedGroups.length - 2} more failed {failedGroups.length - 2 === 1 ? "case" : "cases"} to review
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {run.coverage_summary ? (
        <dl
          className="grid grid-cols-2 gap-3 border-t border-border pt-3 font-mono text-[11px]"
          data-testid="run-coverage-summary"
        >
          <Stat label="Line coverage" value={coveragePercent(run.coverage_summary.lines)} />
          <Stat label="Branch coverage" value={coveragePercent(run.coverage_summary.branches)} />
        </dl>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  subtext,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode | undefined;
  valueClassName?: string | undefined;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10.5px] uppercase tracking-wide text-fg-5">{label}</dt>
      <dd className={`text-[13px] tabular-nums text-fg-1 ${valueClassName ?? ""}`}>{value}</dd>
      {subtext ? <div className="text-[11px] leading-none">{subtext}</div> : null}
    </div>
  );
}
