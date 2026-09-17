import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ProgressBar, type ProgressBarVariant } from "@/components/shared/ProgressBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDuration } from "@/lib/test-case-format";
import { cn } from "@/lib/utils";

import { rollupLabel, rollupToBadge, type CaseGroup } from "./case-grouping";

import type { components } from "@/lib/api-types";

type RunStatus = components["schemas"]["RunStatus"];

interface CaseListProps {
  groups: CaseGroup[];
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
  runStatus?: RunStatus | undefined;
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
  runStatus,
}: CaseListProps): React.ReactElement {
  const [filter, setFilter] = useState<"all" | "failed">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const failedCount = useMemo(
    () => groups.filter((g) => g.rollup === "fail" || g.rollup === "aborted").length,
    [groups],
  );

  useEffect(() => {
    if (failedCount === 0 && filter === "failed") {
      setFilter("all");
    }
  }, [failedCount, filter]);

  const filteredByStatus = useMemo(() => {
    if (filter === "failed") {
      return groups.filter((g) => g.rollup === "fail" || g.rollup === "aborted");
    }
    return groups;
  }, [groups, filter]);

  const displayedGroups = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return filteredByStatus;
    const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return filteredByStatus.filter((g) => pattern.test(`${g.casePublicId} ${g.caseName}`));
  }, [filteredByStatus, searchQuery]);

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
      {/* Search test cases */}
      <div className="relative flex items-center">
        <Search
          className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-fg-5"
          aria-hidden="true"
        />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search test cases..."
          aria-label="Search test cases"
          data-testid="case-list-search-input"
          className="h-8 w-full rounded-md border border-border bg-bg-elev-2 pl-8 pr-7 text-[11.5px] text-fg-1 placeholder:text-fg-5 transition-colors focus:border-accent focus:outline-none"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            data-testid="case-list-search-clear"
            className="absolute right-2 rounded p-0.5 text-fg-4 hover:text-fg-1"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>

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
        searchQuery.trim() ? (
          <div
            className="rounded-md border border-dashed border-border bg-bg-elev-1 p-4 text-center text-[12px] text-fg-4"
            data-testid="case-list-no-search-results"
          >
            No test cases matching &ldquo;{searchQuery}&rdquo;
          </div>
        ) : (
          <div
            className="rounded-md border border-border bg-bg-elev-1 p-4 text-[12px] text-fg-4"
            data-testid="case-list-no-failures"
          >
            No failed test cases in this run.
          </div>
        )
      ) : (
        <ul
          className="flex flex-col gap-1.5 max-h-[calc(100vh-210px)] overflow-y-auto pr-1"
          data-testid="case-list"
        >
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
                  {(() => {
                    const isLive =
                      runStatus === "RUNNING" ||
                      runStatus === "QUEUED" ||
                      g.rollup === "running" ||
                      g.rollup === "queued";
                    const hasRunningStep =
                      g.rollup === "running" ||
                      (isLive && g.steps.some((s) => s.outcome === "PENDING"));
                    const runningCount = hasRunningStep ? 1 : 0;
                    const queuedCount = isLive
                      ? Math.max(0, g.total - (g.passed + g.failed + runningCount))
                      : 0;

                    if (g.total === 0) {
                      if (g.rollup === "aborted") {
                        return <span className="text-red">Aborted</span>;
                      }
                      if (isLive) {
                        return <span className="text-fg-4">No steps defined · Queued</span>;
                      }
                      return <span className="text-fg-5">No steps defined · Skipped</span>;
                    }
                    if (
                      g.rollup === "queued" ||
                      (isLive && g.passed === 0 && g.failed === 0 && !hasRunningStep)
                    ) {
                      return <span className="text-fg-4">{g.total} steps · Queued</span>;
                    }
                    return (
                      <>
                        {g.total} steps
                        {g.passed > 0 ? <span> · {g.passed} passed</span> : null}
                        {g.failed > 0 ? <span className="text-red"> · {g.failed} failed</span> : null}
                        {isLive ? (
                          <>
                            {runningCount > 0 ? (
                              <span className="text-fg-3"> · {runningCount} running</span>
                            ) : null}
                            {queuedCount > 0 ? (
                              <span className="text-fg-5"> · {queuedCount} queued</span>
                            ) : null}
                          </>
                        ) : g.total > g.passed + g.failed ? (
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
                    );
                  })()}
                </span>
                <span className="ml-auto">{formatDuration(g.durationMs)}</span>
              </div>
              {(() => {
                const isLive =
                  runStatus === "RUNNING" ||
                  runStatus === "QUEUED" ||
                  g.rollup === "running" ||
                  g.rollup === "queued";
                const hasRunningStep =
                  g.rollup === "running" ||
                  (isLive && g.steps.some((s) => s.outcome === "PENDING"));
                const runningCount = hasRunningStep ? 1 : 0;
                const queuedCount = isLive
                  ? Math.max(0, g.total - (g.passed + g.failed + runningCount))
                  : 0;

                if (g.rollup === "aborted") {
                  return (
                    <ProgressBar
                      segments={[{ value: 100, variant: "fail", label: "Aborted" }]}
                      total={100}
                      className="mt-0.5 h-1"
                    />
                  );
                }
                if (g.rollup === "queued") {
                  return (
                    <ProgressBar
                      segments={[{ value: g.total, variant: "neutral", label: "Queued" }]}
                      total={g.total}
                      className="mt-0.5 h-1"
                    />
                  );
                }
                if (g.total > 0) {
                  return (
                    <ProgressBar
                      segments={[
                        { value: g.passed, variant: "pass", label: `${g.passed} passed` },
                        { value: g.failed, variant: "fail", label: `${g.failed} failed` },
                        ...(runningCount > 0
                          ? [
                              { value: runningCount, variant: "running" as const, label: "Running" },
                            ]
                          : []),
                        ...(isLive && queuedCount > 0
                          ? [
                              {
                                value: queuedCount,
                                variant: "neutral" as const,
                                label: `${queuedCount} queued`,
                              },
                            ]
                          : !isLive && g.total > g.passed + g.failed
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
                  );
                }
                return null;
              })()}
            </button>
          </li>
        );
      })}
    </ul>
  )}
</div>
  );
}
