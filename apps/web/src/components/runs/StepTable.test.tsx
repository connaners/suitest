import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StepTable } from "@/components/runs/StepTable";
import type { components } from "@/lib/api-types";

type RunStepPublic = components["schemas"]["RunStepPublic"];

function step(overrides: Partial<RunStepPublic> = {}): RunStepPublic {
  return {
    id: "rs_01",
    run_id: "run_1",
    case_id: "tc_1",
    case_public_id: "TC-1004",
    step_order: 0,
    outcome: "PASS",
    ...overrides,
  } as RunStepPublic;
}

describe("<StepTable>", () => {
  it("shows what a step's tool returned", () => {
    // A diagnostic step — an event recording, a tree dump — carries its whole
    // answer in stdout, so a table that only renders errors makes a passing
    // step look like it did nothing.
    render(<StepTable steps={[step({ stdout: '{"events": [{"result": "Ignored"}]}' })]} />);

    expect(screen.getByTestId("step-output")).toBeInTheDocument();
    expect(screen.getByText(/"result": "Ignored"/)).toBeInTheDocument();
  });

  it("renders no output block when the step returned nothing", () => {
    render(<StepTable steps={[step()]} />);
    expect(screen.queryByTestId("step-output")).not.toBeInTheDocument();
  });

  it("encapsulates step numbers to 1-indexed relative position per case", () => {
    // Step has global step_order 42 (from earlier cases in the run), but within
    // this case it should render relative index 1.
    render(
      <StepTable
        steps={[
          step({ id: "s1", step_order: 42, type: "action" }),
          step({ id: "s2", step_order: 43, type: "assertion" }),
        ]}
      />,
    );

    const rows = screen.getAllByTestId("step-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent("action · step 1");
    expect(rows[1]).toHaveTextContent("2");
    expect(rows[1]).toHaveTextContent("assertion · step 2");
  });
});
