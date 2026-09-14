import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, Camera, Download, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cleanErrorMessage, classifyError } from "@/lib/error-formatter";
import {
  ApiError,
  fetchRunLogs,
  fetchRunSignedUrl,
  fetchTestCaseCode,
  fetchTestCaseDescription,
  fetchTestCaseSteps,
} from "@/lib/api-client";
import { useRunArtifactUrl } from "@/hooks/use-run-artifact-url";
import type { components } from "@/lib/api-types";
import { formatDuration } from "@/lib/test-case-format";
import { cn } from "@/lib/utils";

import { ScreenshotDiffViewer } from "./ScreenshotDiffViewer";

import { rollupLabel, rollupToBadge, type CaseGroup } from "./case-grouping";
import { StepTable, type DisplayStep, type StepDisplayOutcome } from "./StepTable";

type ArtifactPublic = components["schemas"]["ArtifactPublic"];
type RunStatus = components["schemas"]["RunStatus"];

interface CaseDetailPanelProps {
  runId: string;
  group: CaseGroup;
  /** All of the run's artifacts (filtered to this case internally). */
  artifacts: ArtifactPublic[];
  runStatus?: RunStatus | undefined;
  onRerunCase?: ((caseId: string) => void) | undefined;
  isRerunning?: boolean | undefined;
  hasMultipleCases?: boolean | undefined;
}

/**
 * TestSprite-style detail for a single test case within a run. Shows Basics,
 * a Description, a Result summary, the case's Steps (filtered), and a
 * Preview | Code | Logs | Artifacts tab strip. Backend/api cases have no
 * media, so Preview + Artifacts degrade to empty states gracefully.
 */
