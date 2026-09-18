import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  CameraOff,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Play,
  RotateCw,
} from "lucide-react";
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
import type { PlaywrightConfigInput } from "@/hooks/use-runs";
import type { components } from "@/lib/api-types";
import { formatDuration } from "@/lib/test-case-format";
import { cn } from "@/lib/utils";

import { ImageLightboxModal } from "./ImageLightboxModal";
import { ScreenshotDiffViewer } from "./ScreenshotDiffViewer";
import { VideoPlayerModal } from "./VideoPlayerModal";

import { rollupLabel, rollupToBadge, type CaseGroup } from "./case-grouping";
import { StepTable, type DisplayStep, type StepDisplayOutcome } from "./StepTable";

type ArtifactPublic = components["schemas"]["ArtifactPublic"];
type RunStatus = components["schemas"]["RunStatus"];
type RunStepPublic = components["schemas"]["RunStepPublic"];

interface CaseDetailPanelProps {
  runId: string;
  group: CaseGroup;
  /** All of the run's artifacts (filtered to this case internally). */
  artifacts: ArtifactPublic[];
  runStatus?: RunStatus | undefined;
  onRerunCase?: ((caseId: string) => void) | undefined;
  isRerunning?: boolean | undefined;
  hasMultipleCases?: boolean | undefined;
  playwrightConfig?: PlaywrightConfigInput | null | undefined;
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
  playwrightConfig,
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
    void fetchRunSignedUrl(runId, shot.id)
      .then((signed) => {
        if (!cancelled) setStepShotUrl(signed.url);
      })
      .catch(() => {
        if (!cancelled) setStepShotUrl(null);
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
    isLive || group.rollup === "aborted" || (group.steps.length < group.total && runStatus !== "PASS");

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
    // or run passed, use recorded executed steps directly.
    if (!isLive && (runStatus === "PASS" || (group.rollup !== "aborted" && group.steps.length >= group.total && group.total > 0))) {
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
    // synthesize unexecuted rows up to group.total. For live/queued runs, use QUEUED/RUNNING
    // instead of ABORTED while plannedSteps query is in-flight to avoid status flashing.
    if (group.total > sortedExec.length) {
      const result: DisplayStep[] = [...sortedExec];
      const unexecutedCount = group.total - sortedExec.length;
      let activeFound = false;

      for (let i = 0; i < unexecutedCount; i++) {
        const stepNum = sortedExec.length + i + 1;
        let outcome: StepDisplayOutcome = "ABORTED";
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
          id: `unexecuted-${group.caseId}-${stepNum}`,
          case_id: group.caseId,
          step_order: stepNum,
          title: `Step ${stepNum} (Unexecuted)`,
          type: "action",
          outcome,
          duration_ms: null,
          error_message: errorMessage,
          stdout: null,
          isPlannedOnly: true,
        });
      }
      return result;
    }

    return sortedExec;
  }, [group, plannedSteps, isZeroSteps, isLive, isCaseHalted, runStatus]);

  // Step screenshots for per-step capture navigator
  const stepScreenshots = useMemo(() => {
    const stepsById = new Map(group.steps.map((s) => [s.id, s]));
    const displayIndexById = new Map(displaySteps.map((s, idx) => [s.id, idx]));

    // Deduplicate screenshots by step: if a step has multiple captures (e.g. step shot + failure shot),
    // pick the latest capture so the navigator has exactly one button per recorded step.
    const latestShotByStepId = new Map<string, (typeof caseArtifacts)[number]>();
    for (const a of caseArtifacts) {
      if (a.kind === "SCREENSHOT") {
        latestShotByStepId.set(a.run_step_id, a);
      }
    }

    return Array.from(latestShotByStepId.values())
      .map((a) => {
        const step = stepsById.get(a.run_step_id);
        const idx = displayIndexById.get(a.run_step_id);
        const groupStepIdx = group.steps.findIndex((s) => s.id === a.run_step_id);
        const order = idx !== undefined ? idx + 1 : groupStepIdx >= 0 ? groupStepIdx + 1 : 1;
        const title = step?.title ?? displaySteps[idx ?? groupStepIdx]?.title ?? `Step ${order}`;
        return {
          artifactId: a.id,
          stepId: a.run_step_id,
          stepOrder: order,
          title,
          outcome: step?.outcome ?? "UNKNOWN",
        };
      })
      .sort((a, b) => a.stepOrder - b.stepOrder);
  }, [caseArtifacts, group.steps, displaySteps]);

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
              disabled={isRerunning || group.total === 0}
              title={group.total === 0 ? "Cannot re-run a test case with no steps" : undefined}
              onClick={() => onRerunCase(group.caseId)}
              className="h-6 gap-1 px-2 text-[11px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1 disabled:opacity-50"
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
        selectedStepId={selectedStepId}
        stepScreenshots={stepScreenshots}
        onSelectStep={(id) => setSelectedStepId(id)}
        onClearStep={() => {
          setSelectedStepId(null);
        }}
        logs={logItems}
        artifacts={caseArtifacts}
        steps={group.steps}
        runId={runId}
        caseId={group.caseId}
        isEmptyCase={isZeroSteps}
        playwrightConfig={playwrightConfig}
      />
    </div>
  );
}

