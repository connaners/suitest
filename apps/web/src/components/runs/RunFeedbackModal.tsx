import { AlertCircle, MessageSquare, Printer } from "lucide-react";
import * as React from "react";

import type { CaseGroup } from "./case-grouping";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export interface RunFeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runPublicId: string;
  groups: CaseGroup[];
  feedback: Record<string, string>;
  onFeedbackChange: (caseId: string, feedback: string) => void;
  onPrint: () => void;
}

export function RunFeedbackModal({
  open,
  onOpenChange,
  runPublicId,
  groups,
  feedback,
  onFeedbackChange,
  onPrint,
}: RunFeedbackModalProps): React.ReactElement {
  const failedGroups = React.useMemo(
    () => groups.filter((g) => g.rollup === "fail" || g.rollup === "aborted"),
    [groups],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="run-feedback-modal"
        className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden bg-bg-elev-1 border-border"
      >
        <DialogHeader className="p-5 border-b border-border bg-bg-elev-2/40">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-accent" />
            <DialogTitle className="text-base font-semibold text-fg-1">
              Failed Test Review & Print Feedback
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-fg-4 mt-1">
            Capture investigation notes and RCA for run <span className="font-mono text-fg-2">{runPublicId}</span>.
            Notes will appear beside each failure in the printed report. Empty notes print ruled lines for handwritten notes.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {failedGroups.length === 0 ? (
            <div className="text-center py-8 text-xs text-fg-4">
              No failed test cases found in this run.
            </div>
          ) : (
            failedGroups.map((group, index) => {
              const currentNote = feedback[group.caseId] ?? "";

              return (
                <div
                  key={group.caseId}
                  className="rounded-lg border border-border bg-bg-elev-2/60 p-4 space-y-3"
                  data-testid={`feedback-thread-${group.caseId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red/10 text-[11px] font-mono font-bold text-red">
                        {index + 1}
                      </span>
                      <div>
                        <span className="font-mono text-xs font-semibold text-fg-3 mr-1.5">
                          {group.casePublicId}:
                        </span>
                        <span className="text-xs font-semibold text-fg-1">
                          {group.caseName}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-red/15 text-red border border-red/30">
                      Failed
                    </span>
                  </div>

                  {group.firstFailure && (
                    <div className="rounded border border-red/20 bg-red/5 p-2.5 text-[11px] font-mono text-fg-3 flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 text-red shrink-0 mt-0.5" />
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-semibold text-red">Failure Details:</div>
                        <div className="text-fg-4 text-[10.5px] truncate">
                          {group.firstFailure}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label
                      htmlFor={`feedback-${group.caseId}`}
                      className="text-[11px] font-medium text-fg-3"
                    >
                      Investigation / Follow-up Notes
                    </label>
                    <Textarea
                      id={`feedback-${group.caseId}`}
                      data-testid={`feedback-input-${group.caseId}`}
                      value={currentNote}
                      onChange={(e) => onFeedbackChange(group.caseId, e.target.value)}
                      placeholder="Add investigation details, root causes, or tickets... (Or leave blank for handwritten lines)"
                      className="text-xs min-h-[64px] bg-bg-base border-border text-fg-1 placeholder:text-fg-5"
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="p-4 border-t border-border bg-bg-elev-2/40 flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="modal-close-button"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="modal-print-button"
            onClick={onPrint}
            className="gap-1.5"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Results
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
