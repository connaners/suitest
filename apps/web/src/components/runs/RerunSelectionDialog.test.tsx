import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RerunSelectionDialog } from "@/components/runs/RerunSelectionDialog";
import type { CaseGroup } from "@/components/runs/case-grouping";

function makeGroup(overrides: Partial<CaseGroup> = {}): CaseGroup {
  return {
    caseId: "tc_1",
    casePublicId: "TC-101",
    caseName: "Login with valid credentials",
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

describe("<RerunSelectionDialog>", () => {
  it("defaults to selecting failed cases only when failures exist", () => {
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", rollup: "pass" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", rollup: "fail", failed: 1 }),
    ];

    render(
      <RerunSelectionDialog
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1001"
        groups={groups}
        onConfirm={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.getByTestId("rerun-selection-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("checkbox-case-tc_1")).not.toBeChecked();
    expect(screen.getByTestId("checkbox-case-tc_2")).toBeChecked();

    const submitBtn = screen.getByTestId("rerun-dialog-submit");
    expect(submitBtn).toHaveTextContent(/Run 1 selected test case/i);
    expect(screen.getByTestId("execution-settings-container")).toBeInTheDocument();
    expect(screen.getByTestId("execution-settings-summary")).toHaveTextContent("Headless • Failure only");
  });

  it("defaults to selecting all cases when all passed", () => {
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", rollup: "pass" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", rollup: "pass" }),
    ];

    render(
      <RerunSelectionDialog
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1002"
        groups={groups}
        onConfirm={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.getByTestId("checkbox-case-tc_1")).toBeChecked();
    expect(screen.getByTestId("checkbox-case-tc_2")).toBeChecked();

    const submitBtn = screen.getByTestId("rerun-dialog-submit");
    expect(submitBtn).toHaveTextContent(/Run all \(2\) cases/i);
  });

  it("switches presets correctly between failed only, all cases, and clear", async () => {
    const user = userEvent.setup();
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", rollup: "pass" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", rollup: "fail", failed: 1 }),
    ];

    render(
      <RerunSelectionDialog
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1001"
        groups={groups}
        onConfirm={vi.fn()}
        isPending={false}
      />,
    );

    // Initial: only failed
    expect(screen.getByTestId("checkbox-case-tc_1")).not.toBeChecked();
    expect(screen.getByTestId("checkbox-case-tc_2")).toBeChecked();

    // Click "All cases (2)"
    await user.click(screen.getByTestId("preset-select-all"));
    expect(screen.getByTestId("checkbox-case-tc_1")).toBeChecked();
    expect(screen.getByTestId("checkbox-case-tc_2")).toBeChecked();
    expect(screen.getByTestId("rerun-dialog-submit")).toHaveTextContent(/Run all \(2\) cases/i);

    // Click "Clear"
    await user.click(screen.getByTestId("preset-clear-all"));
    expect(screen.getByTestId("checkbox-case-tc_1")).not.toBeChecked();
    expect(screen.getByTestId("checkbox-case-tc_2")).not.toBeChecked();
    expect(screen.getByTestId("rerun-dialog-submit")).toBeDisabled();

    // Click "Failed only (1)"
    await user.click(screen.getByTestId("preset-failed-only"));
    expect(screen.getByTestId("checkbox-case-tc_1")).not.toBeChecked();
    expect(screen.getByTestId("checkbox-case-tc_2")).toBeChecked();
  });

  it("submits selected case IDs and default execution settings on confirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", rollup: "pass" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", rollup: "pass" }),
    ];

    render(
      <RerunSelectionDialog
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1001"
        groups={groups}
        onConfirm={onConfirm}
        isPending={false}
      />,
    );

    // Uncheck tc_1
    await user.click(screen.getByTestId("checkbox-case-tc_1"));
    await user.click(screen.getByTestId("rerun-dialog-submit"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(["tc_2"], {
      headless: true,
      screenshot: "only-on-failure",
      video: "off",
      videoQuality: "1080p",
      highlightSteps: false,
      cleanSessionBetweenCases: true,
    });
  });

  it("inherits initialSettings from previous run and allows customizing before confirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", rollup: "fail" }),
    ];

    render(
      <RerunSelectionDialog
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1001"
        groups={groups}
        onConfirm={onConfirm}
        isPending={false}
        initialSettings={{
          headless: false,
          screenshot: "on",
          highlightSteps: true,
        }}
      />,
    );

    // Shows inherited settings in summary
    expect(screen.getByTestId("execution-settings-summary")).toHaveTextContent(
      "Headed • Every step • Highlight",
    );

    // Expand settings and modify screenshot back to only-on-failure
    await user.click(screen.getByTestId("toggle-execution-settings"));
    const screenshotSelect = screen.getByTestId("config-screenshot-select");
    await user.selectOptions(screenshotSelect, "only-on-failure");

    await user.click(screen.getByTestId("rerun-dialog-submit"));
    expect(onConfirm).toHaveBeenCalledWith(["tc_1"], {
      headless: false,
      screenshot: "only-on-failure",
      video: "off",
      videoQuality: "1080p",
      highlightSteps: true,
      cleanSessionBetweenCases: true,
    });
  });

  it("handles soft-deleted cases safely by disabling their selection", async () => {
    const user = userEvent.setup();
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", rollup: "pass" }),
      makeGroup({
        caseId: "tc_del",
        casePublicId: "TC-999",
        caseName: "Old removed test",
        rollup: "fail",
        isDeleted: true,
      }),
    ];

    render(
      <RerunSelectionDialog
        open={true}
        onOpenChange={vi.fn()}
        runPublicId="RUN-1001"
        groups={groups}
        onConfirm={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.getByTestId("rerun-case-deleted-badge")).toBeInTheDocument();
    const deletedCheckbox = screen.getByTestId("checkbox-case-tc_del");
    expect(deletedCheckbox).toBeDisabled();
    expect(deletedCheckbox).not.toBeChecked();

    // Preset only accounts for active cases
    expect(screen.getByTestId("preset-select-all")).toHaveTextContent("All cases (1)");
    await user.click(screen.getByTestId("preset-select-all"));
    expect(deletedCheckbox).not.toBeChecked();
  });
});
