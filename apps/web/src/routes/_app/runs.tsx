import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  HelpCircle,
  ListChecks,
  Loader2,
  Maximize2,
  PlayCircle,
  Square,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Gated } from "@/components/gating/Gated";
import { RunCaseExplorer } from "@/components/runs/RunCaseExplorer";
import { RunsSkeleton } from "@/components/runs/skeleton";
import { CostChip } from "@/components/shared/CostChip";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { SourceDot } from "@/components/shared/SourceDot";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCancelRun,
  useRerunRun,
  useRun,
  useRunsInfiniteList,
  useRunsSummary,
} from "@/hooks/use-runs";
import { ApiError } from "@/lib/api-client";
import { buildRunSegments, runToBadge } from "@/lib/badge-maps";
import { formatDuration } from "@/lib/test-case-format";
import { cn } from "@/lib/utils";
interface SearchSchema {
  run?: string;
}

function SummaryBar(): React.ReactElement {
  const { data } = useRunsSummary();
  return (
    <section
      className="grid grid-cols-2 gap-x-3 gap-y-4 rounded-md border border-border bg-bg-elev-1 p-[14px] sm:grid-cols-3 xl:grid-cols-6"
      data-testid="runs-summary"
    >
      <Counter
        label="Active now"
        value={data.activeNow.toString()}
        accent
        tooltip="Test runs currently executing steps."
      />
      <Counter
        label="Today"
        value={data.today.toString()}
        tooltip="Test runs created since 00:00 UTC today."
      />
      <Counter
        label="Passed"
        value={data.passed.toString()}
        tooltip="Total passed test runs across this workspace (counts runs, not individual test cases). Older runs are available by scrolling the runs list."
      />
      <Counter
        label="Failed"
        value={data.failed.toString()}
        tooltip="Total failed or errored test runs across this workspace."
      />
      <Counter
        label="Avg duration"
        value={formatDuration(data.avgDurationMs)}
        tooltip="Average runtime duration across all completed runs."
      />
      <Counter
        label="Queue"
        value={data.queue.toString()}
        tooltip="Runs queued and waiting for an available runner worker."
      />
    </section>
  );
}

