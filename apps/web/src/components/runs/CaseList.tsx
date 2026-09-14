import { useEffect, useMemo, useState } from "react";

import { ProgressBar, type ProgressBarVariant } from "@/components/shared/ProgressBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDuration } from "@/lib/test-case-format";
import { cn } from "@/lib/utils";

import { rollupLabel, rollupToBadge, type CaseGroup } from "./case-grouping";

interface CaseListProps {
  groups: CaseGroup[];
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
}

/**
 * Master column of a run detail: one card per TEST CASE (not per step). Each
 * card shows the case's public id, title, rolled-up status, step counts,
 * duration, and a frontend/api kind tag.
 */
export function CaseList({
  groups,
  selectedCaseId,
  onSelectCase,
}: CaseListProps): React.ReactElement {
  const [filter, setFilter] = useState<"all" | "failed">("all");

  const failedCount = useMemo(
    () => groups.filter((g) => g.rollup === "fail" || g.rollup === "aborted").length,
    [groups],
  );

  useEffect(() => {
    if (failedCount === 0 && filter === "failed") {
      setFilter("all");
    }
  }, [failedCount, filter]);

  const displayedGroups = useMemo(() => {
    if (filter === "failed") {
      return groups.filter((g) => g.rollup === "fail" || g.rollup === "aborted");
    }
    return groups;
  }, [groups, filter]);

  if (groups.length === 0) {
    return (
      <div
        className="rounded-md border border-border bg-bg-elev-1 p-4 text-[12px] text-fg-4"
        data-testid="case-list-empty"
      >
        No test cases recorded yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {failedCount > 0 ? (
        <div className="flex items-center gap-1.5" data-testid="case-list-filters">
          <button
            type="button"
            onClick={() => setFilter("all")}
            data-testid="case-filter-all"
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              filter === "all"
                ? "bg-bg-elev-3 text-fg-1"
                : "text-fg-4 hover:bg-bg-elev-2 hover:text-fg-2",
            )}
          >
            All ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("failed")}
            data-testid="case-filter-failed"
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              filter === "failed"
                ? "bg-red/15 text-red ring-1 ring-red/30"
                : "text-red/80 hover:bg-red/10 hover:text-red",
            )}
          >
            Failed ({failedCount})
          </button>
        </div>
      ) : null}

      {displayedGroups.length === 0 ? (
        <div
          className="rounded-md border border-border bg-bg-elev-1 p-4 text-[12px] text-fg-4"
          data-testid="case-list-no-failures"
        >
          No failed test cases in this run.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="case-list">
          {displayedGroups.map((g) => {
            const selected = g.caseId === selectedCaseId;
        return (
          <li key={g.caseId}>
            <button
              type="button"
              onClick={() => {
                onSelectCase(g.caseId);
              }}
              data-testid="case-row"
              data-case-id={g.caseId}
              data-selected={selected ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-1.5 rounded-md border border-border bg-bg-elev-1 p-3 text-left transition-colors hover:bg-bg-elev-2",
                selected && "border-accent/40 bg-accent/[0.06]",
              )}
            >
              <div className="flex items-center gap-2">
                <StatusBadge status={rollupToBadge(g.rollup)} label={rollupLabel(g.rollup)} />
                <span className="font-mono text-[10.5px] text-fg-5">{g.casePublicId}</span>
                <span
                  className="rounded bg-bg-elev-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-4"
                  data-testid="case-row-kind"
                >
                  {g.kind}
                </span>
              </div>
              <span className="truncate text-[12.5px] text-fg-1" data-testid="case-row-title">
                {g.caseName}
              </span>
              <div className="flex items-center gap-3 font-mono text-[10.5px] text-fg-4 tabular-nums">
                <span data-testid="case-row-counts">
                  {g.total === 0 ? (
                    g.rollup === "aborted" ? (
                      <span className="text-red">Aborted</span>
                    ) : (
                      <span className="text-fg-5">No steps defined · Skipped</span>
                    )
                  ) : g.rollup === "queued" ? (
                    <span className="text-fg-4">{g.total} steps · Queued</span>
                  ) : (
                    <>
                      {g.total} steps · {g.passed} passed
                      {g.failed > 0 ? <span className="text-red"> · {g.failed} failed</span> : null}
                      {g.total > g.passed + g.failed ? (
                        <span
                          className={
                            g.rollup === "fail" || g.rollup === "aborted"
                              ? "text-amber"
                              : "text-fg-5"
                          }
                        >
                          {" "}
                          · {g.total - (g.passed + g.failed)}{" "}
                          {g.rollup === "fail" || g.rollup === "aborted"
                            ? "aborted"
                            : "skipped"}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
                <span className="ml-auto">{formatDuration(g.durationMs)}</span>
              </div>
              {g.rollup === "aborted" ? (
                <ProgressBar
                  segments={[{ value: 100, variant: "fail", label: "Aborted" }]}
                  total={100}
                  className="mt-0.5 h-1"
                />
              ) : g.rollup === "queued" ? (
                <ProgressBar
                  segments={[{ value: g.total, variant: "neutral", label: "Queued" }]}
                  total={g.total}
                  className="mt-0.5 h-1"
                />
              ) : g.total > 0 ? (
                <ProgressBar
                  segments={[
                    { value: g.passed, variant: "pass", label: `${g.passed} passed` },
                    { value: g.failed, variant: "fail", label: `${g.failed} failed` },
                    ...(g.rollup === "running"
                      ? [{ value: 1, variant: "running" as const, label: "Running" }]
                      : []),
                    ...(g.total > g.passed + g.failed && g.rollup !== "running"
                      ? [
                          {
                            value: Math.max(0, g.total - (g.passed + g.failed)),
                            variant: (g.rollup === "fail" ? "warn" : "skip") as ProgressBarVariant,
                            label: g.rollup === "fail" ? "Aborted" : "Skipped",
                          },
                        ]
                      : []),
                  ]}
                  total={g.total}
                  className="mt-0.5 h-1"
                />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  )}
</div>
  );
}
