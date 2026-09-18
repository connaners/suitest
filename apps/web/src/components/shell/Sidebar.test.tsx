import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { Sidebar, type SidebarProps } from "@/components/shell/Sidebar";
import { server } from "@/mocks/server";

/**
 * Mount the Sidebar inside a minimal in-memory TanStack Router so `<Link>`
 * children resolve. Real route tree is not used — we only need a few
 * matching paths so `activeProps` can fire when the test asks for one.
 */
async function renderSidebar(
  initialPath: string,
  props: SidebarProps = {},
): Promise<ReturnType<typeof render>> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const rootRoute = createRootRoute({
    component: () => (
      <div className="flex">
        <Sidebar {...props} />
        <Outlet />
      </div>
    ),
  });

  const pages = [
    "/dashboard",
    "/inbox",
    "/cases",
    "/runs",
    "/defects",
    "/analytics",
    "/trace",
    "/integrations",
    "/docs",
    "/settings",
    "/admin",
  ];
  const children = pages.map((p) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: p,
      component: () => <div data-testid={`page-${p}`}>{p}</div>,
    }),
  );
  const routeTree = rootRoute.addChildren(children);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  // Wait for the Sidebar (and the rest of the tree) to actually render.
  await waitFor(() => {
    expect(result.container.querySelector("[data-testid='sidebar']")).not.toBeNull();
  });

  return result;
}

