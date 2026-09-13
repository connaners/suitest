import { AlertTriangle, Loader2, Play } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmBulkRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  caseTitle?: string | undefined;
  onConfirm: () => void;
  isPending: boolean;
}

/**
 * Confirmation dialog for running a selected batch of test cases from BulkActionBar.
 *
 * Running multiple test cases launches browser automation which can be resource-intensive
 * on the local machine. This dialog confirms the user's intent, clarifies that cases run
 * sequentially, and warns about local resource utilization.
 */
export function ConfirmBulkRunDialog({
  open,
  onOpenChange,
  count,
  caseTitle,
  onConfirm,
  isPending,
}: ConfirmBulkRunDialogProps): React.ReactElement {
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
            onClick={onConfirm}
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
