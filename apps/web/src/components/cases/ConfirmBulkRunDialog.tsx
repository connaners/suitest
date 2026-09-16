import { AlertTriangle, Loader2, Play } from "lucide-react";
import * as React from "react";
import { useState } from "react";

import { ExecutionSettingsPanel } from "@/components/runs/ExecutionSettingsPanel";
import {
  extractExecutionConfig,
  loadSavedExecutionSettings,
  normalizeExecutionSettings,
  saveExecutionSettings,
  type ExecutionSettings,
} from "@/components/runs/execution-settings";
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

export interface ConfirmBulkRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  caseTitle?: string | undefined;
  onConfirm: (config?: PlaywrightConfigInput) => void;
  isPending: boolean;
  initialSettings?: (PlaywrightConfigInput & { highlight_steps?: boolean }) | null;
}

/**
 * Confirmation dialog for running a selected batch of test cases from BulkActionBar.
 *
 * Confirms the user's intent, clarifies sequential execution, and provides non-intrusive
 * Execution Settings (headless mode, screenshot capture, and step element highlighting)
 * which are collapsed by default for zero friction.
 */
export function ConfirmBulkRunDialog({
  open,
  onOpenChange,
  count,
  caseTitle,
  onConfirm,
  isPending,
  initialSettings,
}: ConfirmBulkRunDialogProps): React.ReactElement {
  const [executionSettings, setExecutionSettings] = useState<ExecutionSettings>(() =>
    initialSettings ? normalizeExecutionSettings(initialSettings) : loadSavedExecutionSettings(),
  );

  const handleSubmit = (): void => {
    saveExecutionSettings(executionSettings);
    onConfirm(extractExecutionConfig(executionSettings));
  };



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bulk-run-confirm-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4 fill-current text-accent" aria-hidden="true" />
            {count === 1 && caseTitle
              ? `Run "${caseTitle}"?`
              : `Run ${count} Selected Test ${count === 1 ? "Case" : "Cases"}?`}
          </DialogTitle>
          <DialogDescription>
            {count === 1 && caseTitle
              ? `You are about to launch an automated test run for "${caseTitle}".`
              : `You are about to launch an automated test run for ${count} selected test ${count === 1 ? "case" : "cases"}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div
            data-testid="bulk-run-warning"
            className="flex items-start gap-3 rounded-md border border-amber/30 bg-amber/10 p-3 text-[12.5px] text-fg-2"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <span className="font-medium text-fg-1">Local Resource & Execution Notice</span>
              <p className="leading-relaxed text-fg-3">
                Automated tests launch browser sessions that consume CPU and memory. In local mode,
                test cases execute <strong className="font-medium text-fg-2">sequentially</strong>,
                which may take several minutes for larger selections.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-[12px]">
            <span className="text-fg-3">{count === 1 ? "Selected case" : "Selected cases"}</span>
            <span
              className="max-w-[240px] truncate font-mono font-medium text-fg-1"
              title={caseTitle ?? undefined}
            >
              {count === 1 && caseTitle ? caseTitle : count}
            </span>
          </div>

          {/* Collapsible Execution Settings */}
          <ExecutionSettingsPanel
            value={executionSettings}
            onChange={setExecutionSettings}
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="bulk-run-confirm-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending}
            data-testid="bulk-run-confirm-submit"
            className="gap-1.5"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            )}
            {isPending ? "Starting run…" : `Run ${count} ${count === 1 ? "Case" : "Cases"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
