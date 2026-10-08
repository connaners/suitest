import * as React from "react";

import type { CaseGroup } from "./case-grouping";
import type { RunDetail } from "@/hooks/use-runs";
import { formatTimestamp } from "@/lib/date";
import { formatDuration } from "@/lib/test-case-format";

export interface PrintableRunReportProps {
  run: RunDetail | undefined;
  groups: CaseGroup[];
  feedback: Record<string, string>;
}

export function PrintableRunReport({
  run,
  groups,
  feedback,
}: PrintableRunReportProps): React.ReactElement | null {
  if (!run) return null;

  const failedGroups = groups.filter((g) => g.rollup === "fail" || g.rollup === "aborted");
  const passedGroups = groups.filter((g) => g.rollup === "pass");

  return (
    <div
      data-testid="printable-run-report"
      className="printable-run-report hidden print:block font-sans text-black bg-white p-6 leading-normal"
    >
      {/* Header */}
      <div className="border-b-2 border-black pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Test Run Report</h1>
            <p className="text-sm font-mono text-gray-700 mt-0.5">
              Run: <span>{run.public_id}</span> • {run.name}
            </p>
          </div>
          <div className="text-right text-xs text-gray-600 font-mono">
            <div>Trigger: {run.trigger}</div>
            <div>Env: {run.env || "default"}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-4 pt-3 border-t border-gray-300 text-xs font-mono">
          <div>
            <span className="text-gray-500 uppercase tracking-wide block">Started</span>
            <span className="font-semibold">{formatTimestamp(run.started_at)}</span>
          </div>
          <div>
            <span className="text-gray-500 uppercase tracking-wide block">Duration</span>
            <span className="font-semibold">{formatDuration(run.duration_ms)}</span>
          </div>
          <div>
            <span className="text-gray-500 uppercase tracking-wide block">Total Steps</span>
            <span className="font-semibold">
              {run.summary?.passed_steps ?? 0} / {run.summary?.total_steps ?? 0} passed
            </span>
          </div>
          <div>
            <span className="text-gray-500 uppercase tracking-wide block">Failed Tests</span>
            <span className="font-bold text-red-600">{failedGroups.length}</span>
          </div>
        </div>
      </div>

      {/* Failed Tests Section */}
      {failedGroups.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-bold border-b border-gray-400 pb-1 mb-3 text-red-700">
            Failed Test Executions ({failedGroups.length})
          </h2>
          <div className="space-y-4">
            {failedGroups.map((group) => {
              const note = feedback[group.caseId]?.trim();
              return (
                <div
                  key={group.caseId}
                  className="border border-gray-300 rounded p-4 break-inside-avoid bg-white"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-bold text-sm">
                      <span className="font-mono text-gray-600 mr-2">{group.casePublicId}:</span>
                      {group.caseName}
                    </span>
                    <span className="text-xs font-bold font-mono px-2 py-0.5 rounded border border-red-600 text-red-700">
                      FAILED
                    </span>
                  </div>

                  {group.firstFailure && (
                    <div className="mt-2 bg-red-50 border border-red-200 rounded p-2 text-xs font-mono text-red-900">
                      <div className="font-semibold text-red-800">Failure Details:</div>
                      <div className="mt-1 whitespace-pre-wrap">{group.firstFailure}</div>
                    </div>
                  )}

                  {/* Feedback area */}
                  {note ? (
                    <div
                      data-testid={`print-feedback-${group.caseId}`}
                      className="mt-3 bg-gray-50 border border-gray-300 rounded p-3 text-xs"
                    >
                      <div className="font-bold text-gray-700 uppercase tracking-wider text-[10px] mb-1">
                        Reviewer Feedback / Follow-up Notes
                      </div>
                      <div className="text-gray-900 whitespace-pre-wrap">{note}</div>
                    </div>
                  ) : (
                    <div
                      data-testid={`print-feedback-ruled-${group.caseId}`}
                      className="mt-3 border border-dashed border-gray-400 rounded p-2 min-h-[72px]"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(transparent, transparent 23px, #e5e7eb 23px, #e5e7eb 24px)",
                      }}
                    >
                      <div className="font-bold text-gray-500 uppercase tracking-wider text-[10px]">
                        Reviewer Notes / Follow-up (Handwritten):
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Passed Tests Section (compact) */}
      {passedGroups.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="text-sm font-bold border-b border-gray-300 pb-1 mb-2 text-gray-700">
            Passed Test Cases ({passedGroups.length})
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700">
            {passedGroups.map((group) => (
              <li key={group.caseId} className="flex items-center justify-between py-0.5">
                <span className="truncate">
                  <span className="font-mono text-gray-500 mr-1.5">{group.casePublicId}</span>
                  {group.caseName}
                </span>
                <span className="font-mono text-green-700 font-semibold ml-2">PASS</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