interface StepScreenshotItem {
  artifactId: string;
  stepId: string;
  stepOrder: number;
  title: string;
  outcome: string;
}

interface CaseEvidenceTabsProps {
  code: string | null | undefined;
  videoUrl: string | null;
  stepScreenshotUrl: string | null;
  stepLabel: string | null;
  selectedStepId: string | null;
  stepScreenshots: StepScreenshotItem[];
  onSelectStep: (stepId: string) => void;
  onClearStep: () => void;
  logs: components["schemas"]["RunLogItem"][];
  artifacts: ArtifactPublic[];
  steps?: RunStepPublic[] | undefined;
  runId: string;
  caseId: string;
  isEmptyCase?: boolean | undefined;
  playwrightConfig?: PlaywrightConfigInput | null | undefined;
}

function CaseEvidenceTabs({
  code,
  videoUrl,
  stepScreenshotUrl,
  stepLabel,
  selectedStepId,
  stepScreenshots,
  onSelectStep,
  onClearStep,
  logs,
  artifacts,
  steps,
  runId,
  caseId,
  isEmptyCase,
  playwrightConfig,
}: CaseEvidenceTabsProps): React.ReactElement {
  const [tab, setTab] = useState("preview");
  const [stepLightboxOpen, setStepLightboxOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const hasVideo = Boolean(videoUrl) || artifacts.some((a) => a.kind === "VIDEO");
  const [previewMode, setPreviewMode] = useState<"video" | "screenshots">(() =>
    hasVideo ? "video" : "screenshots",
  );

  const PAGE_SIZE = 10;
  const [displayedArtifactsCount, setDisplayedArtifactsCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setDisplayedArtifactsCount(PAGE_SIZE);
    setPreviewMode(hasVideo ? "video" : "screenshots");
  }, [caseId, hasVideo]);

  useEffect(() => {
    if (hasVideo && stepScreenshots.length === 0) {
      setPreviewMode("video");
    } else if (!hasVideo && stepScreenshots.length > 0) {
      setPreviewMode("screenshots");
    }
  }, [hasVideo, stepScreenshots.length]);

  // When a specific step is selected (e.g. clicked in StepTable), switch previewMode to screenshots
  // so the user immediately sees the captured screenshot of the selected step.
  useEffect(() => {
    if (selectedStepId) {
      setPreviewMode("screenshots");
    }
  }, [selectedStepId]);

  // When in screenshots mode without an active selection, auto-select the first failure (or first step).
  useEffect(() => {
    if (previewMode === "screenshots" && !selectedStepId && stepScreenshots.length > 0) {
      const failingShot = stepScreenshots.find(
        (s) => s.outcome === "FAIL" || s.outcome === "ERROR",
      );
      const targetShot = failingShot ?? stepScreenshots[0];
      if (targetShot) {
        onSelectStep(targetShot.stepId);
      }
    }
  }, [previewMode, selectedStepId, stepScreenshots, onSelectStep]);

  const currentStepIndex = stepScreenshots.findIndex((s) => s.stepId === selectedStepId);

  const handlePrevStep = (): void => {
    if (currentStepIndex > 0) {
      const prev = stepScreenshots[currentStepIndex - 1];
      if (prev) onSelectStep(prev.stepId);
    }
  };

  const handleNextStep = (): void => {
    if (currentStepIndex < stepScreenshots.length - 1) {
      const next = stepScreenshots[currentStepIndex + 1];
      if (next) onSelectStep(next.stepId);
    } else if (currentStepIndex === -1 && stepScreenshots.length > 0) {
      const first = stepScreenshots[0];
      if (first) onSelectStep(first.stepId);
    }
  };


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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
            <div className="flex items-center gap-2">
              {videoUrl && stepScreenshots.length > 0 ? (
                <div
                  className="flex items-center rounded-md border border-border bg-bg-elev-2 p-0.5 text-[11px]"
                  data-testid="preview-mode-toggle"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewMode("video");
                      onClearStep();
                    }}
                    className={cn(
                      "rounded px-2 py-0.5 font-medium transition-colors",
                      previewMode === "video"
                        ? "bg-bg-root text-fg-1 shadow-xs"
                        : "text-fg-4 hover:text-fg-2",
                    )}
                    data-testid="preview-mode-video"
                  >
                    Video
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewMode("screenshots");
                      const first = stepScreenshots[0];
                      if (!selectedStepId && first) {
                        onSelectStep(first.stepId);
                      }
                    }}
                    className={cn(
                      "rounded px-2 py-0.5 font-medium transition-colors",
                      previewMode === "screenshots"
                        ? "bg-bg-root text-fg-1 shadow-xs"
                        : "text-fg-4 hover:text-fg-2",
                    )}
                    data-testid="preview-mode-screenshots"
                  >
                    Step captures ({stepScreenshots.length})
                  </button>
                </div>
              ) : (
                <span className="font-mono text-[11px] text-fg-4">
                  {videoUrl
                    ? "Video recording"
                    : stepScreenshots.length > 0
                      ? `Step captures (${stepScreenshots.length})`
                      : "No preview"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 font-mono text-[11px] text-fg-4">
              {previewMode === "screenshots" && stepScreenshots.length > 0 && (
                <div className="flex items-center gap-1" data-testid="step-nav-controls">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={currentStepIndex <= 0}
                    onClick={handlePrevStep}
                    className="h-6 px-1.5 text-[11px]"
                    data-testid="step-nav-prev"
                  >
                    <ChevronLeft className="h-3 w-3" />
                    Prev
                  </Button>
                  <span className="text-[10.5px] text-fg-4 tabular-nums">
                    {currentStepIndex >= 0
                      ? `${currentStepIndex + 1}/${stepScreenshots.length}`
                      : `1/${stepScreenshots.length}`}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={currentStepIndex >= stepScreenshots.length - 1}
                    onClick={handleNextStep}
                    className="h-6 px-1.5 text-[11px]"
                    data-testid="step-nav-next"
                  >
                    Next
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Step buttons navigator */}
          {previewMode === "screenshots" && stepScreenshots.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-1 py-1"
              data-testid="step-screenshot-navigator"
            >
              {stepScreenshots.map((shot) => {
                const isSelected = selectedStepId === shot.stepId;
                return (
                  <button
                    key={shot.artifactId}
                    type="button"
                    onClick={() => onSelectStep(shot.stepId)}
                    className={cn(
                      "flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-mono transition-colors",
                      isSelected
                        ? "border-accent bg-accent/15 text-accent font-semibold"
                        : "border-border bg-bg-elev-2 text-fg-3 hover:bg-bg-elev-3 hover:text-fg-1",
                    )}
                    data-testid={`step-nav-btn-${shot.stepOrder}`}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        shot.outcome === "PASS"
                          ? "bg-green"
                          : shot.outcome === "FAIL" || shot.outcome === "ERROR"
                            ? "bg-red"
                            : "bg-fg-4",
                      )}
                      aria-hidden="true"
                    />
                    Step {shot.stepOrder}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex h-[280px] items-center justify-center overflow-hidden rounded-md bg-bg-code text-[12px] text-fg-5">
            {previewMode === "screenshots" && stepScreenshotUrl ? (
              <button
                type="button"
                onClick={() => setStepLightboxOpen(true)}
                className="group relative flex h-full w-full items-center justify-center cursor-zoom-in focus:outline-none"
                aria-label="Zoom step screenshot"
                data-testid="case-preview-zoom-trigger"
              >
                <img
                  src={stepScreenshotUrl}
                  alt={stepLabel ? `${stepLabel} screenshot` : "Step screenshot"}
                  data-testid="case-preview-step-image"
                  className="max-h-full max-w-full object-contain transition-transform group-hover:scale-[1.01]"
                />
                <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-bg-root/80 px-2 py-0.5 text-[11px] text-fg-2 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                  <Maximize2 className="h-3 w-3" />
                  Click to expand (1:1 / Pan)
                </span>
              </button>
            ) : (previewMode === "video" || stepScreenshots.length === 0) && videoUrl ? (
              <button
                type="button"
                onClick={() => setVideoModalOpen(true)}
                className="group relative flex h-full w-full items-center justify-center cursor-pointer focus:outline-none"
                aria-label="Play recording video"
                data-testid="case-preview-video-trigger"
              >
                <video
                  src={videoUrl}
                  data-testid="case-preview-video"
                  className="max-h-full max-w-full object-contain pointer-events-none transition-transform group-hover:scale-[1.01]"
                  preload="metadata"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/35 transition-colors">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-root/90 text-fg-1 shadow-lg ring-1 ring-border/50 backdrop-blur-sm transition-transform group-hover:scale-110">
                    <Play className="h-5 w-5 fill-current ml-0.5" />
                  </div>
                </div>
                <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-bg-root/80 px-2 py-0.5 text-[11px] text-fg-2 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play className="h-3 w-3" />
                  Click to play video
                </span>
              </button>
            ) : (
              <div
                className="flex flex-col items-center justify-center gap-1 text-center p-4"
                data-testid="case-preview-placeholder"
              >
                <CameraOff className="h-5 w-5 text-fg-5 mb-1" aria-hidden="true" />
                <span className="text-[12px] font-medium text-fg-3">
                  {isEmptyCase ? "No preview — test case has no steps" : "No preview available for this case"}
                </span>
                {!isEmptyCase ? (
                  <span className="text-[11px] text-fg-5 max-w-xs">
                    {playwrightConfig && (playwrightConfig.screenshot === "off" || playwrightConfig.video === "off")
                      ? "Screenshots and video recording were disabled in Execution Settings."
                      : "No preview captured for this case."}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <ImageLightboxModal
          open={stepLightboxOpen}
          onOpenChange={setStepLightboxOpen}
          src={stepScreenshotUrl ?? ""}
          title={stepLabel ? `${stepLabel} screenshot` : "Step screenshot"}
          images={stepScreenshots.map((shot) => ({
            src: shot.stepId === selectedStepId ? (stepScreenshotUrl ?? "") : "",
            title: `Step ${shot.stepOrder}: ${shot.title}`,
            subtitle: `Outcome: ${shot.outcome}`,
          }))}
          currentIndex={currentStepIndex >= 0 ? currentStepIndex : 0}
          onNavigate={(index) => {
            const nextShot = stepScreenshots[index];
            if (nextShot) {
              onSelectStep(nextShot.stepId);
            }
          }}
        />
        <VideoPlayerModal
          open={videoModalOpen}
          onOpenChange={setVideoModalOpen}
          src={videoUrl ?? ""}
          title="Run Video Recording"
          subtitle="Case execution video playback"
        />
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
          <div
            className="flex flex-col items-center justify-center rounded-md border border-dashed border-border/80 bg-bg-root/40 p-6 text-center"
            data-testid="case-artifacts-empty"
          >
            <CameraOff className="mb-2 h-6 w-6 text-fg-4/70" />
            <p className="font-medium text-[12.5px] text-fg-2">
              {isEmptyCase
                ? "No artifacts captured — test case was skipped."
                : "No media artifacts captured for this case"}
            </p>
            <p className="text-[11px] text-fg-4 mt-1 max-w-md">
              {isEmptyCase
                ? "This test case contains no executable test steps."
                : playwrightConfig &&
                    (playwrightConfig.screenshot === "off" ||
                      playwrightConfig.video === "off")
                  ? "Screenshot capture and video recording were disabled in Execution Settings when this run was executed."
                  : "No screenshots or video recordings were captured during the execution of this test case."}
            </p>
            {playwrightConfig ? (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 font-mono text-[10.5px]">
                <span className="rounded bg-bg-elev-2 px-2 py-0.5 text-fg-3 border border-border">
                  Headless: {playwrightConfig.headless !== false ? "On" : "Off"}
                </span>
                <span className="rounded bg-bg-elev-2 px-2 py-0.5 text-fg-3 border border-border">
                  Screenshots:{" "}
                  {playwrightConfig.screenshot === "on"
                    ? "Every step"
                    : playwrightConfig.screenshot === "only-on-failure"
                      ? "On fail only"
                      : "Off"}
                </span>
                <span className="rounded bg-bg-elev-2 px-2 py-0.5 text-fg-3 border border-border">
                  Video:{" "}
                  {playwrightConfig.video === "on"
                    ? "On"
                    : playwrightConfig.video === "retain-on-failure"
                      ? "On fail only"
                      : "Off"}
                </span>
                {playwrightConfig.highlightSteps ||
                (playwrightConfig as { highlight_steps?: boolean }).highlight_steps ? (
                  <span className="rounded bg-bg-elev-2 px-2 py-0.5 text-accent border border-accent/30">
                    Highlight: Enabled
                  </span>
                ) : null}
              </div>
            ) : null}
            {!isEmptyCase ? (
              <p className="text-[10.5px] text-fg-5 mt-2.5">
                Tip: Enable screenshots or video in Execution Settings before launching to record visual step evidence.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-fg-4 px-0.5">
              <span data-testid="case-artifacts-count">
                Showing {Math.min(displayedArtifactsCount, artifacts.length)} of {artifacts.length} artifacts
              </span>
            </div>
            <ul className="flex flex-col gap-1.5" data-testid="case-artifacts">
              {artifacts.slice(0, displayedArtifactsCount).map((a) => (
                <CaseArtifactRow key={a.id} artifact={a} runId={runId} steps={steps} />
              ))}
            </ul>
            {displayedArtifactsCount < artifacts.length ? (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDisplayedArtifactsCount((prev) => prev + PAGE_SIZE)}
                  data-testid="case-artifacts-load-more"
                  className="h-7 text-xs font-normal text-fg-3 hover:text-fg-1"
                >
                  Load more ({artifacts.length - displayedArtifactsCount} remaining)
                </Button>
              </div>
            ) : null}
          </div>
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
  steps,
}: {
  artifact: ArtifactPublic;
  runId: string;
  steps?: RunStepPublic[] | undefined;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);

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

  const handleOpenLightbox = (): void => {
    if (url) {
      setLightboxOpen(true);
      return;
    }
    void fetchRunSignedUrl(runId, artifact.id).then((signed) => {
      setUrl(signed.url);
      setLightboxOpen(true);
    });
  };

  const handleOpenVideoModal = (): void => {
    if (url) {
      setVideoModalOpen(true);
      return;
    }
    void fetchRunSignedUrl(runId, artifact.id).then((signed) => {
      setUrl(signed.url);
      setVideoModalOpen(true);
    });
  };

  const isViewable = artifact.kind === "SCREENSHOT" || artifact.kind === "VIDEO";
  const isImage = artifact.kind === "SCREENSHOT";

  const stepIndex = steps?.findIndex((s) => s.id === artifact.run_step_id) ?? -1;
  const step = stepIndex >= 0 && steps ? steps[stepIndex] : null;
  const stepNumber = stepIndex >= 0 ? stepIndex + 1 : null;

  const artifactLabel =
    artifact.kind === "VIDEO"
      ? "Run Video Recording"
      : step
        ? `Step ${stepNumber}: ${step.title || "Screenshot"}`
        : `${artifact.kind} artifact`;

  const formattedSize = artifact.size_bytes
    ? `${Math.max(1, Math.round(artifact.size_bytes / 1024)).toString()} KB`
    : null;

  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev-1 p-2.5"
      data-testid="case-artifact"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12.5px] min-w-0 flex-1">
          <span className="shrink-0 rounded bg-bg-elev-2 px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-fg-3">
            {artifact.kind}
          </span>
          <span className="font-medium text-fg-1 truncate" title={artifactLabel}>
            {artifactLabel}
          </span>
          {formattedSize ? (
            <span className="shrink-0 font-mono text-[11px] text-fg-4">
              ({formattedSize})
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isImage ? (
            <button
              type="button"
              onClick={handleOpenLightbox}
              data-testid="case-artifact-zoom-btn"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-[12px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              Zoom
            </button>
          ) : null}
          {artifact.kind === "VIDEO" ? (
            <button
              type="button"
              onClick={handleOpenVideoModal}
              data-testid="case-artifact-video-expand-btn"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-[12px] text-fg-3 hover:bg-bg-elev-2 hover:text-fg-1"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              Expand
            </button>
          ) : null}
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
      </div>
      {open && url ? (
        <div className="overflow-hidden rounded-md bg-bg-code">
          {artifact.kind === "VIDEO" ? (
            <div className="group relative flex items-center justify-center">
              <video src={url} controls className="max-h-[280px] w-full" />
              <button
                type="button"
                onClick={handleOpenVideoModal}
                aria-label="Expand video modal"
                data-testid="case-artifact-video-inline-expand"
                className="absolute top-2 right-2 flex items-center gap-1 rounded bg-bg-root/80 px-2 py-1 text-[11px] text-fg-2 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-bg-root hover:text-fg-1"
              >
                <Maximize2 className="h-3 w-3" />
                Expand
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="group relative flex w-full cursor-zoom-in items-center justify-center focus:outline-none"
              aria-label="Zoom artifact screenshot"
              data-testid="case-artifact-image-zoom-trigger"
            >
              <img
                src={url}
                alt={artifactLabel}
                className="max-h-[280px] w-full object-contain transition-transform group-hover:scale-[1.01]"
              />
              <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-bg-root/80 px-2 py-0.5 text-[11px] text-fg-2 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                <Maximize2 className="h-3 w-3" />
                Click to expand
              </span>
            </button>
          )}
        </div>
      ) : null}
      {isImage && url ? (
        <ImageLightboxModal
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={url}
          alt={artifactLabel}
          title={artifactLabel}
          subtitle={formattedSize ? `${artifact.mime_type} • ${formattedSize}` : artifact.mime_type}
        />
      ) : null}
      {artifact.kind === "VIDEO" && url ? (
        <VideoPlayerModal
          open={videoModalOpen}
          onOpenChange={setVideoModalOpen}
          src={url}
          title={artifactLabel}
          subtitle={formattedSize ? `${artifact.mime_type} • ${formattedSize}` : artifact.mime_type}
        />
      ) : null}
    </li>
  );
}
