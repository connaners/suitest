import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CaseList } from "@/components/runs/CaseList";
import type { CaseGroup } from "@/components/runs/case-grouping";

function makeGroup(overrides: Partial<CaseGroup> = {}): CaseGroup {
  return {
    caseId: "tc_1",
    casePublicId: "TC-101",
    caseName: "Login Flow",
    steps: [],
    total: 3,
    passed: 3,
    failed: 0,
    rollup: "pass",
    durationMs: 1000,
    kind: "frontend",
    firstFailure: null,
    ...overrides,
  };
}

describe("<CaseList>", () => {
  it("renders empty state when there are no test cases", () => {
    render(<CaseList groups={[]} selectedCaseId={null} onSelectCase={vi.fn()} />);
    expect(screen.getByTestId("case-list-empty")).toBeInTheDocument();
  });

  it("does not show filter pills when all test cases passed", () => {
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", rollup: "pass" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", rollup: "pass" }),
    ];

    render(<CaseList groups={groups} selectedCaseId="tc_1" onSelectCase={vi.fn()} />);
    expect(screen.queryByTestId("case-list-filters")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("case-row")).toHaveLength(2);
  });

  it("shows filter pills and filters to failed cases when clicked", async () => {
    const user = userEvent.setup();
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", caseName: "Passed Auth", rollup: "pass" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", caseName: "Failed Payment", rollup: "fail", failed: 1 }),
      makeGroup({ caseId: "tc_3", casePublicId: "TC-103", caseName: "Aborted Review", rollup: "aborted" }),
    ];

    render(<CaseList groups={groups} selectedCaseId="tc_1" onSelectCase={vi.fn()} />);

    expect(screen.getByTestId("case-list-filters")).toBeInTheDocument();
    expect(screen.getByTestId("case-filter-all")).toHaveTextContent("All (3)");
    expect(screen.getByTestId("case-filter-failed")).toHaveTextContent("Failed (2)");

    // Initial: all rows visible
    expect(screen.getAllByTestId("case-row")).toHaveLength(3);

    // Filter to failed only
    await user.click(screen.getByTestId("case-filter-failed"));
    const failedRows = screen.getAllByTestId("case-row");
    expect(failedRows).toHaveLength(2);
    expect(screen.queryByText("Passed Auth")).not.toBeInTheDocument();
    expect(screen.getByText("Failed Payment")).toBeInTheDocument();
    expect(screen.getByText("Aborted Review")).toBeInTheDocument();

    // Switch back to all
    await user.click(screen.getByTestId("case-filter-all"));
    expect(screen.getAllByTestId("case-row")).toHaveLength(3);
  });

  it("renders aborted count in subtitle when a case fails with unexecuted steps", () => {
    const groups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_fail",
        casePublicId: "TC-102",
        caseName: "Payment flow",
        total: 8,
        passed: 1,
        failed: 1,
        rollup: "fail",
      }),
    ];

    render(<CaseList groups={groups} selectedCaseId="tc_fail" onSelectCase={vi.fn()} />);

    expect(screen.getByTestId("case-row-counts")).toHaveTextContent(
      "8 steps · 1 passed · 1 failed · 6 aborted",
    );
  });

  it("automatically resets filter to 'all' when switching to groups with 0 failures", async () => {
    const user = userEvent.setup();
    const failingGroups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-101", caseName: "Passing", rollup: "pass" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-102", caseName: "Failing", rollup: "fail", failed: 1 }),
    ];

    const { rerender } = render(
      <CaseList groups={failingGroups} selectedCaseId="tc_1" onSelectCase={vi.fn()} />,
    );

    // Filter to failed only
    await user.click(screen.getByTestId("case-filter-failed"));
    expect(screen.getAllByTestId("case-row")).toHaveLength(1);

    // Switch to all-pass run
    const passingGroups: CaseGroup[] = [
      makeGroup({ caseId: "tc_3", casePublicId: "TC-103", caseName: "Run B Case 1", rollup: "pass" }),
      makeGroup({ caseId: "tc_4", casePublicId: "TC-104", caseName: "Run B Case 2", rollup: "pass" }),
    ];
    rerender(
      <CaseList groups={passingGroups} selectedCaseId="tc_3" onSelectCase={vi.fn()} />,
    );

    // Filters are hidden and both cases are visible (filter was reset to 'all')
    expect(screen.queryByTestId("case-list-filters")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("case-row")).toHaveLength(2);
    expect(screen.getByText("Run B Case 1")).toBeInTheDocument();
    expect(screen.getByText("Run B Case 2")).toBeInTheDocument();
  });

  it("filters test cases in real-time by search query (id and name) and supports clearing", async () => {
    const user = userEvent.setup();
    const groups: CaseGroup[] = [
      makeGroup({ caseId: "tc_1", casePublicId: "TC-1001", caseName: "Login Authentication" }),
      makeGroup({ caseId: "tc_2", casePublicId: "TC-1002", caseName: "File Upload Flow" }),
      makeGroup({ caseId: "tc_3", casePublicId: "TC-2001", caseName: "Checkout Payment" }),
    ];

    render(<CaseList groups={groups} selectedCaseId="tc_1" onSelectCase={vi.fn()} />);

    const searchInput = screen.getByTestId("case-list-search-input");
    expect(searchInput).toBeInTheDocument();
    expect(screen.getAllByTestId("case-row")).toHaveLength(3);

    // Search by public ID
    await user.type(searchInput, "2001");
    expect(screen.getAllByTestId("case-row")).toHaveLength(1);
    expect(screen.getByText("Checkout Payment")).toBeInTheDocument();
    expect(screen.queryByText("Login Authentication")).not.toBeInTheDocument();

    // Clear search using clear button
    const clearBtn = screen.getByTestId("case-list-search-clear");
    await user.click(clearBtn);
    expect(screen.getAllByTestId("case-row")).toHaveLength(3);

    // Search by case name
    await user.type(searchInput, "upload");
    expect(screen.getAllByTestId("case-row")).toHaveLength(1);
    expect(screen.getByText("File Upload Flow")).toBeInTheDocument();

    // Search with no matching results
    await user.clear(searchInput);
    await user.type(searchInput, "nonexistent-xyz");
    expect(screen.queryAllByTestId("case-row")).toHaveLength(0);
    expect(screen.getByTestId("case-list-no-search-results")).toHaveTextContent(
      /No test cases matching .nonexistent-xyz./,
    );
  });

  it("renders active step as 'running' and remaining unexecuted steps as 'queued' during live runs", () => {
    const runningGroups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_live",
        casePublicId: "TC-201",
        caseName: "Live In-Progress Case",
        total: 4,
        passed: 1,
        failed: 0,
        rollup: "running",
      }),
    ];

    render(
      <CaseList
        groups={runningGroups}
        selectedCaseId="tc_live"
        onSelectCase={vi.fn()}
        runStatus="RUNNING"
      />,
    );

    const counts = screen.getByTestId("case-row-counts");
    expect(counts).toHaveTextContent("4 steps · 1 passed · 1 running · 2 queued");
    expect(counts).not.toHaveTextContent("skipped");
  });

  it("renders running case with 0 passed steps as '1 running · N queued'", () => {
    const startingGroups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_starting",
        casePublicId: "TC-203",
        caseName: "Starting Case",
        total: 3,
        passed: 0,
        failed: 0,
        rollup: "running",
      }),
    ];

    render(
      <CaseList
        groups={startingGroups}
        selectedCaseId="tc_starting"
        onSelectCase={vi.fn()}
        runStatus="RUNNING"
      />,
    );

    const counts = screen.getByTestId("case-row-counts");
    expect(counts).toHaveTextContent("3 steps · 1 running · 2 queued");
    expect(counts).not.toHaveTextContent("skipped");
  });

  it("renders pending cases with 0 executed steps as 'Queued' during live runs", () => {
    const queuedGroups: CaseGroup[] = [
      makeGroup({
        caseId: "tc_queued",
        casePublicId: "TC-202",
        caseName: "Queued Waiting Case",
        total: 5,
        passed: 0,
        failed: 0,
        rollup: "queued",
      }),
    ];

    render(
      <CaseList
        groups={queuedGroups}
        selectedCaseId="tc_queued"
        onSelectCase={vi.fn()}
        runStatus="RUNNING"
      />,
    );

    const counts = screen.getByTestId("case-row-counts");
    expect(counts).toHaveTextContent("5 steps · Queued");
    expect(counts).not.toHaveTextContent("skipped");
  });
});

