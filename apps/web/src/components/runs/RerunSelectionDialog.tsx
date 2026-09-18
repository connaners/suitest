import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import * as React from "react";

import { rollupLabel, rollupToBadge, type CaseGroup } from "@/components/runs/case-grouping";
import { ExecutionSettingsPanel } from "@/components/runs/ExecutionSettingsPanel";
import {
  extractExecutionConfig,
  loadSavedExecutionSettings,
  normalizeExecutionSettings,
  saveExecutionSettings,
  type ExecutionSettings,
} from "@/components/runs/execution-settings";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlaywrightConfigInput } from "@/hooks/use-runs";
import { formatDuration } from "@/lib/test-case-format";
import { cn } from "@/lib/utils";

export interface RerunSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runPublicId: string;
  groups: CaseGroup[];
  onConfirm: (selectedCaseIds: string[], config?: PlaywrightConfigInput) => void;
  isPending: boolean;
  initialSettings?: (PlaywrightConfigInput & { highlight_steps?: boolean }) | null;
}

export function RerunSelectionDialog({
  open,
  onOpenChange,
  runPublicId,
  groups,
  onConfirm,
  isPending,
  initialSettings,
}: RerunSelectionDialogProps): React.ReactElement {
  const activeGroups = React.useMemo(
    () => groups.filter((g) => !g.isDeleted),
    [groups],
  );

  const failedGroups = React.useMemo(
    () => activeGroups.filter((g) => g.rollup === "fail" || g.rollup === "aborted"),
    [activeGroups],
  );

  const actualFailedGroups = React.useMemo(
    () => activeGroups.filter((g) => g.rollup === "fail"),
    [activeGroups],
  );

  const abortedGroups = React.useMemo(
    () => activeGroups.filter((g) => g.rollup === "aborted"),
    [activeGroups],
  );

  const [selectedCaseIds, setSelectedCaseIds] = React.useState<Set<string>>(() => {
    if (failedGroups.length > 0) {
      return new Set(failedGroups.map((g) => g.caseId));
    }
    return new Set(activeGroups.map((g) => g.caseId));
  });

  const [executionSettings, setExecutionSettings] = React.useState<ExecutionSettings>(() =>
    initialSettings ? normalizeExecutionSettings(initialSettings) : loadSavedExecutionSettings(),
  );

  // Re-sync preset selection and execution settings whenever the dialog opens or dependencies change
  React.useEffect(() => {
    if (open) {
      if (failedGroups.length > 0) {
        setSelectedCaseIds(new Set(failedGroups.map((g) => g.caseId)));
      } else {
        setSelectedCaseIds(new Set(activeGroups.map((g) => g.caseId)));
      }
      setExecutionSettings(
        initialSettings ? normalizeExecutionSettings(initialSettings) : loadSavedExecutionSettings(),
      );
    }
  }, [open, failedGroups, activeGroups, initialSettings]);

  const toggleCase = (caseId: string): void => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) {
        next.delete(caseId);
      } else {
        next.add(caseId);
      }
      return next;
    });
  };

  const selectFailedOnly = (): void => {
    setSelectedCaseIds(new Set(failedGroups.map((g) => g.caseId)));
  };

  const selectAll = (): void => {
    setSelectedCaseIds(new Set(activeGroups.map((g) => g.caseId)));
  };

  const clearAll = (): void => {
    setSelectedCaseIds(new Set());
  };

  const count = selectedCaseIds.size;
  const isZeroCases = activeGroups.length === 0;
  const isAllSelected = activeGroups.length > 0 && count === activeGroups.length;
  const isFailedOnlySelected =
    failedGroups.length > 0 &&
    count === failedGroups.length &&
    failedGroups.every((g) => selectedCaseIds.has(g.caseId));

  const handleSubmit = (): void => {
    if (!isZeroCases && count === 0) return;
    saveExecutionSettings(executionSettings);
    onConfirm(Array.from(selectedCaseIds), extractExecutionConfig(executionSettings));
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="rerun-selection-dialog"
        className="flex max-h-[85vh] flex-col overflow-hidden p-4 sm:max-w-lg sm:p-6"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <RotateCw className="h-4 w-4 text-accent" aria-hidden="true" />
            Re-run Test Cases ({runPublicId})
          </DialogTitle>
          <DialogDescription>
            Choose which test cases to include in this re-run. Cases execute sequentially.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-3 py-1 overflow-y-auto pr-1">
          {/* Quick-select filter presets */}
          {activeGroups.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5" data-testid="rerun-presets">
              {failedGroups.length > 0 ? (
                <button
                  type="button"
                  onClick={selectFailedOnly}
                  data-testid="preset-failed-only"
                  className={cn(
                    "rounded px-2 py-1 text-[11.5px] font-medium transition-colors",
                    isFailedOnlySelected
                      ? actualFailedGroups.length > 0
                        ? "bg-red/15 text-red ring-1 ring-red/30"
                        : "bg-amber/15 text-amber ring-1 ring-amber/30"
                      : "bg-bg-elev-2 text-fg-3 hover:bg-bg-elev-3 hover:text-fg-1",
                  )}
                >
                  {actualFailedGroups.length > 0 && abortedGroups.length > 0
                    ? `Failed & Incomplete (${failedGroups.length})`
                    : abortedGroups.length > 0 && actualFailedGroups.length === 0
                      ? `Remaining only (${failedGroups.length})`
                      : `Failed only (${failedGroups.length})`}
                </button>
              ) : null}
              <button
                type="button"
                onClick={selectAll}
                data-testid="preset-select-all"
                className={cn(
                  "rounded px-2 py-1 text-[11.5px] font-medium transition-colors",
                  isAllSelected
                    ? "bg-accent/15 text-accent ring-1 ring-accent/30"
                    : "bg-bg-elev-2 text-fg-3 hover:bg-bg-elev-3 hover:text-fg-1",
                )}
              >
                All cases ({activeGroups.length})
              </button>
              {count > 0 ? (
                <button
                  type="button"
                  onClick={clearAll}
                  data-testid="preset-clear-all"
                  className="rounded px-2 py-1 text-[11.5px] text-fg-4 transition-colors hover:bg-bg-elev-2 hover:text-fg-2"
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Checklist container */}
          <div
            className="flex-1 min-h-[120px] max-h-[35vh] overflow-y-auto rounded-md border border-border bg-bg-elev-1 p-1.5"
            data-testid="rerun-case-list"
          >
            {groups.length === 0 ? (
              <div
                className="flex h-full min-h-[100px] flex-col items-center justify-center p-4 text-center text-[12px] text-fg-4"
                data-testid="rerun-no-cases"
              >
                <p>No individual test cases recorded for this run.</p>
                <p className="mt-1 text-[11px] text-fg-5">
                  Re-running will execute the full original test selection.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
              {groups.map((g) => {
                const isChecked = selectedCaseIds.has(g.caseId);
                const isDeleted = Boolean(g.isDeleted);
                return (
                  <li key={g.caseId}>
                    <label
                      data-testid="rerun-case-item"
                      data-case-id={g.caseId}
                      data-deleted={isDeleted ? "true" : undefined}
                      className={cn(
                        "flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors",
                        isDeleted
                          ? "cursor-not-allowed opacity-50"
                          : "cursor-pointer hover:bg-bg-elev-2",
                        isChecked && !isDeleted && "bg-accent/[0.05]",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked && !isDeleted}
                        disabled={isDeleted}
                        onChange={() => {
                          if (!isDeleted) toggleCase(g.caseId);
                        }}
                        className="h-3.5 w-3.5 shrink-0 rounded border-border text-accent focus:ring-accent disabled:cursor-not-allowed"
                        data-testid={`checkbox-case-${g.caseId}`}
                      />
                      <StatusBadge
                        status={rollupToBadge(g.rollup)}
                        label={rollupLabel(g.rollup)}
                      />
                      <span className="shrink-0 font-mono text-[11px] text-fg-4">{g.casePublicId}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{g.caseName}</span>
                      {isDeleted ? (
                        <span
                          className="shrink-0 rounded bg-red/10 px-1.5 py-0.5 text-[10px] font-medium text-red"
                          data-testid="rerun-case-deleted-badge"
                        >
                          Deleted
                        </span>
                      ) : null}
                      <span className="shrink-0 ml-auto font-mono text-[10.5px] text-fg-5 tabular-nums">
                        {formatDuration(g.durationMs)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

          {/* Reusable Execution Settings Panel */}
          <div className="shrink-0">
            <ExecutionSettingsPanel
              value={executionSettings}
              onChange={setExecutionSettings}
            />
          </div>

          {/* Notice */}
          <div className="shrink-0 flex items-center gap-2 rounded-md bg-bg-elev-2 px-3 py-2 text-[11.5px] text-fg-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber" aria-hidden="true" />
            <span>
              Modified test steps will run with their latest configuration in the test case editor.
            </span>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="rerun-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || (!isZeroCases && count === 0)}
            data-testid="rerun-dialog-submit"
            className="gap-1.5"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Queuing…
              </>
            ) : (
              <>
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                {isZeroCases
                  ? "Re-run full suite"
                  : count === activeGroups.length
                    ? `Run all (${count}) cases`
                    : `Run ${count} selected test ${count === 1 ? "case" : "cases"}`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