export function CaseDetailPanel({
  runId,
  group,
  artifacts,
  runStatus,
  onRerunCase,
  isRerunning,
  hasMultipleCases = true,
}: CaseDetailPanelProps): React.ReactElement {
  const stepIds = useMemo(() => new Set(group.steps.map((s) => s.id)), [group.steps]);

  // Only the artifacts produced by THIS case's steps.
  const caseArtifacts = useMemo(
    () => artifacts.filter((a) => stepIds.has(a.run_step_id)),
    [artifacts, stepIds],
  );

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [stepShotUrl, setStepShotUrl] = useState<string | null>(null);

  // Reset transient preview state when the user switches to another case.
  useEffect(() => {
    setSelectedStepId(null);
    setStepShotUrl(null);
  }, [group.caseId]);

  // Resolve the case's VIDEO artifact for the Preview tab (frontend cases only).
  const videoArtifactId = caseArtifacts.find((artifact) => artifact.kind === "VIDEO")?.id ?? null;
  const videoUrl = useRunArtifactUrl(runId, videoArtifactId);

  // Resolve the selected step's SCREENSHOT for the per-step preview.
  useEffect(() => {
    if (selectedStepId === null) {
      setStepShotUrl(null);
      return;
    }
    const shot = caseArtifacts.find(
      (a) => a.kind === "SCREENSHOT" && a.run_step_id === selectedStepId,
    );
    if (!shot) {
      setStepShotUrl(null);
      return;
    }
    let cancelled = false;
    void fetchRunSignedUrl(runId, shot.id).then((signed) => {
      if (!cancelled) setStepShotUrl(signed.url);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStepId, caseArtifacts, runId]);

  const { data: code } = useQuery({
    queryKey: ["case-detail-code", group.caseId] as const,
    queryFn: () => fetchTestCaseCode(group.caseId),
  });
  const { data: description, error: descError } = useQuery({
    queryKey: ["case-detail-desc", group.caseId] as const,
    queryFn: () => fetchTestCaseDescription(group.caseId),
    retry: false,
  });
  const isCaseDeleted = Boolean(
    group.isDeleted ||
      (descError instanceof ApiError
        ? descError.status === 404
        : (descError as { status?: number } | null)?.status === 404),
  );

  const isLive = runStatus === "RUNNING" || runStatus === "QUEUED";
  const isCaseHalted =
    group.rollup === "fail" ||
    group.rollup === "aborted" ||
    runStatus === "CANCELLED" ||
    runStatus === "FAIL" ||
    runStatus === "ERROR";

  const shouldFetchPlanned =
    isLive || group.rollup === "aborted" || group.steps.length < group.total;

  const { data: plannedSteps } = useQuery({
    queryKey: ["case-planned-steps", group.caseId] as const,
    queryFn: () => fetchTestCaseSteps(group.caseId),
    enabled: shouldFetchPlanned && !isCaseDeleted,
  });

  const isZeroSteps =
    group.total === 0 ||
    (isLive && Array.isArray(plannedSteps) && plannedSteps.length === 0);

  const displaySteps = useMemo<DisplayStep[]>(() => {
    if (isZeroSteps) {
      return [];
    }

    // Terminal Run Freeze Guard: For completed normal runs where all steps executed and passed,
    // use recorded executed steps directly.
    if (!isLive && group.rollup !== "aborted" && group.steps.length >= group.total && group.total > 0) {
      return group.steps;
    }

    const sortedExec = [...group.steps].sort((a, b) => a.step_order - b.step_order);

    if (Array.isArray(plannedSteps) && plannedSteps.length > 0) {
      const sortedPlanned = [...plannedSteps]
        .sort((a, b) => a.order - b.order)
        .slice(0, group.total > 0 ? group.total : undefined);

      const result: DisplayStep[] = [];
      let activeFound = false;

      sortedPlanned.forEach((ps, idx) => {
        const exec = idx < sortedExec.length ? sortedExec[idx] : null;
        if (exec) {
          result.push({
            ...exec,
            title: exec.title || ps.action,
            type: exec.type || (ps.target_kind ? ps.target_kind.toLowerCase() : "action"),
          });
        } else {
          let outcome: StepDisplayOutcome = "QUEUED";
          let errorMessage: string | null = null;

          if (isLive) {
            if (group.rollup === "running") {
              if (!activeFound) {
                outcome = "RUNNING";
                activeFound = true;
              } else {
                outcome = "QUEUED";
              }
            } else if (group.rollup === "queued") {
              outcome = "QUEUED";
            } else if (isCaseHalted) {
              outcome = "ABORTED";
              errorMessage = "Step was aborted because a prior step in this run failed.";
            } else {
              outcome = "QUEUED";
            }
          } else {
            outcome = "ABORTED";
            errorMessage =
              runStatus === "CANCELLED"
                ? "Step was not executed because the test run was cancelled by user."
                : "Step was aborted because a prior step in this run failed.";
          }

          result.push({
            id: `planned-${ps.id}`,
            case_id: group.caseId,
            step_order: ps.order,
            title: ps.action,
            type: ps.target_kind ? ps.target_kind.toLowerCase() : "action",
            outcome,
            duration_ms: null,
            error_message: errorMessage,
            stdout: null,
            isPlannedOnly: true,
          });
        }
      });

      if (sortedExec.length > sortedPlanned.length) {
        result.push(...sortedExec.slice(sortedPlanned.length));
      }

      return result;
    }

    // If plannedSteps is not available (e.g. case deleted or aborted before execution),
    // synthesize unexecuted aborted rows up to group.total
    if (group.total > sortedExec.length) {
      const result: DisplayStep[] = [...sortedExec];
      const unexecutedCount = group.total - sortedExec.length;
      for (let i = 0; i < unexecutedCount; i++) {
        const stepNum = sortedExec.length + i + 1;
        result.push({
          id: `unexecuted-${group.caseId}-${stepNum}`,
          case_id: group.caseId,
          step_order: stepNum,
          title: `Step ${stepNum} (Unexecuted)`,
          type: "action",
          outcome: "ABORTED",
          duration_ms: null,
          error_message:
            runStatus === "CANCELLED"
              ? "Step was not executed because the test run was cancelled by user."
              : "Step was aborted because a prior step in this run failed.",
          stdout: null,
          isPlannedOnly: true,
        });
      }
      return result;
    }

    return sortedExec;
  }, [group, plannedSteps, isZeroSteps, isLive, isCaseHalted, runStatus]);

  const selectedStepLabel = useMemo(() => {
    const idx = displaySteps.findIndex((x) => x.id === selectedStepId);
    return idx >= 0 ? `Step ${(idx + 1).toString()}` : null;
  }, [displaySteps, selectedStepId]);

  const { data: logPage } = useQuery({
    queryKey: ["run-logs", runId] as const,
    queryFn: () => fetchRunLogs(runId),
  });
  const logItems = logPage?.items ?? [];

  const errorClassification = useMemo(
    () => (group.firstFailure ? classifyError(group.firstFailure) : null),
    [group.firstFailure],
  );

  const resultSummary =
    isZeroSteps
      ? "Empty test case — no test steps configured (skipped)."
      : group.rollup === "queued"
        ? "Queued — waiting for runner to execute this case."
        : group.rollup === "aborted"
          ? "Aborted — execution stopped before this case completed."
          : group.rollup === "skipped"
            ? "Skipped — no test steps were executed for this case."
            : errorClassification?.isEnvironmentError
              ? `Environment error: ${errorClassification.title} (${group.passed.toString()}/${group.total.toString()} steps completed)`
              : group.rollup === "fail" && group.firstFailure
                ? cleanErrorMessage(group.firstFailure)
                : `${group.passed.toString()}/${group.total.toString()} steps passed`;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="case-detail">
      {/* Basics */}
      <div className="flex flex-col gap-2 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={rollupToBadge(group.rollup)} label={rollupLabel(group.rollup)} />
          <span className="font-mono text-[11px] text-fg-5">{group.casePublicId}</span>
          {isCaseDeleted ? (
            <span
              className="rounded bg-amber/10 px-1.5 py-0.5 text-[10.5px] font-medium text-amber"
              data-testid="case-deleted-badge"
            >
              Deleted case
            </span>
          ) : null}
          {!isLive && !isCaseDeleted && hasMultipleCases && onRerunCase ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isRerunning}
              onClick={() => onRerunCase(group.caseId)}
              className="h-6 gap-1 px-2 text-[11px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
              data-testid="case-rerun-button"
            >
              <RotateCw className={cn("h-3 w-3", isRerunning && "animate-spin")} aria-hidden="true" />
              {isRerunning ? "Queuing…" : "Re-run case"}
            </Button>
          ) : null}
          <span
            className="rounded bg-bg-elev-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-fg-4"
            data-testid="case-kind-badge"
          >
            {group.kind}
          </span>
          <span className="ml-auto font-mono text-[11px] text-fg-4 tabular-nums">
            {formatDuration(group.durationMs)}
          </span>
        </div>
        <h3
          className="break-words text-[15px] font-semibold leading-tight tracking-[-.01em] text-fg-1"
          data-testid="case-detail-title"
        >
          {group.caseName}
        </h3>
        {description && description.trim().length > 0 ? (
          <p
            className="text-[12px] leading-relaxed text-fg-3"
            data-testid="case-detail-description"
          >
            {description}
          </p>
        ) : null}
        <p className="text-[12px] text-fg-4" data-testid="case-result-summary">
          {resultSummary}
        </p>
        {isCaseDeleted ? (
          <div
            className="flex items-center gap-2 rounded-md bg-bg-elev-2 px-3 py-2 text-[11.5px] text-fg-3 border border-border mt-1"
            data-testid="case-deleted-banner"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber" aria-hidden="true" />
            <span>
              Historical snapshot: This test case is deleted from the workspace. Steps and results below reflect the original execution record.
            </span>
          </div>
        ) : null}
      </div>

      {errorClassification?.isEnvironmentError ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-red/30 bg-red/[0.08] p-3.5 text-[12.5px]"
          data-testid="environment-error-callout"
        >
          <div className="flex items-center gap-2 font-medium text-red">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red" aria-hidden="true" />
            <span>Runner Environment Issue: {errorClassification.title}</span>
          </div>
          <p className="font-mono text-[11.5px] leading-relaxed text-fg-2">
            {cleanErrorMessage(group.firstFailure)}
          </p>
          {errorClassification.hint ? (
            <p className="text-[11.5px] leading-relaxed text-fg-4">
              💡 <strong className="text-fg-3">Diagnosis:</strong> {errorClassification.hint}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Steps */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10.5px] uppercase tracking-wide text-fg-5">Steps</span>
        {isZeroSteps ? (
          <div
            className="flex flex-col gap-2 rounded-md border border-amber/30 bg-amber/[0.06] p-4 text-[12.5px]"
            data-testid="step-table-empty"
          >
            <div className="flex items-center gap-2 font-medium text-amber">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>No test steps configured</span>
            </div>
            <p className="leading-relaxed text-fg-3">
              This test case does not contain any executable steps yet. It was automatically skipped during this run.
            </p>
            <div>
              <Link
                to="/cases"
                search={{ case: group.casePublicId }}
                className="inline-flex items-center gap-1.5 font-medium text-accent underline-offset-2 hover:underline"
                data-testid="add-steps-link"
              >
                Add steps in Test Case Editor →
              </Link>
            </div>
          </div>
        ) : displaySteps.length === 0 ? (
          <div
            className="rounded-md border border-border bg-bg-elev-1 p-3 text-[12px] text-fg-4"
            data-testid="step-table-empty"
          >
            {group.rollup === "aborted"
              ? "This test case was aborted before execution started."
              : group.rollup === "skipped"
                ? "No test steps were executed for this test case."
                : "This test case is queued and has not started executing yet."}
          </div>
        ) : (
          <StepTable
            steps={displaySteps}
            selectedStepId={selectedStepId}
            onSelectStep={(stepId) => {
              setSelectedStepId((prev) => (prev === stepId ? null : stepId));
            }}
          />
        )}
      </div>

      {/* Evidence tabs */}
      <CaseEvidenceTabs
        code={code ?? null}
        videoUrl={videoUrl}
        stepScreenshotUrl={stepShotUrl}
        stepLabel={selectedStepLabel}
        onClearStep={() => {
          setSelectedStepId(null);
        }}
        logs={logItems}
        artifacts={caseArtifacts}
        runId={runId}
        caseId={group.caseId}
        isEmptyCase={isZeroSteps}
      />
    </div>
  );
}

interface CaseEvidenceTabsProps {
  code: string | null;
  videoUrl: string | null;
  stepScreenshotUrl: string | null;
  stepLabel: string | null;
  onClearStep: () => void;
  logs: components["schemas"]["RunLogItem"][];
  artifacts: ArtifactPublic[];
  runId: string;
  caseId: string;
  isEmptyCase?: boolean;
}

function CaseEvidenceTabs({
  code,
  videoUrl,
  stepScreenshotUrl,
  stepLabel,
  onClearStep,
  logs,
  artifacts,
  runId,
  caseId,
  isEmptyCase,
}: CaseEvidenceTabsProps): React.ReactElement {
  const [tab, setTab] = useState("preview");
  const showStep = Boolean(stepScreenshotUrl);

  return (
    <Tabs value={tab} onValueChange={setTab} data-testid="case-evidence-tabs">
      <TabsList variant="line">
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="code">Code</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        <TabsTrigger value="diff">Diff</TabsTrigger>
      </TabsList>

      <TabsContent value="preview">
        <div className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-3">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-fg-4">
            <span className="ml-auto">
              {showStep ? `Preview: ${stepLabel ?? "step"}` : videoUrl ? "video" : "no preview"}
            </span>
            {showStep ? (
              <button
                type="button"
                onClick={onClearStep}
                aria-label="Back to case video"
                data-testid="case-preview-clear-step"
                className="rounded p-0.5 text-fg-4 hover:bg-bg-elev-2 hover:text-fg-1"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="flex h-[280px] items-center justify-center overflow-hidden rounded-md bg-bg-code text-[12px] text-fg-5">
            {showStep && stepScreenshotUrl ? (
              <img
                src={stepScreenshotUrl}
                alt={stepLabel ? `${stepLabel} screenshot` : "Step screenshot"}
                data-testid="case-preview-step-image"
                className="max-h-full max-w-full object-contain"
              />
            ) : videoUrl ? (
              <video
                src={videoUrl}
                controls
                data-testid="case-preview-video"
                className="max-h-full max-w-full"
              />
            ) : (
              <span className="flex items-center gap-2" data-testid="case-preview-placeholder">
                <Camera className="h-4 w-4" aria-hidden="true" />
                {isEmptyCase ? "No preview — test case has no steps" : "No preview for this case"}
              </span>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="code">
        <pre
          className="h-[280px] overflow-auto rounded-md border border-border bg-bg-code p-3 font-mono text-[11.5px] leading-relaxed text-fg-3"
          data-testid="case-code"
        >
          {code ?? (isEmptyCase ? "No executable test steps defined for this case." : "No generated source.")}
        </pre>
      </TabsContent>

      <TabsContent value="logs">
        {logs.length === 0 ? (
          <div className="text-[12px] text-fg-4" data-testid="case-logs-empty">
            {isEmptyCase ? "No logs recorded — test case was skipped." : "No logs."}
          </div>
        ) : (
          <pre
            data-testid="case-logs"
            className="max-h-[320px] overflow-auto rounded-md border border-border bg-bg-code p-[14px] font-mono text-[11.5px] leading-relaxed text-fg-1"
          >
            {logs.map((item) => (
              <div key={item.seq}>{item.message}</div>
            ))}
          </pre>
        )}
      </TabsContent>

      <TabsContent value="artifacts">
        {artifacts.length === 0 ? (
          <div className="text-[12px] text-fg-4" data-testid="case-artifacts-empty">
            {isEmptyCase ? "No artifacts captured — test case was skipped." : "No artifacts captured for this case."}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="case-artifacts">
            {artifacts.map((a) => (
              <CaseArtifactRow key={a.id} artifact={a} runId={runId} />
            ))}
          </ul>
        )}
      </TabsContent>

      {/* M12-1 — pixel diff of any two screenshots in this case (ZERO tier). */}
      <TabsContent value="diff">
        <ScreenshotDiffViewer
          runId={runId}
          caseId={caseId}
          artifacts={artifacts.filter((a) => a.kind === "SCREENSHOT")}
        />
      </TabsContent>
    </Tabs>
  );
}

function CaseArtifactRow({
  artifact,
  runId,
}: {
  artifact: ArtifactPublic;
  runId: string;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const handleView = (): void => {
    if (url) {
      setOpen((v) => !v);
      return;
    }
    void fetchRunSignedUrl(runId, artifact.id).then((signed) => {
      setUrl(signed.url);
      setOpen(true);
    });
  };

  const isViewable = artifact.kind === "SCREENSHOT" || artifact.kind === "VIDEO";

  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-2.5"
      data-testid="case-artifact"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="font-mono text-[11px] text-fg-3">{artifact.kind}</span>
          <span className="text-fg-1">{artifact.mime_type}</span>
        </div>
        {isViewable ? (
          <button
            type="button"
            onClick={handleView}
            data-testid="case-artifact-view"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-[12px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {open ? "Hide" : "View"}
          </button>
        ) : null}
      </div>
      {open && url ? (
        <div className="overflow-hidden rounded-md bg-bg-code">
          {artifact.kind === "VIDEO" ? (
            <video src={url} controls className="max-h-[280px] w-full" />
          ) : (
            <img
              src={url}
              alt={`${artifact.kind} artifact`}
              className="max-h-[280px] w-full object-contain"
            />
          )}
        </div>
      ) : null}
    </li>
  );
}
