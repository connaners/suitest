import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CaseGroup } from "./case-grouping";
import { RunFeedbackModal } from "./RunFeedbackModal";

function makeGroup(overrides: Partial<CaseGroup> = {}): CaseGroup {
  return {
    caseId: "tc_1",
    casePublicId: "TC-101",
    caseName: "Login flow",
    steps: [],
    total: 3,
    passed: 2,
    failed: 1,
    rollup: "fail",
    durationMs: 1200,
    kind: "frontend",
    firstFailure: "Element not found",
    ...overrides,
  };
}

describe("<RunFeedbackModal>", () => {
  it("renders thread card for each failed test case with textarea", () => {
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", caseName: "Login test" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", caseName: "Payment test" }),
    ];

    render(
      <RunFeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1001"
        groups={groups}
        feedback={{ tc_1: "Initial note" }}
        onFeedbackChange={vi.fn()}
        onPrint={vi.fn()}
      />,
    );

    expect(screen.getByTestId("run-feedback-modal")).toBeInTheDocument();
    expect(screen.getByText("Login test")).toBeInTheDocument();
    expect(screen.getByText(/TC-101/)).toBeInTheDocument();
    expect(screen.getByText("Payment test")).toBeInTheDocument();
    expect(screen.getByText(/TC-102/)).toBeInTheDocument();

    const textarea1 = screen.getByTestId("feedback-input-tc_1") as HTMLTextAreaElement;
    expect(textarea1.value).toBe("Initial note");
  });

  it("calls onFeedbackChange when user types in textarea", async () => {
    const user = userEvent.setup();
    const onFeedbackChange = vi.fn();
    const groups = [makeGroup({ caseId: "tc_1" })];

    render(
      <RunFeedbackModal
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1001"
        groups={groups}
        feedback={{}}
        onFeedbackChange={onFeedbackChange}
        onPrint={vi.fn()}
      />,
    );

    const textarea = screen.getByTestId("feedback-input-tc_1");
    await user.type(textarea, "Investigating root cause");

    expect(onFeedbackChange).toHaveBeenCalled();
  });

  it("invokes onPrint and triggers print action", async () => {
    const user = userEvent.setup();
    const onPrint = vi.fn();
    const onOpenChange = vi.fn();
    const groups = [makeGroup({ caseId: "tc_1" })];

    render(
      <RunFeedbackModal
        open={true}
        onOpenChange={onOpenChange}
        runPublicId="RUN-1001"
        groups={groups}
        feedback={{}}
        onFeedbackChange={vi.fn()}
        onPrint={onPrint}
      />,
    );

    const printBtn = screen.getByTestId("modal-print-button");
    await user.click(printBtn);

    expect(onPrint).toHaveBeenCalledTimes(1);
  });
});
