import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Square } from "lucide-react";
import { useState } from "react";

import { RunCaseExplorer } from "@/components/runs/RunCaseExplorer";
import { RunSummaryCard } from "@/components/runs/RunSummaryCard";
import { Button } from "@/components/ui/button";
import { useCancelRun, useRerunRun } from "@/hooks/use-runs";
import { ApiError, fetchRun } from "@/lib/api-client";

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

  // Same guard as the /runs side panel: a live run cannot be re-queued.
  const isLive = run?.status === "RUNNING" || run?.status === "QUEUED";
  const cancelDisabled = !isLive || cancelMutation.isPending;
  const rerunDisabled = run === undefined || isLive || rerunMutation.isPending;

  const handleCancel = (): void => {
    if (run === undefined) return;
    cancelMutation.mutate(run.id);
  };

  const handleRerun = (): void => {
    if (run === undefined) return;
    rerunMutation.mutate(run.id, {
      onSuccess: (data) => {
        const targetId = data.publicId || data.public_id || data.id;
        void navigate({ to: "/runs/$runId", params: { runId: targetId } });
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 403) {
          setRerunForbidden(true);
        }
      },
    });
  };
  const [selectedCasePublicId, setSelectedCasePublicId] = useState<string | null>(null);
  const targetCasePublicId = selectedCasePublicId ?? run?.cases?.[0]?.case_public_id;

  return (
    <section className="flex flex-col gap-4" data-testid="run-detail-page">
      <div className="flex justify-end">
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
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
              {cancelMutation.isPending ? "Aborting…" : "Abort run"}
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

      <RunSummaryCard run={run} />

      {/* TEST CASE master-detail — the primary run view (shared with the panel). */}
      <RunCaseExplorer
        runId={runId}
        status={run?.status}
        plannedCases={run?.cases}
        onSelectCasePublicId={setSelectedCasePublicId}
      />
    </section>
  );
}
