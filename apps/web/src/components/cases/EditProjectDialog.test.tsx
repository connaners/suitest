import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditProjectDialog } from "@/components/cases/EditProjectDialog";
import { server } from "@/mocks/server";
import { useActiveProject } from "@/stores/use-active-project";

const mockProject = {
  id: "prj_test",
  name: "Current Project",
  slug: "current-project",
  description: "Initial description",
};

function renderDialog(props?: Partial<React.ComponentProps<typeof EditProjectDialog>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <EditProjectDialog open onClose={onClose} project={mockProject} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("EditProjectDialog", () => {
  beforeEach(() => {
    useActiveProject.setState({ projectId: "prj_test" });
  });
  afterEach(() => {
    useActiveProject.setState({ projectId: null });
  });

  it("renders existing project name, description, and read-only immutable slug", () => {
    renderDialog();
    expect(screen.getByTestId("edit-project-name")).toHaveValue("Current Project");
    expect(screen.getByTestId("edit-project-description")).toHaveValue("Initial description");

    const slugInput = screen.getByTestId("edit-project-slug");
    expect(slugInput).toHaveValue("current-project");
    expect(slugInput).toBeDisabled();
    expect(screen.getByText("Slug is immutable")).toBeInTheDocument();
  });

  it("disables save button when project name is cleared", async () => {
    const user = userEvent.setup();
    renderDialog();

    const nameInput = screen.getByTestId("edit-project-name");
    await user.clear(nameInput);

    expect(screen.getByTestId("edit-project-submit")).toBeDisabled();
  });

  it("updates project name and description successfully and closes", async () => {
    const user = userEvent.setup();
    let patchedBody: Record<string, unknown> | null = null;

    server.use(
      http.patch("*/api/v1/projects/:projectId", async ({ request, params }) => {
        expect(params.projectId).toBe("prj_test");
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: "prj_test",
            workspace_id: "ws_demo",
            slug: "current-project",
            name: patchedBody.name,
            description: patchedBody.description ?? null,
            gating_suite_id: null,
            default_mcp_routing: {},
            created_at: "2026-06-28T00:00:00Z",
            updated_at: "2026-06-28T01:00:00Z",
          },
          { status: 200 },
        );
      }),
    );

    const { onClose } = renderDialog();
    const nameInput = screen.getByTestId("edit-project-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Project");

    const descInput = screen.getByTestId("edit-project-description");
    await user.clear(descInput);
    await user.type(descInput, "Updated description");

    await user.click(screen.getByTestId("edit-project-submit"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(patchedBody).toEqual({
      name: "Updated Project",
      description: "Updated description",
    });
  });

  it("shows 403 error message when user lacks permission", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch("*/api/v1/projects/:projectId", () =>
        HttpResponse.json(
          { error: { code: "FORBIDDEN", message: "insufficient role", details: {} } },
          { status: 403 },
        ),
      ),
    );

    renderDialog();
    const nameInput = screen.getByTestId("edit-project-name");
    await user.type(nameInput, " Attempt");
    await user.click(screen.getByTestId("edit-project-submit"));

    expect(await screen.findByTestId("edit-project-error")).toHaveTextContent(
      "You don't have permission to edit this project.",
    );
  });

  it("shows 409 error message when project name conflicts", async () => {
    const user = userEvent.setup();
    server.use(
      http.patch("*/api/v1/projects/:projectId", () =>
        HttpResponse.json(
          { error: { code: "DUPLICATE_PROJECT_NAME", message: "taken", details: {} } },
          { status: 409 },
        ),
      ),
    );

    renderDialog();
    const nameInput = screen.getByTestId("edit-project-name");
    await user.type(nameInput, " Collision");
    await user.click(screen.getByTestId("edit-project-submit"));

    expect(await screen.findByTestId("edit-project-error")).toHaveTextContent(
      "A project with that name already exists. Try another.",
    );
  });
});