describe("<Sidebar>", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it("renders all primary nav items", async () => {
    await renderSidebar("/dashboard");
    const expected = [
      "Dashboard",
      "Inbox",
      "Test Cases",
      "Test Runs",
      "Defects",
      "Analytics",
      "Traceability",
      "Integrations",
      "Docs",
      "Settings",
    ];
    for (const label of expected) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders the workspace picker trigger and brand wordmark", async () => {
    await renderSidebar("/dashboard", { workspaceName: "Acme QA" });
    expect(screen.getByTestId("workspace-picker")).toHaveTextContent("Acme QA");
    // Brand wordmark renders as a single "suitest" word split across spans.
    expect(screen.getByText("test", { selector: "span" })).toBeInTheDocument();
  });

  it("highlights the active route via Link activeProps", async () => {
    await renderSidebar("/runs");
    // TanStack Router applies `data-status="active"` automatically on the
    // anchor when the route matches.
    const runs = screen.getByTestId("nav-test-runs");
    await waitFor(() => {
      expect(runs.getAttribute("data-status")).toBe("active");
    });
    const dashboard = screen.getByTestId("nav-dashboard");
    expect(dashboard.getAttribute("data-status")).not.toBe("active");
  });

  it("shows an inbox badge when count > 0", async () => {
    await renderSidebar("/dashboard", { inboxCount: 3 });
    const badge = screen.getByTestId("nav-inbox-badge");
    expect(badge).toHaveTextContent("3");
  });

  it("omits the inbox badge when count is 0", async () => {
    await renderSidebar("/dashboard", { inboxCount: 0 });
    expect(screen.queryByTestId("nav-inbox-badge")).toBeNull();
  });

  it("shows a live dot next to Test Runs when activeRunsCount > 0", async () => {
    await renderSidebar("/dashboard", { activeRunsCount: 2 });
    expect(screen.getByTestId("nav-test-runs-live-dot")).toBeInTheDocument();
  });

  it("hides the live dot when activeRunsCount is 0", async () => {
    await renderSidebar("/dashboard", { activeRunsCount: 0 });
    expect(screen.queryByTestId("nav-test-runs-live-dot")).toBeNull();
  });

  it("renders the notification bell with a red dot when unreadCount > 0", async () => {
    await renderSidebar("/dashboard", { unreadCount: 5 });
    expect(screen.getByTestId("sidebar-bell")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-bell-unread")).toBeInTheDocument();
  });

  it("omits the bell red dot when unreadCount is 0", async () => {
    await renderSidebar("/dashboard", { unreadCount: 0 });
    expect(screen.queryByTestId("sidebar-bell-unread")).toBeNull();
  });

  it("Settings nav item links to /settings (enabled in M1e)", async () => {
    await renderSidebar("/dashboard");
    const settings = screen.getByTestId("nav-settings");
    expect(settings.getAttribute("aria-disabled")).toBeNull();
    expect(settings.getAttribute("href")).toBe("/settings");
  });

  it("hides the Admin nav item for non-superusers", async () => {
    await renderSidebar("/dashboard");
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("shows the Admin nav item for superusers", async () => {
    await renderSidebar("/dashboard", { isSuperuser: true });
    const adminNav = screen.getByTestId("nav-admin");
    expect(adminNav.getAttribute("href")).toBe("/admin");
  });

  it("collapses the rail on toggle and persists to localStorage", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar("/dashboard");
    const aside = container.querySelector("[data-testid='sidebar']");
    expect(aside).not.toBeNull();
    if (!aside) throw new Error("sidebar missing");
    expect(aside.className).toContain("w-[224px]");

    const toggle = screen.getByTestId("sidebar-collapse-toggle");
    await user.click(toggle);
    // Preference persists immediately. The rail stays visually open while the
    // cursor is over it or while the toggle keeps focus (both hover-expand and
    // focus-expand), so move pointer and focus out before asserting the width.
    expect(localStorage.getItem("suitest.sidebarCollapsed")).toBe("1");
    await user.tab();
    await user.hover(document.body);
    expect(aside.className).toContain("md:w-[64px]");
    // The label is hidden from the a11y tree when collapsed — the accessible
    // name comes from aria-label on the link.
    expect(screen.getByTestId("nav-dashboard")).toHaveAttribute("aria-label", "Dashboard");

    await user.click(toggle);
    expect(localStorage.getItem("suitest.sidebarCollapsed")).toBe("0");
    expect(aside.className).not.toContain("md:w-[64px]");
  });

  it("restores the collapsed preference from localStorage on mount", async () => {
    localStorage.setItem("suitest.sidebarCollapsed", "1");
    const { container } = await renderSidebar("/dashboard");
    const aside = container.querySelector("[data-testid='sidebar']");
    expect(aside?.className).toContain("md:w-[64px]");
  });

  it("temporarily expands the collapsed rail while focus is inside it", async () => {
    const user = userEvent.setup();
    localStorage.setItem("suitest.sidebarCollapsed", "1");
    const { container } = await renderSidebar("/dashboard");
    const aside = container.querySelector("[data-testid='sidebar']");
    expect(aside?.className).toContain("md:w-[64px]");

    // Tabbing into the rail (first focusable is inside <aside>) expands it.
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
    expect(aside?.className).not.toContain("md:w-[64px]");

    // Tabbing past the last focusable leaves the rail → it collapses again.
    let guard = 0;
    while (document.activeElement !== document.body && guard < 40) {
      await user.tab();
      guard += 1;
    }
    expect(aside?.className).toContain("md:w-[64px]");
  });

  it("passes canManage=false to ProjectPicker when userRole is QA", async () => {
    server.use(
      http.get("*/api/v1/projects", () =>
        HttpResponse.json({
          items: [
            {
              id: "prj_1",
              name: "Demo Project",
              slug: "demo-project",
            },
          ],
          meta: { next_cursor: null, limit: 20 },
        }),
      ),
    );
    await renderSidebar("/dashboard", { userRole: "QA" });
    const trigger = await screen.findByTestId("project-picker");
    expect(trigger).toBeInTheDocument();
    trigger.click();
    await waitFor(() => {
      expect(screen.getByTestId("project-picker-list")).toBeInTheDocument();
      expect(screen.queryByTestId("project-picker-create")).toBeNull();
      expect(screen.queryByTestId("project-picker-action-bar")).toBeNull();
    });
  });

  it("passes canManage=true to ProjectPicker when userRole is Owner", async () => {
    server.use(
      http.get("*/api/v1/projects", () =>
        HttpResponse.json({
          items: [
            {
              id: "prj_1",
              name: "Demo Project",
              slug: "demo-project",
            },
          ],
          meta: { next_cursor: null, limit: 20 },
        }),
      ),
    );
    await renderSidebar("/dashboard", { userRole: "Owner" });
    const trigger = await screen.findByTestId("project-picker");
    const user = userEvent.setup();
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByTestId("project-picker-create")).toBeInTheDocument();
      expect(screen.getByTestId("project-picker-action-bar")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("project-picker-create"));
    expect(await screen.findByTestId("create-project-dialog")).toBeInTheDocument();
  });
});

