import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TestCaseDataSheet } from "./TestCaseDataSheet";

const mockReplaceStepsMutate = vi.fn().mockResolvedValue({});
vi.mock("@/hooks/use-test-cases", () => ({
  useUpdateTestCase: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useReplaceSteps: () => ({
    mutateAsync: mockReplaceStepsMutate,
    isPending: false,
  }),
}));

const mockCase = {
  id: "c1",
  public_id: "TC-101",
  name: "Login test",
  dataset_schema: ["base_url", "user_role"],
  dataset_rows: [
    {
      id: "r1",
      name: "Admin Role",
      enabled: true,
      values: { base_url: "https://admin.test", user_role: "admin" },
    },
  ],
} as unknown as Parameters<typeof TestCaseDataSheet>[0]["testCase"];

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("<TestCaseDataSheet>", () => {
  it("renders data matrix columns and rows", () => {
    renderWithClient(
      <TestCaseDataSheet
        testCase={mockCase}
        steps={[{ action: "Type {{password}} into #pass" }]}
      />
    );

    expect(screen.getByText("In-Case Test Data Matrix (DDT)")).toBeInTheDocument();
    expect(screen.getByText("{{base_url}}")).toBeInTheDocument();
    expect(screen.getByText("{{user_role}}")).toBeInTheDocument();
    // Auto-detected from step
    expect(screen.getByText("{{password}}")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Admin Role")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://admin.test")).toBeInTheDocument();
  });

  it("adds a new dataset matrix row on button click", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <TestCaseDataSheet
        testCase={mockCase}
        steps={[]}
      />
    );
    const addBtn = screen.getAllByRole("button", { name: /add scenario/i })[0]!;
    await user.click(addBtn);
    expect(screen.getByDisplayValue("Dataset Matrix #2")).toBeInTheDocument();
  });

  it("renames a variable column, preserves cell values, and auto-updates referencing steps", async () => {
    const user = userEvent.setup();
    const caseWithSteps = {
      ...mockCase,
      steps: [
        {
          id: "step-1",
          order: 1,
          action: "Navigate to {{base_url}}/login",
          expected: "",
          code: JSON.stringify({ tool: "browser_navigate", arguments: { url: "{{base_url}}/login" } }),
        },
      ],
    } as unknown as Parameters<typeof TestCaseDataSheet>[0]["testCase"];

    renderWithClient(
      <TestCaseDataSheet
        testCase={caseWithSteps}
        steps={[]}
        canWrite={true}
      />
    );

    // Find rename button for base_url
    const renameBtn = screen.getByTitle("Rename base_url variable");
    await user.click(renameBtn);

    const renameInput = screen.getByDisplayValue("base_url");
    await user.clear(renameInput);
    await user.type(renameInput, "root_domain{enter}");

    expect(screen.getByText("{{root_domain}}")).toBeInTheDocument();
    expect(screen.queryByText("{{base_url}}")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("https://admin.test")).toBeInTheDocument();

    // Verify auto-updated steps call
    expect(mockReplaceStepsMutate).toHaveBeenCalled();
    const firstCall = mockReplaceStepsMutate.mock.calls[0] as [{ steps: Array<{ action: string; code: string }> }] | undefined;
    expect(firstCall?.[0]?.steps?.[0]?.action).toBe("Navigate to {{root_domain}}/login");
    expect(firstCall?.[0]?.steps?.[0]?.code).toContain("{{root_domain}}/login");
  });

  it("toggles between compact matrix and classic table views", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <TestCaseDataSheet
        testCase={mockCase}
        steps={[]}
        canWrite={true}
      />
    );

    // Default is Compact Matrix
    expect(screen.getByRole("button", { name: /compact matrix/i })).toBeInTheDocument();
    expect(screen.getByText("Parameters & Variables")).toBeInTheDocument();

    // Toggle to Classic Table
    await user.click(screen.getByRole("button", { name: /compact matrix/i }));
    expect(screen.getByRole("button", { name: /classic table/i })).toBeInTheDocument();
    expect(screen.getByText("Scenario / Role Name")).toBeInTheDocument();
  });

  it("permanently deletes a variable column without resurrection from steps", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithClient(
      <TestCaseDataSheet
        testCase={mockCase}
        steps={[{ action: "Navigate to {{base_url}}" }]}
        canWrite={true}
      />
    );

    expect(screen.getByText("{{base_url}}")).toBeInTheDocument();

    // Delete base_url
    const deleteBtn = screen.getByTitle("Remove base_url column");
    await user.click(deleteBtn);
    // Deleted from table
    expect(screen.queryByTitle("Remove base_url column")).not.toBeInTheDocument();
    expect(screen.getByTitle("Click to add {{base_url}} column to this dataset")).toBeInTheDocument();

    // Simulate saving changes
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    // Simulate server re-render with updated testCase
    rerender(
      <TestCaseDataSheet
        testCase={{ ...mockCase, dataset_schema: ["user_role"] } as unknown as Parameters<typeof TestCaseDataSheet>[0]["testCase"]}
        steps={[{ action: "Navigate to {{base_url}}" }]}
        canWrite={true}
      />
    );

    // base_url column must NOT resurrect in table
    expect(screen.queryByTitle("Remove base_url column")).not.toBeInTheDocument();
    expect(screen.getByTitle("Remove user_role column")).toBeInTheDocument();
  });
});
