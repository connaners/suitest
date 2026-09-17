import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectPicker, type ProjectPickerProps } from "@/components/shell/ProjectPicker";
import { server } from "@/mocks/server";
import { useActiveProject } from "@/stores/use-active-project";

const mockProjects = [
  {
    id: "prj_1",
    workspace_id: "ws_default",
    name: "Frontend App",
    slug: "frontend-app",
    description: "Web frontend test suite",
    gating_suite_id: null,
    default_mcp_routing: {},
    created_at: "2026-06-28T00:00:00Z",
    updated_at: "2026-06-28T00:00:00Z",
  },
  {
    id: "prj_2",
    workspace_id: "ws_default",
    name: "Backend API",
    slug: "backend-api",
    description: "Core REST service test suite",
    gating_suite_id: null,
    default_mcp_routing: {},
    created_at: "2026-06-28T00:00:00Z",
    updated_at: "2026-06-28T00:00:00Z",
  },
];

function renderProjectPicker(props: ProjectPickerProps = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectPicker {...props} />
    </QueryClientProvider>,
  );
}

describe("ProjectPicker", () => {
  beforeEach(() => {
    useActiveProject.setState({ projectId: "prj_1" });
    server.use(
      http.get("*/api/v1/projects", () =>
        HttpResponse.json({
          items: mockProjects,
          meta: { next_cursor: null, limit: 20 },
        }),
      ),
    );
  });

  afterEach(() => {
    useActiveProject.setState({ projectId: null });
  });

  it("renders the active project name in the trigger", async () => {
    renderProjectPicker();
    expect(await screen.findByTestId("project-picker")).toHaveTextContent("Frontend App");
  });

  it("allows switching active project", async () => {
    const user = userEvent.setup();
    renderProjectPicker();

    const trigger = await screen.findByTestId("project-picker");
    await user.click(trigger);

    const items = await screen.findAllByTestId("project-picker-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-active", "true");
    expect(items[1]).toHaveAttribute("data-active", "false");

    const nextProjectItem = items[1];
    expect(nextProjectItem).toBeDefined();
    if (!nextProjectItem) throw new Error("Expected next project item");
    await user.click(nextProjectItem);

    expect(useActiveProject.getState().projectId).toBe("prj_2");
  });

  it("renders manage actions (Edit active project and New project) when canManage is true", async () => {
    const user = userEvent.setup();
    renderProjectPicker({ canManage: true });

    const trigger = await screen.findByTestId("project-picker");
    await user.click(trigger);

    expect(screen.getByTestId("project-picker-action-bar")).toBeInTheDocument();
    expect(screen.getByTestId("project-picker-edit-btn")).toBeInTheDocument();
    expect(screen.getByTestId("project-picker-create")).toBeInTheDocument();

    // Clicking edit opens EditProjectDialog
    await user.click(screen.getByTestId("project-picker-edit-btn"));
    expect(await screen.findByTestId("edit-project-dialog")).toBeInTheDocument();
  });

  it("opens CreateProjectDialog when clicking New project button", async () => {
    const user = userEvent.setup();
    renderProjectPicker({ canManage: true });

    const trigger = await screen.findByTestId("project-picker");
    await user.click(trigger);

    await user.click(screen.getByTestId("project-picker-create"));
    expect(await screen.findByTestId("create-project-dialog")).toBeInTheDocument();
  });

  it("hides manage actions when canManage is false (role hardening for QA and VIEWER)", async () => {
    const user = userEvent.setup();
    renderProjectPicker({ canManage: false });

    const trigger = await screen.findByTestId("project-picker");
    await user.click(trigger);

    expect(screen.queryByTestId("project-picker-action-bar")).toBeNull();
    expect(screen.queryByTestId("project-picker-edit-btn")).toBeNull();
    expect(screen.queryByTestId("project-picker-create")).toBeNull();

    // Projects list still accessible for switching
    expect(screen.getByTestId("project-picker-list")).toBeInTheDocument();
  });

  it("renders nothing when no projects exist and canManage is false", async () => {
    server.use(
      http.get("*/api/v1/projects", () =>
        HttpResponse.json({
          items: [],
          meta: { next_cursor: null, limit: 20 },
        }),
      ),
    );

    const { container } = renderProjectPicker({ canManage: false });
    await waitFor(() => {
      expect(screen.queryByTestId("project-picker")).toBeNull();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders fallback New project button when no projects exist and canManage is true", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/v1/projects", () =>
        HttpResponse.json({
          items: [],
          meta: { next_cursor: null, limit: 20 },
        }),
      ),
    );

    renderProjectPicker({ canManage: true });
    const fallbackBtn = await screen.findByTestId("project-picker-new-fallback");
    expect(fallbackBtn).toBeInTheDocument();
    await user.click(fallbackBtn);
    expect(await screen.findByTestId("create-project-dialog")).toBeInTheDocument();
  });
});
