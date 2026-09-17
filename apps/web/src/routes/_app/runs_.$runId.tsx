import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Minimize2, RotateCw, Square } from "lucide-react";
import { useMemo, useState } from "react";

import { RerunSelectionDialog } from "@/components/runs/RerunSelectionDialog";
import { RunCaseExplorer } from "@/components/runs/RunCaseExplorer";
import { RunInterruptedBanner } from "@/components/runs/RunInterruptedBanner";
import { type CaseGroup } from "@/components/runs/case-grouping";
import { RunSummaryCard } from "@/components/runs/RunSummaryCard";
import { WakeLockIndicator } from "@/components/runs/WakeLockIndicator";
import { Button } from "@/components/ui/button";
import { useCancelRun, useRerunRun, type PlaywrightConfigInput } from "@/hooks/use-runs";
import { ApiError, fetchRun } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/runs_/$runId")({
  component: RunDetailPage,
  staticData: { title: "Run detail" },
});

export function RunDetailPage(): React.ReactElement {
  const { runId } = Route.useParams();
  const navigate = useNavigate();
  const rerunMutation = useRerunRun();
  const cancelMutation = useCancelRun();
  const [rerunForbidden, setRerunForbidden] = useState(false);
  const [rerunDialogOpen, setRerunDialogOpen] = useState(false);
  const [explorerGroups, setExplorerGroups] = useState<CaseGroup[]>([]);
  const [selectedCasePublicId, setSelectedCasePublicId] = useState<string | null>(null);

  const { data: run } = useQuery({
    queryKey: ["run", runId] as const,
    queryFn: () => fetchRun(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const terminal =
        status === "PASS" ||
        status === "FAIL" ||
        status === "ERROR" ||
        status === "CANCELLED" ||
        status === "INTERRUPTED";
      return terminal ? false : 2000;
    },
  });

  const fallbackGroups: CaseGroup[] = useMemo(() => {
    return (run?.cases ?? []).map((c) => ({
      caseId: c.case_id,
      casePublicId: c.case_public_id,
      caseName: c.case_title || c.case_public_id,
      steps: [],
      total: c.total_steps ?? 0,
      passed: 0,
      failed: 0,
      rollup: "neutral" as const,
      durationMs: 0,
      kind: "frontend" as const,
      firstFailure: null,
    }));
  }, [run?.cases]);

  // Same guard as the /runs side panel: a live run cannot be re-queued.
  const isLive = run?.status === "RUNNING" || run?.status === "QUEUED";
  const cancelDisabled = run === undefined || !isLive || cancelMutation.isPending;
  const rerunDisabled = run === undefined || isLive || rerunMutation.isPending;

  const dialogGroups = explorerGroups.length > 0 ? explorerGroups : fallbackGroups;
  const failedSteps = run?.summary?.failed_steps ?? 0;
  const actualFailedCasesCount = dialogGroups.filter((g) => g.rollup === "fail").length;
  const abortedCasesCount = dialogGroups.filter((g) => g.rollup === "aborted").length;
  const failedCasesCount = actualFailedCasesCount + abortedCasesCount;
  const hasActualFailures = failedSteps > 0 || actualFailedCasesCount > 0;
  const hasAbortedOnly = !hasActualFailures && abortedCasesCount > 0;
  const failedCount = failedCasesCount > 0 ? failedCasesCount : failedSteps;

  const handleCancel = (): void => {
    if (run === undefined) return;
    cancelMutation.mutate(run.id);
  };

  const handleConfirmRerun = (selectedCaseIds: string[], config?: PlaywrightConfigInput): void => {
    if (run === undefined) return;
    rerunMutation.mutate(
      {
        runId: run.id,
        caseIds: selectedCaseIds.length > 0 ? selectedCaseIds : undefined,
        playwrightConfig: config,
      },
      {
        onSuccess: (data) => {
          setRerunDialogOpen(false);
          const targetId = data.publicId || data.public_id || data.id;
          void navigate({ to: "/runs/$runId", params: { runId: targetId } });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 403) {
            setRerunForbidden(true);
          } else {
            toast.error(err.message || "Failed to trigger re-run");
          }
        },
      },
    );
  };

  const handleRerunCase = (caseId: string): void => {
    if (run === undefined) return;
    const runConfig = run.playwrightConfig ?? undefined;
    rerunMutation.mutate(
      { runId: run.id, caseIds: [caseId], playwrightConfig: runConfig },
      {
        onSuccess: (data) => {
          const targetId = data.publicId || data.public_id || data.id;
          void navigate({ to: "/runs/$runId", params: { runId: targetId } });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 403) {
            setRerunForbidden(true);
          } else {
            toast.error(err.message || "Failed to trigger re-run");
          }
        },
      },
    );
  };

  const targetCasePublicId = selectedCasePublicId ?? run?.cases?.[0]?.case_public_id;

  return (
    <section className="flex flex-col gap-4" data-testid="run-detail-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <WakeLockIndicator
            isLive={isLive}
            preventSleep={
              (run?.playwrightConfig as { preventSleep?: boolean; prevent_sleep?: boolean } | null | undefined)?.preventSleep ??
              (run?.playwrightConfig as { preventSleep?: boolean; prevent_sleep?: boolean } | null | undefined)?.prevent_sleep ??
              true
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          <Link
            to="/runs"
            search={{ run: run?.public_id ?? runId }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-bg-elev-1 px-2.5 text-[12.5px] font-medium text-fg-2 hover:bg-bg-elev-2 hover:text-fg-1"
            aria-label="Minimize to runs list"
            data-testid="run-minimize"
          >
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            Minimize
          </Link>
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
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
              {cancelMutation.isPending ? "Aborting…" : "Abort run"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={rerunDisabled}
            onClick={() => setRerunDialogOpen(true)}
            className={cn(
              hasActualFailures && "border-red/40 text-red hover:bg-red/10",
              hasAbortedOnly && "border-amber-500/40 text-amber-500 hover:bg-amber-500/10",
            )}
            data-testid="run-rerun-button"
          >
            <RotateCw
              className={cn("mr-1.5 h-3.5 w-3.5", rerunMutation.isPending && "animate-spin")}
              aria-hidden="true"
            />
            {rerunMutation.isPending
              ? "Queuing…"
              : hasActualFailures
                ? `Re-run (${failedCount} failed)`
                : hasAbortedOnly
                  ? `Resume (${abortedCasesCount} remaining)`
                  : "Re-run"}
          </Button>
          <Link
            to="/cases"
            search={targetCasePublicId ? { case: targetCasePublicId } : {}}
            className="inline-flex h-8 items-center rounded-md border border-border bg-bg-elev-1 px-2.5 text-[12.5px] font-medium text-fg-2 hover:bg-bg-elev-2 hover:text-fg-1"
            data-testid="run-edit-cases-link"
          >
            {run?.cases && run.cases.length > 1 ? "Edit selected case" : "Edit case"}
          </Link>
          <Link
            to="/runs/$runId/replay"
            params={{ runId }}
            className="inline-flex h-8 items-center rounded-md border border-border bg-bg-elev-1 px-2.5 text-[12.5px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
            data-testid="run-replay-link"
          >
            ⏱ Time-travel replay
          </Link>
        </div>
      </div>

      {run?.status === "INTERRUPTED" ? (
        <div
          role="alert"
          data-testid="run-interrupted-banner"
          className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-500 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <strong className="font-semibold">Run Interrupted:</strong>{" "}
              <span>
                Execution was interrupted before all steps finished (connection dropped, laptop slept, or runner stopped).
              </span>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-500/40 text-amber-500 hover:bg-amber-500/20"
            onClick={() => setRerunDialogOpen(true)}
          >
            Resume Remaining
          </Button>
        </div>
      ) : null}

      {rerunForbidden ? (
        <div
          role="alert"
          data-testid="run-rerun-forbidden-banner"
          className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12px] text-red"
        >
          Re-running this run requires QA access. Ask an admin to grant it.
        </div>
      ) : null}

      <RunInterruptedBanner
        status={run?.status}
        errorMessage={run?.errorMessage || run?.error_message}
      />

      <RunSummaryCard run={run} />

      {/* TEST CASE master-detail — the primary run view (shared with the panel). */}
      <RunCaseExplorer
        runId={runId}
        status={run?.status}
        plannedCases={run?.cases}
        playwrightConfig={run?.playwrightConfig ?? null}
        onSelectCasePublicId={setSelectedCasePublicId}
        onGroupsChange={setExplorerGroups}
        onRerunCase={handleRerunCase}
        isRerunning={rerunMutation.isPending}
      />

      {run ? (
        <RerunSelectionDialog
          open={rerunDialogOpen}
          onOpenChange={setRerunDialogOpen}
          runPublicId={run.public_id}
          groups={dialogGroups}
          onConfirm={handleConfirmRerun}
          isPending={rerunMutation.isPending}
          initialSettings={run.playwrightConfig ?? null}
        />
      ) : null}
    </section>
  );
}
