import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CaseDetailPanel } from "@/components/runs/CaseDetailPanel";
import type { CaseGroup } from "@/components/runs/case-grouping";
import type { components } from "@/lib/api-types";
import { server } from "@/mocks/server";

type RunStepPublic = components["schemas"]["RunStepPublic"];

function makeStep(order: number, title: string, outcome: components["schemas"]["StepOutcome"]): RunStepPublic {
  return {
    id: `step_${order}`,
    run_id: "run_1",
    case_id: "tc_1",
    case_public_id: "TC-101",
    case_name: "Checkout",
    case_title: "Checkout test",
    step_order: order,
    title,
    type: "action",
    outcome,
    duration_ms: 200,
  };
}

function renderPanel(
  group: CaseGroup,
  runStatus: components["schemas"]["RunStatus"] = "PASS",
  onRerunCase?: (caseId: string) => void,
  hasMultipleCases = true,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const rootRoute = createRootRoute({
    component: () => (
      <CaseDetailPanel
        runId="run_1"
        group={group}
        artifacts={[]}
        runStatus={runStatus}
        onRerunCase={onRerunCase}
        hasMultipleCases={hasMultipleCases}
      />
    ),
  });

  const casesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/cases",
    component: () => <div />,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([casesRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("<CaseDetailPanel>", () => {
  beforeEach(() => {
    server.use(
      http.get("*/api/v1/test-cases/:id", () =>
        HttpResponse.json({
          id: "tc_1",
          description: "A test case description",
          automation_code: "test('checkout', async () => {});",
        }),
      ),
      http.get("*/api/v1/runs/:id/logs", () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );
  });

  it("Terminal Freeze Guard: does NOT query planned steps when run is completed", async () => {
    let stepsEndpointQueried = false;
    server.use(
      http.get("*/api/v1/test-cases/:id/steps", () => {
        stepsEndpointQueried = true;
        return HttpResponse.json([
          { id: "new_step", order: 99, action: "Newly added step in editor" },
        ]);
      }),
    );

    const group: CaseGroup = {
      caseId: "tc_1",
      casePublicId: "TC-101",
      caseName: "Checkout",
      steps: [makeStep(1, "Recorded step in history", "PASS")],
      total: 1,
      passed: 1,
      failed: 0,
      rollup: "pass",
      durationMs: 200,
      kind: "frontend",
      firstFailure: null,
    };

    renderPanel(group, "PASS");

    // History preserves the step recorded at run time
    expect(await screen.findByText("Recorded step in history")).toBeInTheDocument();
    // Step added to /cases later is NOT fetched
    expect(stepsEndpointQueried).toBe(false);
    expect(screen.queryByText("Newly added step in editor")).not.toBeInTheDocument();
  });

  it("renders Re-run case button for terminal runs and calls onRerunCase on click when hasMultipleCases is true", async () => {
    const user = userEvent.setup();
    const onRerunCase = vi.fn();
    const group: CaseGroup = {
      caseId: "tc_1",
      casePublicId: "TC-101",
      caseName: "Checkout",
      steps: [makeStep(1, "Step 1", "FAIL")],
      total: 1,
      passed: 0,
      failed: 1,
      rollup: "fail",
      durationMs: 200,
      kind: "frontend",
      firstFailure: "Element not found",
    };

    renderPanel(group, "FAIL", onRerunCase, true);

    const rerunBtn = await screen.findByTestId("case-rerun-button");
    expect(rerunBtn).toBeInTheDocument();
    expect(rerunBtn).toHaveTextContent(/Re-run case/i);

    await user.click(rerunBtn);
    expect(onRerunCase).toHaveBeenCalledTimes(1);
    expect(onRerunCase).toHaveBeenCalledWith("tc_1");
  });

  it("hides Edit case and Re-run case buttons when hasMultipleCases is false", async () => {
    const onRerunCase = vi.fn();
    const group: CaseGroup = {
      caseId: "tc_1",
      casePublicId: "TC-101",
      caseName: "Checkout",
      steps: [makeStep(1, "Step 1", "FAIL")],
      total: 1,
      passed: 0,
      failed: 1,
      rollup: "fail",
      durationMs: 200,
      kind: "frontend",
      firstFailure: "Element not found",
    };

    renderPanel(group, "FAIL", onRerunCase, false);

    expect(await screen.findByTestId("case-detail-title")).toBeInTheDocument();
    expect(screen.queryByTestId("case-edit-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("case-rerun-button")).not.toBeInTheDocument();
  });

  it("handles soft-deleted cases: renders Deleted case badge, banner, and hides Re-run case", async () => {
    const group: CaseGroup = {
      caseId: "tc_del",
      casePublicId: "TC-999",
      caseName: "Deleted flow",
      steps: [makeStep(1, "Step 1", "PASS")],
      total: 1,
      passed: 1,
      failed: 0,
      rollup: "pass",
      durationMs: 200,
      kind: "frontend",
      firstFailure: null,
      isDeleted: true,
    };

    renderPanel(group, "PASS", vi.fn());

    expect(await screen.findByTestId("case-deleted-badge")).toBeInTheDocument();
    expect(await screen.findByTestId("case-deleted-banner")).toHaveTextContent(
      /Historical snapshot: This test case is deleted from the workspace/i,
    );
    expect(screen.queryByTestId("case-edit-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("case-rerun-button")).not.toBeInTheDocument();
  });

  it("retains aborted steps and displays assertive messaging when run is cancelled", async () => {
    server.use(
      http.get("*/api/v1/test-cases/:id/steps", () =>
        HttpResponse.json([
          { id: "step_1", order: 1, action: "Navigate to home" },
          { id: "step_2", order: 2, action: "Click submit" },
        ]),
      ),
    );

    const group: CaseGroup = {
      caseId: "tc_1",
      casePublicId: "TC-101",
      caseName: "Checkout",
      steps: [makeStep(1, "Navigate to home", "PASS")],
      total: 2,
      passed: 1,
      failed: 0,
      rollup: "aborted",
      durationMs: 200,
      kind: "frontend",
      firstFailure: null,
    };

    renderPanel(group, "CANCELLED");

    expect(await screen.findByText("Navigate to home")).toBeInTheDocument();
    expect(await screen.findByText("Click submit")).toBeInTheDocument();
    expect((await screen.findAllByText("ABORTED")).length).toBeGreaterThanOrEqual(1);
    expect(
      await screen.findByText(/Step was not executed because the test run was cancelled by user/i),
    ).toBeInTheDocument();
  });

  it("queued case in live run renders unexecuted planned steps as QUEUED, not RUNNING", async () => {
    server.use(
      http.get("*/api/v1/test-cases/:id/steps", () =>
        HttpResponse.json([
          { id: "step_1", order: 1, action: "Navigate to page" },
          { id: "step_2", order: 2, action: "Click button" },
        ]),
      ),
    );

    const group: CaseGroup = {
      caseId: "tc_1",
      casePublicId: "TC-101",
      caseName: "Queued Case",
      steps: [],
      total: 2,
      passed: 0,
      failed: 0,
      rollup: "queued",
      durationMs: 0,
      kind: "frontend",
      firstFailure: null,
    };

    renderPanel(group, "RUNNING");

    expect(await screen.findByText("Navigate to page")).toBeInTheDocument();
    expect(await screen.findByText("Click button")).toBeInTheDocument();
    expect(screen.queryByText("RUNNING")).not.toBeInTheDocument();

    const stepRows = screen.getAllByTestId("step-row");
    expect(stepRows).toHaveLength(2);
    expect(stepRows[0]).toHaveTextContent("QUEUED");
    expect(stepRows[1]).toHaveTextContent("QUEUED");
  });

  it("HTTP 500 error on case description fetch does NOT mark case as deleted", async () => {
    server.use(
      http.get("*/api/v1/test-cases/:id", () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const group: CaseGroup = {
      caseId: "tc_1",
      casePublicId: "TC-101",
      caseName: "Active Case with 500",
      steps: [makeStep(1, "Step 1", "PASS")],
      total: 1,
      passed: 1,
      failed: 0,
      rollup: "pass",
      durationMs: 200,
      kind: "frontend",
      firstFailure: null,
    };

    renderPanel(group, "PASS", vi.fn());

    expect(await screen.findByTestId("case-detail-title")).toBeInTheDocument();
    expect(screen.queryByTestId("case-deleted-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("case-deleted-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("case-rerun-button")).toBeInTheDocument();
  });
});