function Counter({
  label,
  value,
  accent,
  tooltip,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tooltip?: string;
}): React.ReactElement {
  const content = (
    <div className="flex flex-col gap-1 cursor-default" data-testid="runs-counter">
      <div className="flex items-center gap-1">
        <span className="text-[10.5px] uppercase tracking-wide text-fg-5">{label}</span>
        {tooltip ? (
          <HelpCircle
            className="h-3 w-3 text-fg-5 transition-colors hover:text-fg-3"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <span
        className={cn(
          "font-mono text-[18px] font-semibold tabular-nums",
          accent ? "text-accent" : "text-fg-1",
        )}
      >
        {value}
      </span>
    </div>
  );

  if (!tooltip) return content;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-[11px] leading-relaxed">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RunsList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (publicId: string) => void;
}): React.ReactElement {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useRunsInfiniteList(30);
  const runs = useMemo(() => data.pages.flatMap((page) => page.items), [data]);

  // Auto-select the first run on load when no URL param is present.
  useEffect(() => {
    if (!selectedId && runs.length > 0 && runs[0]) {
      onSelect(runs[0].public_id);
    }
  }, [selectedId, runs, onSelect]);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (
      !el ||
      !hasNextPage ||
      isFetchingNextPage ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchNextPage();
        }
      },
      { rootMargin: "100px" },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No runs yet"
        subtitle="Manual + CI runs appear here as they execute."
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1" data-testid="runs-list">
        {runs.map((r) => {
          const summary = r.summary;
          const total = summary?.total_steps ?? 0;
          const segments = buildRunSegments(r.status, summary);
          const badgeDesc = runToBadge(r.status, summary);
          return (
            <li key={r.id}>
              <button
                type="button"
                data-testid="runs-row"
                data-public-id={r.public_id}
                data-selected={r.public_id === selectedId ? "true" : "false"}
                onClick={() => {
                  onSelect(r.public_id);
                }}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-md border border-transparent px-2 py-2 text-left hover:bg-bg-elev-2",
                  r.public_id === selectedId && "border-border bg-bg-elev-2",
                )}
              >
                <div className="flex items-center gap-2 text-[12.5px]">
                  <SourceDot status={badgeDesc.status} />
                  <span className="truncate text-fg-1">{r.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] text-fg-5">
                  <span className="truncate">
                    {r.public_id} · {r.branch ?? "—"}
                    {r.commit_sha ? `@${r.commit_sha.slice(0, 7)}` : ""}
                  </span>
                  <span className="shrink-0">{formatDuration(r.duration_ms)}</span>
                </div>
                <ProgressBar segments={segments} total={total > 0 ? total : 100} />
              </button>
            </li>
          );
        })}
      </ul>
      {hasNextPage ? (
        <div ref={loadMoreRef} className="pt-2 text-center" data-testid="runs-load-more-container">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            className="w-full text-[11px] text-fg-3 hover:text-fg-1"
            data-testid="runs-load-more-button"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />
                Loading more runs…
              </>
            ) : (
              "Load more runs"
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RunDetailPanel({
  runId,
  onNavigateToRun,
}: {
  runId: string | null;
  onNavigateToRun: (publicId: string) => void;
}): React.ReactElement {
  const { data: run, isLoading, isError } = useRun(runId ?? undefined);
  const cancelMutation = useCancelRun();
  const rerunMutation = useRerunRun();
  const [selectedCasePublicId, setSelectedCasePublicId] = useState<string | null>(null);

  if (!runId) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Select a run"
        subtitle="Pick a run from the list to view logs, steps, and artifacts."
      />
    );
  }
  if (isLoading || !run) return <RunsSkeleton />;
  if (isError) {
    return <EmptyState icon={AlertTriangle} title="Couldn't load run" />;
  }

  const isLive = run.status === "RUNNING" || run.status === "QUEUED";
  const cancelDisabled = !isLive || cancelMutation.isPending;
  // Re-run is only meaningful for terminal runs — guard against double-queueing.
  const rerunDisabled = isLive || rerunMutation.isPending;

  const handleCancel = (): void => {
    cancelMutation.mutate(run.id);
  };
  const handleRerun = (): void => {
    rerunMutation.mutate(run.id, {
      onSuccess: (data) => {
        const targetPublicId = data.publicId || data.public_id;
        if (targetPublicId) {
          onNavigateToRun(targetPublicId);
        }
      },
    });
  };

  // VIEWER role can't cancel — the backend returns 403; surface a non-blocking
  // capability banner instead of swallowing the error.
  const cancelForbidden =
    cancelMutation.error instanceof ApiError && cancelMutation.error.status === 403;

  const targetCasePublicId = selectedCasePublicId ?? run.cases?.[0]?.case_public_id;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="run-detail">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {(() => {
            const badge = runToBadge(run.status, run.summary);
            return <StatusBadge status={badge.status} label={badge.label} />;
          })()}
          <span className="truncate font-mono text-[12px] text-fg-3">{run.public_id}</span>
          <span className="font-mono text-[11px] text-fg-5">via {run.trigger}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isLive ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={cancelDisabled}
              onClick={handleCancel}
              className="border-red/40 text-red hover:bg-red/10"
              data-testid="run-cancel-button"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              {cancelMutation.isPending ? "Cancelling…" : "Cancel run"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rerunDisabled}
            onClick={handleRerun}
            data-testid="run-rerun-button"
          >
            {rerunMutation.isPending ? "Queuing…" : "Re-run"}
          </Button>
          {targetCasePublicId ? (
            <Link
              to="/cases"
              search={{ case: targetCasePublicId }}
              className="inline-flex h-8 items-center rounded-md border border-border bg-bg-elev-1 px-2.5 text-[12.5px] font-medium text-fg-2 hover:bg-bg-elev-2 hover:text-fg-1"
              data-testid="run-edit-cases-link"
            >
              {run.cases && run.cases.length > 1 ? "Edit selected case" : "Edit case"}
            </Link>
          ) : null}
          <Link
            to="/runs/$runId"
            params={{ runId: run.public_id }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg-elev-1 px-2.5 text-[12.5px] font-medium text-fg-2 hover:bg-bg-elev-2 hover:text-fg-1"
            aria-label="Open full detail view"
            data-testid="run-open-full"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            Full view
          </Link>
        </div>
      </div>

      {cancelForbidden ? (
        <div
          role="alert"
          data-testid="run-cancel-forbidden-banner"
          className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12px] text-red"
        >
          Cancelling runs requires QA access. Ask an admin to grant it.
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <h3 className="break-words text-[18px] font-semibold leading-tight tracking-[-.01em] text-fg-1">
          {run.name}
        </h3>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-fg-4">
          <span>
            {run.branch ?? "—"}
            {run.commit_sha ? `@${run.commit_sha.slice(0, 7)}` : ""}
          </span>
          <span>env={run.env}</span>
          <span>duration={formatDuration(run.duration_ms)}</span>
          <span>tier={run.tier_at_runtime}</span>
        </div>
      </div>

      {/* Case-first evidence view (test cases → steps + Preview/Code/Logs/
          Artifacts), shared with the full-page run route. */}
      <RunCaseExplorer
        runId={run.id}
        status={run.status}
        plannedCases={run.cases}
        onSelectCasePublicId={setSelectedCasePublicId}
      />

      <footer className="flex justify-end" data-testid="run-cost-footer">
        <Gated
          feature="ai_conversation"
          fallback={<span className="font-mono text-[11px] text-fg-5">$0 · deterministic</span>}
        >
          <CostChip tokens={0} cost={0} provider="anthropic" toolCalls={0} />
        </Gated>
      </footer>
    </div>
  );
}

function RunsBody(): React.ReactElement {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const selected = search.run ?? null;

  return (
    <>
      <SummaryBar />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside
          className="min-w-0 rounded-md border border-border bg-bg-elev-1 p-2 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-96px)] lg:self-start lg:overflow-y-auto"
          data-testid="runs-left-pane"
        >
          <RunsList
            selectedId={selected}
            onSelect={(publicId) => {
              void navigate({ search: { run: publicId } });
            }}
          />
        </aside>
        <section
          className="min-w-0 rounded-md border border-border bg-bg-elev-1 p-[14px]"
          data-testid="runs-right-pane"
        >
          <RunDetailPanel
            runId={selected}
            onNavigateToRun={(publicId) => {
              void navigate({ search: { run: publicId } });
            }}
          />
        </section>
      </div>
    </>
  );
}

function RunsError({ reset }: { reset: () => void }): React.ReactElement {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Couldn't load runs"
      action={{ label: "Retry", onClick: reset }}
    />
  );
}

function RunsScreen(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4" data-testid="runs-screen">
      <header>
        <h2 className="text-[20px] font-semibold tracking-[-.01em] text-fg-1">{t("runs.title")}</h2>
      </header>
      <ErrorBoundary fallback={({ reset }) => <RunsError reset={reset} />}>
        <Suspense fallback={<RunsSkeleton />}>
          <RunsBody />
        </Suspense>
      </ErrorBoundary>
    </section>
  );
}

export const Route = createFileRoute("/_app/runs")({
  component: RunsScreen,
  staticData: { title: "Test Runs" },
  validateSearch: (search: Record<string, unknown>): SearchSchema => {
    const raw = search["run"];
    return typeof raw === "string" ? { run: raw } : {};
  },
});
