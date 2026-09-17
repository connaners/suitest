import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, ListChecks } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CaseDetailPanel } from "@/components/runs/CaseDetailPanel";
import { CaseList } from "@/components/runs/CaseList";
import { groupStepsByCase, type CaseGroup } from "@/components/runs/case-grouping";
import { EmptyState } from "@/components/shared/EmptyState";
import { fetchRunArtifacts, fetchRunSteps } from "@/lib/api-client";
import type { PlaywrightConfigInput } from "@/hooks/use-runs";
import type { components } from "@/lib/api-types";
import { useRunStream } from "@/lib/ws-client";

type RunStatus = components["schemas"]["RunStatus"];
type RunCaseSummary = components["schemas"]["RunCaseSummary"];

interface RunCaseExplorerProps {
  /** Run id OR public_id — the endpoints resolve either. */
  runId: string;
  /** Run status, when the caller already has it — drives polling + empty copy. */
  status?: RunStatus | undefined;
  /** Planned cases configured for this run (M1-15b). */
  plannedCases?: RunCaseSummary[] | undefined;
  /** Execution settings (Playwright configuration) used for this run. */
  playwrightConfig?: PlaywrightConfigInput | null | undefined;
  /** Emitted whenever the focused test case changes (returns public_id like "TC-101"). */
  onSelectCasePublicId?: (publicId: string | null) => void;
  /** Emitted whenever the grouped test cases change. */
  onGroupsChange?: (groups: CaseGroup[]) => void;
  /** Trigger a rerun for a single test case. */
  onRerunCase?: (caseId: string) => void;
  /** True while a rerun mutation is in flight. */
  isRerunning?: boolean;
}

/** Once a run reaches one of these, no further steps can appear. */
function isTerminal(status: RunStatus | undefined): boolean {
  return (
    status === "PASS" ||
    status === "FAIL" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "INTERRUPTED"
  );
}

/**
 * The TEST-CASE master-detail for a run: the flat step list is grouped into
 * test cases (left), and the selected case shows its steps + evidence tabs
 * (Preview/Code/Logs/Artifacts) on the right — TestSprite-style, NOT a raw step
 * dump. Shared by the full-page run route AND the /runs side panel so both give
 * the same video/code/screenshot experience.
 */
