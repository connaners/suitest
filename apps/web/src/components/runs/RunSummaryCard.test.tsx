import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CaseGroup } from "./case-grouping";
import { RunSummaryCard } from "./RunSummaryCard";
import type { RunDetail } from "@/hooks/use-runs";

function makeRun(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "run_1",
    public_id: "RUN-1001",
    project_id: "prj_demo",
    name: "Payment verification run",
    branch: "main",
    commit_sha: "c1",
    env: "staging",
    status: "FAIL",
    trigger: "MANUAL",
    started_at: "2026-10-08T10:00:00Z",
    completed_at: "2026-10-08T10:01:00Z",
    duration_ms: 60000,
    summary: { total_steps: 5, passed_steps: 3, failed_steps: 2, duration_ms: 60000 },
    created_at: "2026-10-08T10:00:00Z",
    updated_at: "2026-10-08T10:01:00Z",
    ...overrides,
  };
}

describe("<RunSummaryCard> feedback preview", () => {
  it("renders feedback preview under summary-meta when failed cases exist", async () => {
    const user = userEvent.setup();
    const onOpenFeedback = vi.fn();
    const run = makeRun();
    const groups: CaseGroup[] = [
      {
        caseId: "tc_1",
        casePublicId: "TC-101",
        caseName: "Login flow",
        steps: [],
        total: 2,
        passed: 1,
        failed: 1,
        rollup: "fail",
        durationMs: 500,
        kind: "frontend",
        firstFailure: null,
      },
      {
        caseId: "tc_2",
        casePublicId: "TC-102",
        caseName: "Checkout flow",
        steps: [],
        total: 2,
        passed: 1,
        failed: 1,
        rollup: "fail",
        durationMs: 500,
        kind: "frontend",
        firstFailure: null,
      },
      {
        caseId: "tc_3",
        casePublicId: "TC-103",
        caseName: "Profile update",
        steps: [],
        total: 2,
        passed: 1,
        failed: 1,
        rollup: "fail",
        durationMs: 500,
        kind: "frontend",
        firstFailure: null,
      },
    ];
    const feedback = {
      tc_1: "Credential issue on server",
    };

    render(
      <RunSummaryCard
        run={run}
        groups={groups}
        feedback={feedback}
        onOpenFeedbackModal={onOpenFeedback}
      />,
    );

    const section = screen.getByTestId("run-feedback-preview-section");
    expect(section).toBeInTheDocument();
    expect(screen.getByText(/Failed Test Review/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 noted/i)).toBeInTheDocument();

    expect(screen.getByText(/TC-101/)).toBeInTheDocument();
    expect(screen.getByText(/Credential issue on server/)).toBeInTheDocument();

    const openBtn = screen.getByTestId("open-feedback-threads-btn");
    await user.click(openBtn);
    expect(onOpenFeedback).toHaveBeenCalledTimes(1);
  });

  it("does not render feedback preview when run has no failed cases", () => {
    const run = makeRun({
      status: "PASS",
      summary: { total_steps: 5, passed_steps: 5, failed_steps: 0, duration_ms: 50000 },
    });

    render(
      <RunSummaryCard
        run={run}
        groups={[]}
        feedback={{}}
        onOpenFeedbackModal={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("run-feedback-preview-section")).not.toBeInTheDocument();
  });
});
