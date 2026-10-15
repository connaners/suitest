import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditSuiteDialog } from "@/components/cases/EditSuiteDialog";
import type { components } from "@/lib/api-types";
import { server } from "@/mocks/server";
import { useActiveProject } from "@/stores/use-active-project";
import { useActiveWorkspace } from "@/stores/use-active-workspace";

type SuitePublic = components["schemas"]["SuitePublic"];

const MOCK_SUITE: SuitePublic = {
  id: "ste_1",
  project_id: "prj_demo",
  name: "Auth flow",
  description: "Handles user login and signup",
  order: 0,
  case_count: 2,
  default_testing_approach: "BLACK_BOX",
  created_at: "2026-06-28T00:00:00Z",
  updated_at: "2026-06-28T00:00:00Z",
};

function renderDialog(props?: Partial<React.ComponentProps<typeof EditSuiteDialog>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <EditSuiteDialog open onClose={onClose} suite={MOCK_SUITE} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("EditSuiteDialog", () => {
  beforeEach(() => {
    useActiveWorkspace.setState({ workspaceId: "ws_demo" });
    useActiveProject.setState({ projectId: "prj_demo" });
  });
  afterEach(() => {
    useActiveWorkspace.setState({ workspaceId: null });
    useActiveProject.setState({ projectId: null });
  });

  it("prefills current suite name and default approach", () => {
    renderDialog();
    expect(screen.getByTestId("edit-suite-name")).toHaveValue("Auth flow");
    expect(screen.getByTestId("edit-suite-approach")).toHaveValue("BLACK_BOX");
  });

  it("updates suite details via PATCH and closes dialog", async () => {
    const user = userEvent.setup();
    let capturedBody: { name?: string; defaultTestingApproach?: string } = {};

    server.use(
      http.patch("*/api/v1/suites/:suiteId", async ({ params, request }) => {
        expect(params["suiteId"]).toBe("ste_1");
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({
          ...MOCK_SUITE,
          ...capturedBody,
        });
      }),
    );

    const { onClose } = renderDialog();
    const nameInput = screen.getByTestId("edit-suite-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Authentication & SSO");

    await user.selectOptions(screen.getByTestId("edit-suite-approach"), "WHITE_BOX");
    await user.click(screen.getByTestId("edit-suite-submit"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(capturedBody.name).toBe("Authentication & SSO");
    expect(capturedBody.defaultTestingApproach).toBe("WHITE_BOX");
  });

  it("displays error message when update fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch("*/api/v1/suites/:suiteId", () => new HttpResponse(null, { status: 400 })),
    );

    renderDialog();
    const nameInput = screen.getByTestId("edit-suite-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Fail update");
    await user.click(screen.getByTestId("edit-suite-submit"));

    expect(await screen.findByTestId("edit-suite-error")).toBeInTheDocument();
  });

  it("disables submit button when name is empty", async () => {
    const user = userEvent.setup();
    renderDialog();
    const nameInput = screen.getByTestId("edit-suite-name");
    await user.clear(nameInput);
    expect(screen.getByTestId("edit-suite-submit")).toBeDisabled();
  });

  it("shows confirmation and deletes suite via DELETE", async () => {
    const user = userEvent.setup();
    let deletedId: string | undefined;
    let confirmCascade: string | null = null;

    server.use(
      http.delete("*/api/v1/suites/:suiteId", ({ params, request }) => {
        deletedId = params["suiteId"] as string;
        const url = new URL(request.url);
        confirmCascade = url.searchParams.get("confirmCascade");
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { onClose } = renderDialog();
    await user.click(screen.getByTestId("delete-suite-trigger"));

    expect(screen.getByTestId("delete-suite-confirm-pane")).toBeInTheDocument();
    await user.click(screen.getByTestId("delete-suite-confirm"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(deletedId).toBe("ste_1");
    expect(confirmCascade).toBe("true");
  });

  it("cancels deletion confirmation when cancel is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByTestId("delete-suite-trigger"));
    expect(screen.getByTestId("delete-suite-confirm-pane")).toBeInTheDocument();

    await user.click(screen.getByTestId("delete-suite-cancel"));
    expect(screen.queryByTestId("delete-suite-confirm-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-suite-name")).toBeInTheDocument();
  });

  it("displays error message when delete fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.delete("*/api/v1/suites/:suiteId", () => new HttpResponse(null, { status: 500 })),
    );

    renderDialog();
    await user.click(screen.getByTestId("delete-suite-trigger"));
    await user.click(screen.getByTestId("delete-suite-confirm"));

    expect(await screen.findByTestId("delete-suite-error")).toBeInTheDocument();
  });
});
