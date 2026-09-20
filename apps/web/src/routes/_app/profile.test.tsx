import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { server } from "@/mocks/server";
import { routeTree } from "@/routeTree.gen";
import { useActiveWorkspace } from "@/stores/use-active-workspace";
import { useCapabilities } from "@/stores/use-capabilities";
import { ZERO_CAPS } from "@/test/capabilities";

function meHandler(over: Record<string, unknown> = {}) {
  return http.get("*/api/v1/auth/me", () =>
    HttpResponse.json({
      id: "u_owner",
      email: "owner@suitest.dev",
      name: "Old Name",
      avatar_url: null,
      must_change_password: false,
      is_superuser: false,
      memberships: [
        {
          workspace_id: "ws_1",
          role: "OWNER",
          workspace: { id: "ws_1", slug: "nusantara", name: "Nusantara Retail" },
        },
      ],
      ...over,
    }),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  return { router };
}

describe("Profile", () => {
  beforeEach(() => {
    useActiveWorkspace.setState({ workspaceId: "ws_1" });
    useCapabilities.setState({ capabilities: ZERO_CAPS, loading: false, error: null });
    server.use(meHandler());
  });
  afterEach(() => {
    useActiveWorkspace.setState({ workspaceId: null });
  });

  it("prefills the name field from the current user", async () => {
    renderAt("/profile");
    expect(await screen.findByTestId("profile-name-input")).toHaveValue("Old Name");
  });

  it("saves a new name and confirms", async () => {
    let body: unknown = null;
    server.use(
      http.patch("*/users/me", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ name: "New Name" });
      }),
    );
    renderAt("/profile");
    const user = userEvent.setup();
    const input = await screen.findByTestId("profile-name-input");
    await user.clear(input);
    await user.type(input, "New Name");
    await user.click(screen.getByTestId("profile-name-submit"));
    await waitFor(() => {
      expect(body).toEqual({ name: "New Name" });
    });
    expect(await screen.findByText(/name updated/i)).toBeInTheDocument();
  });

  it("rejects an empty name without calling the API", async () => {
    let called = false;
    server.use(
      http.patch("*/users/me", () => {
        called = true;
        return HttpResponse.json({ name: "" });
      }),
    );
    renderAt("/profile");
    const user = userEvent.setup();
    const input = await screen.findByTestId("profile-name-input");
    await user.clear(input);
    await user.click(screen.getByTestId("profile-name-submit"));
    expect(await screen.findByText(/can't be empty/i)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("surfaces a server error", async () => {
    server.use(http.patch("*/users/me", () => new HttpResponse(null, { status: 500 })));
    renderAt("/profile");
    const user = userEvent.setup();
    const input = await screen.findByTestId("profile-name-input");
    await user.clear(input);
    await user.type(input, "New Name");
    await user.click(screen.getByTestId("profile-name-submit"));
    expect(await screen.findByText(/couldn't update your name/i)).toBeInTheDocument();
  });
});
