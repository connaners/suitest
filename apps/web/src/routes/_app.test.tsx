import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { routeTree } from "@/routeTree.gen";
import { useActiveWorkspace } from "@/stores/use-active-workspace";
import { useCapabilities } from "@/stores/use-capabilities";
import type * as AuthSession from "@/lib/auth-session";
import { setWsTransport } from "@/lib/ws-client";
import { MockWs } from "@/test/mock-ws";

const mockLogoutAndRedirect = vi.fn();
vi.mock("@/lib/auth-session", async () => {
  const actual = await vi.importActual<typeof AuthSession>("@/lib/auth-session");
  return {
    ...actual,
    logoutAndRedirect: (...args: unknown[]) => mockLogoutAndRedirect(...args),
  };
});

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe("<_app> route guard", () => {
  beforeEach(() => {
    // Reset cross-test global stores so a prior test's seeded workspace /
    // capabilities don't leak into this one (zustand stores are module-level).
    useActiveWorkspace.setState({ workspaceId: null });
    useCapabilities.setState({ capabilities: null, loading: true, error: null });
    // axios api-client interceptor will call window.location.assign on 401;
    // stub it so the test doesn't navigate the jsdom window itself (we want
    // to assert the router-level redirect, not the interceptor's).
    vi.stubGlobal("location", {
      pathname: "/dashboard",
      assign: vi.fn(),
      origin: "http://localhost",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redirects to /login when /auth/me returns 401", async () => {
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({ code: "UNAUTHORIZED", message: "nope" }, { status: 401 }),
      ),
    );

    const { router } = renderAt("/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    // Search should carry `next` so login can bounce the user back.
    expect(router.state.location.search).toMatchObject({ next: "/dashboard" });
  });

  it("renders the protected child when /auth/me returns 200", async () => {
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({
          id: "u_demo",
          email: "demo@suitest.dev",
          name: "Demo",
          avatar_url: null,
          memberships: [],
        }),
      ),
    );

    const { router } = renderAt("/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard");
    });
    // A user with zero workspaces is NOT bounced to /login (the guard skips the
    // workspace-scoped /projects fetch); the protected shell renders and the
    // create-workspace flow auto-opens so they can bootstrap from the UI.
    expect(await screen.findByTestId("create-workspace-dialog")).toBeInTheDocument();
  });

  it("clears a stale workspaceId for a zero-membership user instead of bouncing to /login", async () => {
    // Regression: `useActiveWorkspace` is localStorage-persisted, so a stale
    // id from a revoked membership (or a different account on a shared
    // browser) survives across sessions. A zero-membership user hitting this
    // guard with that stale id previously kept it, the `/projects` fetch
    // 403ed against it, and the catch-all bounced the whole protected shell
    // to /login — even though `WORKSPACE_INVITE`-only visitors (M1e-9) must
    // be able to reach /inbox with zero memberships.
    useActiveWorkspace.setState({ workspaceId: "stale-foreign-ws" });
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({
          id: "u_demo",
          email: "demo@suitest.dev",
          name: "Demo",
          avatar_url: null,
          memberships: [],
        }),
      ),
      http.get("*/api/v1/projects", () =>
        HttpResponse.json({ code: "FORBIDDEN", message: "not a member" }, { status: 403 }),
      ),
    );

    const { router } = renderAt("/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard");
    });
    expect(await screen.findByTestId("create-workspace-dialog")).toBeInTheDocument();
    expect(useActiveWorkspace.getState().workspaceId).toBeNull();
  });

  it("redirects on network failure (no response)", async () => {
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.error()));

    const { router } = renderAt("/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
  });

  it("redirects to /settings?force_password=1 when must_change_password is set", async () => {
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({
          id: "u_reset",
          email: "reset@suitest.dev",
          name: "Reset User",
          avatar_url: null,
          must_change_password: true,
          is_superuser: false,
          memberships: [],
        }),
      ),
    );

    const { router } = renderAt("/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings");
    });
    expect(router.state.location.search).toMatchObject({ force_password: "1" });
  });

  it("does NOT bounce a must_change_password user already on /settings", async () => {
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({
          id: "u_reset",
          email: "reset@suitest.dev",
          name: "Reset User",
          avatar_url: null,
          must_change_password: true,
          is_superuser: false,
          memberships: [],
        }),
      ),
    );

    const { router } = renderAt("/settings");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings");
    });
  });
});

describe("<index> redirect", () => {
  beforeEach(() => {
    vi.stubGlobal("location", {
      pathname: "/",
      assign: vi.fn(),
      origin: "http://localhost",
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects / → /dashboard (then through _app guard)", async () => {
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({
          id: "u_demo",
          email: "demo@suitest.dev",
          name: null,
          avatar_url: null,
          memberships: [],
        }),
      ),
    );

    const { router } = renderAt("/");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard");
    });
  });
});

