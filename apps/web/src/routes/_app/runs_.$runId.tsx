import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Minimize2, RotateCw, Square } from "lucide-react";
import { useMemo, useState } from "react";

import { RerunSelectionDialog } from "@/components/runs/RerunSelectionDialog";
import { RunCaseExplorer } from "@/components/runs/RunCaseExplorer";
import { type CaseGroup } from "@/components/runs/case-grouping";
import { RunSummaryCard } from "@/components/runs/RunSummaryCard";
import { Button } from "@/components/ui/button";
import { useCancelRun, useRerunRun, type PlaywrightConfigInput } from "@/hooks/use-runs";
import { ApiError, fetchRun } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
        status === "PASS" || status === "FAIL" || status === "ERROR" || status === "CANCELLED";
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
  const failedCasesCount = dialogGroups.filter(
    (g) => g.rollup === "fail" || g.rollup === "aborted",
  ).length;
  const hasFailures =
    failedSteps > 0 || failedCasesCount > 0 || run?.status === "FAIL" || run?.status === "ERROR";
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
          }
        },
      },
    );
  };

  const targetCasePublicId = selectedCasePublicId ?? run?.cases?.[0]?.case_public_id;

  return (
    <section className="flex flex-col gap-4" data-testid="run-detail-page">
      <div className="flex justify-end">
        <div className="flex flex-wrap items-center gap-1.5">
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
            className={cn(hasFailures && "border-red/40 text-red hover:bg-red/10")}
            data-testid="run-rerun-button"
          >
            <RotateCw
              className={cn("mr-1.5 h-3.5 w-3.5", rerunMutation.isPending && "animate-spin")}
              aria-hidden="true"
            />
            {rerunMutation.isPending
              ? "Queuing…"
              : failedCount > 0
                ? `Re-run (${failedCount} failed)`
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

      {rerunForbidden ? (
        <div
          role="alert"
          data-testid="run-rerun-forbidden-banner"
          className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12px] text-red"
        >
          Re-running this run requires QA access. Ask an admin to grant it.
        </div>
      ) : null}

      {run?.status === "ERROR" || run?.errorMessage || run?.error_message ? (
        <div
          role="alert"
          data-testid="run-interrupted-banner"
          className="flex items-start gap-2.5 rounded-md border border-red/30 bg-red/10 px-3 py-2.5 text-[12px] text-red"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">Run was interrupted or failed</span>
            <span className="font-mono text-[11px] text-red/90">
              {run.errorMessage ||
                run.error_message ||
                "The run worker was interrupted or lost connection during processing. You can re-run the test cases above."}
            </span>
          </div>
        </div>
      ) : null}

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
