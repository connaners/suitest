import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CaseGroup } from "./case-grouping";
import { PrintableRunReport } from "./PrintableRunReport";
import type { RunDetail } from "@/hooks/use-runs";

function makeRun(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: "run_123",
    public_id: "RUN-1001",
    project_id: "prj_demo",
    name: "Regression Test Suite",
    branch: "main",
    commit_sha: "abcd123",
    env: "staging",
    status: "FAIL",
    trigger: "MANUAL",
    started_at: "2026-10-08T10:00:00Z",
    completed_at: "2026-10-08T10:01:30Z",
    duration_ms: 90000,
    summary: { total_steps: 10, passed_steps: 8, failed_steps: 2, duration_ms: 90000 },
    created_at: "2026-10-08T10:00:00Z",
    updated_at: "2026-10-08T10:01:30Z",
    ...overrides,
  };
}

function makeGroup(overrides: Partial<CaseGroup> = {}): CaseGroup {
  return {
    caseId: "tc_1",
    casePublicId: "TC-101",
    caseName: "Login flow",
    steps: [],
    total: 3,
    passed: 3,
    failed: 0,
    rollup: "pass",
    durationMs: 1200,
    kind: "frontend",
    firstFailure: null,
    ...overrides,
  };
}

describe("<PrintableRunReport> (Issue #240 AC)", () => {
  it("AC 1 & AC 2: renders entered feedback visibly beside the corresponding failed test", () => {
    const run = makeRun();
    const groups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_fail_1",
        casePublicId: "TC-102",
        caseName: "Checkout payment fails",
        rollup: "fail",
        failed: 1,
        firstFailure: "Timeout 5000ms waiting for payment gateway response",
      }),
    ];
    const feedback = {
      tc_fail_1: "Gateway sandbox was down during test execution. Jira issue #1209 filed.",
    };

    render(<PrintableRunReport run={run} groups={groups} feedback={feedback} />);

    expect(screen.getByTestId("printable-run-report")).toBeInTheDocument();
    expect(screen.getByText("RUN-1001")).toBeInTheDocument();
    expect(screen.getByText(/Checkout payment fails/)).toBeInTheDocument();
    expect(screen.getByText(/Timeout 5000ms waiting for payment gateway/i)).toBeInTheDocument();

    const feedbackSection = screen.getByTestId("print-feedback-tc_fail_1");
    expect(feedbackSection).toHaveTextContent(
      "Gateway sandbox was down during test execution. Jira issue #1209 filed.",
    );
    expect(screen.queryByTestId("print-feedback-ruled-tc_fail_1")).not.toBeInTheDocument();
  });

  it("AC 3: maintains separate feedback associations across multiple failed tests", () => {
    const run = makeRun();
    const groups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_fail_1",
        casePublicId: "TC-101",
        caseName: "Test Alpha",
        rollup: "fail",
        failed: 1,
      }),
      makeGroup({
        caseId: "tc_fail_2",
        casePublicId: "TC-102",
        caseName: "Test Beta",
        rollup: "fail",
        failed: 1,
      }),
    ];
    const feedback = {
      tc_fail_1: "Note for Alpha only",
      tc_fail_2: "Note for Beta only",
    };

    render(<PrintableRunReport run={run} groups={groups} feedback={feedback} />);

    expect(screen.getByTestId("print-feedback-tc_fail_1")).toHaveTextContent("Note for Alpha only");
    expect(screen.getByTestId("print-feedback-tc_fail_1")).not.toHaveTextContent("Note for Beta only");

    expect(screen.getByTestId("print-feedback-tc_fail_2")).toHaveTextContent("Note for Beta only");
    expect(screen.getByTestId("print-feedback-tc_fail_2")).not.toHaveTextContent("Note for Alpha only");
  });

  it("AC 4: renders a usable ruled blank area when no feedback was entered for a failure", () => {
    const run = makeRun();
    const groups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_fail_2",
        casePublicId: "TC-103",
        caseName: "Profile avatar upload",
        rollup: "fail",
        failed: 1,
        firstFailure: "File too large error unexpected 500",
      }),
    ];

    render(<PrintableRunReport run={run} groups={groups} feedback={{}} />);

    expect(screen.getByText(/Profile avatar upload/)).toBeInTheDocument();
    const ruledArea = screen.getByTestId("print-feedback-ruled-tc_fail_2");
    expect(ruledArea).toBeInTheDocument();
    expect(ruledArea).toHaveTextContent(/Reviewer Notes \/ Follow-up/i);
  });

  it("AC 5: preserves existing test failure details and step actions unobscured", () => {
    const run = makeRun();
    const groups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_fail_3",
        casePublicId: "TC-104",
        caseName: "Cart calculation",
        rollup: "fail",
        failed: 1,
        firstFailure: "Expected $50.00, received $45.00",
      }),
    ];

    render(
      <PrintableRunReport
        run={run}
        groups={groups}
        feedback={{ tc_fail_3: "Tax discount logic bug" }}
      />,
    );

    expect(screen.getByText(/TC-104/)).toBeInTheDocument();
    expect(screen.getByText(/Expected \$50\.00, received \$45\.00/i)).toBeInTheDocument();
    expect(screen.getByTestId("print-feedback-tc_fail_3")).toHaveTextContent("Tax discount logic bug");
  });

  it("AC 6: renders passing tests compactly without blank feedback areas", () => {
    const run = makeRun();
    const groups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_pass_1",
        casePublicId: "TC-100",
        caseName: "Healthy login",
        rollup: "pass",
      }),
    ];

    render(<PrintableRunReport run={run} groups={groups} feedback={{}} />);

    expect(screen.getByText(/Healthy login/)).toBeInTheDocument();
    expect(screen.queryByTestId("print-feedback-tc_pass_1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("print-feedback-ruled-tc_pass_1")).not.toBeInTheDocument();
  });
});