export function RunCaseExplorer({
  runId,
  status,
  plannedCases,
  playwrightConfig,
  onSelectCasePublicId,
  onGroupsChange,
  onRerunCase,
  isRerunning,
}: RunCaseExplorerProps): React.ReactElement {
  const terminalRetriesRef = useRef<number>(0);
  const prevRunIdRef = useRef<string>(runId);
  const prevStatusRef = useRef<RunStatus | undefined>(status);

  // Poll until the run is terminal. The WS refetch below is the fast path, but
  // local mode publishes to a NullPublisher — no event ever reaches the browser,
  const { data: stepsData, refetch: refetchSteps } = useQuery({
    queryKey: ["run-steps", runId] as const,
    queryFn: () => fetchRunSteps(runId),
    refetchInterval: (query) => {
      if (!isTerminal(status)) return 1500;
      const items = query.state.data?.items ?? [];
      const hasMissing =
        status !== "CANCELLED" &&
        status !== "INTERRUPTED" &&
        plannedCases !== undefined &&
        plannedCases.length > 0 &&
        plannedCases.some((pc) => {
          const stepsCount = pc.total_steps ?? 0;
          return stepsCount > 0 && !items.some((s) => s.case_id === pc.case_id);
        });
      if (hasMissing && terminalRetriesRef.current < 2) {
        terminalRetriesRef.current += 1;
        return 1500;
      }
      return false;
    },
  });
  const { data: artifactsData, refetch: refetchArtifacts } = useQuery({
    queryKey: ["run-artifacts", runId] as const,
    queryFn: () => fetchRunArtifacts(runId),
    refetchInterval: () => (!isTerminal(status) ? 1500 : false),
  });

  const steps = useMemo(() => stepsData?.items ?? [], [stepsData]);
  const artifacts = useMemo(() => artifactsData?.items ?? [], [artifactsData]);

  useEffect(() => {
    const runChanged = prevRunIdRef.current !== runId;
    prevRunIdRef.current = runId;
    const wasTerminal = isTerminal(prevStatusRef.current);
    const nowTerminal = isTerminal(status);
    prevStatusRef.current = status;
    if (!nowTerminal) {
      terminalRetriesRef.current = 0;
    }
    if (runChanged || (!wasTerminal && nowTerminal)) {
      void refetchSteps();
      void refetchArtifacts();
    }
  }, [runId, status, refetchSteps, refetchArtifacts]);

  const groups = useMemo(
    () => groupStepsByCase(steps, artifacts, plannedCases, status),
    [steps, artifacts, plannedCases, status],
  );

  useEffect(() => {
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange]);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedCaseId(null);
  }, [runId]);

  // Default to the first FAILED case (triage-first), else the first case — once,
  // never overriding an explicit user pick.
  useEffect(() => {
    const first = groups[0];
    if (!first) return;
    setSelectedCaseId((cur) => {
      if (cur && groups.some((g) => g.caseId === cur)) return cur;
      const failing = groups.find((g) => g.rollup === "fail");
      return (failing ?? first).caseId;
    });
  }, [groups]);

  useRunStream(runId, (e) => {
    if (
      e.event === "run.step.started" ||
      e.event === "run.step.completed" ||
      e.event === "run.completed"
    ) {
      void refetchSteps();
      void refetchArtifacts();
    }
  });

  const selectedGroup = useMemo(
    () => groups.find((g) => g.caseId === selectedCaseId) ?? null,
    [groups, selectedCaseId],
  );

  const selectedCasePublicId = selectedGroup?.casePublicId ?? null;
  useEffect(() => {
    onSelectCasePublicId?.(selectedCasePublicId);
  }, [selectedCasePublicId, onSelectCasePublicId]);

  if (groups.length === 0) {
    // Distinguish "hasn't run yet" from "ran and produced nothing" — the old
    // single message read as data loss whenever a run was merely queued.
    if (status === "QUEUED") {
      return (
        <EmptyState
          icon={ListChecks}
          title="Queued"
          subtitle="Waiting for a runner to pick this run up."
        />
      );
    }
    if (status === "RUNNING") {
      return (
        <EmptyState
          icon={ListChecks}
          title="Running"
          subtitle="Test cases appear here as their steps complete."
        />
      );
    }
    if (status === "INTERRUPTED") {
      return (
        <EmptyState
          icon={AlertCircle}
          title="Run Interrupted"
          subtitle="Connection or execution was abruptly interrupted before steps could be recorded."
        />
      );
    }
    if (status === "CANCELLED") {
      return (
        <EmptyState
          icon={AlertCircle}
          title="Run Aborted"
          subtitle="This run was cancelled before executing any steps."
        />
      );
    }
    if (status === "ERROR") {
      return (
        <EmptyState
          icon={AlertTriangle}
          title="Run interrupted or errored"
          subtitle="This run encountered an error or was interrupted before test cases completed."
        />
      );
    }
    return (
      <EmptyState
        icon={ListChecks}
        title="No test cases recorded"
        subtitle="This run finished without executing any steps."
      />
    );
  }

  return (
    // Container query (not viewport): the explorer renders both full-page and
    // inside the /runs side panel, so column split keys off its own width.
    <div className="grid min-w-0 grid-cols-12 items-start gap-4 @container">
      <div className="col-span-12 min-w-0 @3xl:sticky @3xl:top-4 self-start @3xl:col-span-4" data-testid="run-case-master">
        <CaseList
          groups={groups}
          selectedCaseId={selectedCaseId}
          onSelectCase={setSelectedCaseId}
          runStatus={status}
        />
      </div>
      <div className="col-span-12 min-w-0 @3xl:col-span-8" data-testid="run-case-detail">
        {selectedGroup ? (
          <CaseDetailPanel
            runId={runId}
            group={selectedGroup}
            artifacts={artifacts}
            runStatus={status}
            onRerunCase={onRerunCase}
            isRerunning={isRerunning}
            hasMultipleCases={groups.length > 1}
            playwrightConfig={playwrightConfig}
          />
        ) : (
          <EmptyState
            icon={ListChecks}
            title="No test case selected"
            subtitle="Pick a test case from the list to see its steps and evidence."
          />
        )}
      </div>
    </div>
  );
}