describe("<_app> workspace fallback and real-time events", () => {
  let mockWs: MockWs;
  let restoreWs: () => void;

  beforeEach(() => {
    mockLogoutAndRedirect.mockReset();
    mockWs = new MockWs();
    restoreWs = setWsTransport(mockWs);
    useActiveWorkspace.setState({ workspaceId: "ws_1" });
    useCapabilities.setState({ capabilities: null, loading: true, error: null });
    vi.stubGlobal("location", {
      pathname: "/dashboard",
      assign: vi.fn(),
      origin: "http://localhost",
    });
  });

  afterEach(() => {
    restoreWs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useActiveWorkspace.setState({ workspaceId: null });
  });

  it("switches to the next workspace without calling logoutAndRedirect when remaining workspaces > 0", async () => {
    let callCount = 0;
    server.use(
      http.get("*/api/v1/auth/me", () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({
            id: "u_demo",
            email: "demo@suitest.dev",
            name: "Demo",
            avatar_url: null,
            memberships: [
              { workspace_id: "ws_1", role: "MEMBER", workspace: { id: "ws_1", name: "Workspace 1" } },
              { workspace_id: "ws_2", role: "MEMBER", workspace: { id: "ws_2", name: "Workspace 2" } },
            ],
          });
        }
        return HttpResponse.json({
          id: "u_demo",
          email: "demo@suitest.dev",
          name: "Demo",
          avatar_url: null,
          memberships: [
            { workspace_id: "ws_2", role: "MEMBER", workspace: { id: "ws_2", name: "Workspace 2" } },
          ],
        });
      }),
      http.get("*/api/v1/workspaces/ws_1/projects", () => HttpResponse.json([])),
      http.get("*/api/v1/workspaces/ws_2/projects", () => HttpResponse.json([])),
    );

    renderAt("/dashboard");

    await waitFor(() => {
      expect(useActiveWorkspace.getState().workspaceId).toBe("ws_1");
    });

    // Simulate WS event: user removed from ws_1
    mockWs.emit({
      topic: "workspace:ws_1",
      event: "workspace.member.removed",
      data: { userId: "u_demo", workspaceId: "ws_1", workspaceName: "Workspace 1" },
    });

    await waitFor(() => {
      expect(useActiveWorkspace.getState().workspaceId).toBe("ws_2");
    });

    expect(mockLogoutAndRedirect).not.toHaveBeenCalled();
    expect(window.location.assign).toHaveBeenCalledWith("/dashboard");
  });

  it("calls logoutAndRedirect('removed') when 0 workspaces remain", async () => {
    let callCount = 0;
    server.use(
      http.get("*/api/v1/auth/me", () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({
            id: "u_demo",
            email: "demo@suitest.dev",
            name: "Demo",
            avatar_url: null,
            memberships: [
              { workspace_id: "ws_1", role: "MEMBER", workspace: { id: "ws_1", name: "Workspace 1" } },
            ],
          });
        }
        return HttpResponse.json({
          id: "u_demo",
          email: "demo@suitest.dev",
          name: "Demo",
          avatar_url: null,
          memberships: [],
        });
      }),
      http.get("*/api/v1/workspaces/ws_1/projects", () => HttpResponse.json([])),
    );

    renderAt("/dashboard");

    await waitFor(() => {
      expect(useActiveWorkspace.getState().workspaceId).toBe("ws_1");
    });

    mockWs.emit({
      topic: "workspace:ws_1",
      event: "workspace.member.removed",
      data: { userId: "u_demo", workspaceId: "ws_1" },
    });

    await waitFor(() => {
      expect(mockLogoutAndRedirect).toHaveBeenCalledWith("removed");
    });
  });

  it("handles suitest:workspace_membership_revoked custom event through fallback flow", async () => {
    let callCount = 0;
    server.use(
      http.get("*/api/v1/auth/me", () => {
        callCount += 1;
        if (callCount === 1) {
          return HttpResponse.json({
            id: "u_demo",
            email: "demo@suitest.dev",
            name: "Demo",
            avatar_url: null,
            memberships: [
              { workspace_id: "ws_1", role: "MEMBER", workspace: { id: "ws_1", name: "Workspace 1" } },
              { workspace_id: "ws_2", role: "MEMBER", workspace: { id: "ws_2", name: "Workspace 2" } },
            ],
          });
        }
        return HttpResponse.json({
          id: "u_demo",
          email: "demo@suitest.dev",
          name: "Demo",
          avatar_url: null,
          memberships: [
            { workspace_id: "ws_2", role: "MEMBER", workspace: { id: "ws_2", name: "Workspace 2" } },
          ],
        });
      }),
      http.get("*/api/v1/workspaces/ws_1/projects", () => HttpResponse.json([])),
      http.get("*/api/v1/workspaces/ws_2/projects", () => HttpResponse.json([])),
    );

    renderAt("/dashboard");

    await waitFor(() => {
      expect(useActiveWorkspace.getState().workspaceId).toBe("ws_1");
    });

    window.dispatchEvent(
      new CustomEvent("suitest:workspace_membership_revoked", {
        detail: { workspaceId: "ws_1" },
      }),
    );

    await waitFor(() => {
      expect(useActiveWorkspace.getState().workspaceId).toBe("ws_2");
    });

    expect(mockLogoutAndRedirect).not.toHaveBeenCalled();
  });
});
