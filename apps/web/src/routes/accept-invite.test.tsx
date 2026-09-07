import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { routeTree } from "@/routeTree.gen";

function renderAcceptInvite(initialPath = "/accept-invite?token=invite-token") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    context: { queryClient },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("<AcceptInviteRoute>", () => {
  beforeEach(() => {
    vi.stubGlobal("location", {
      pathname: "/accept-invite",
      assign: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates the token and shows invite details", async () => {
    let seenToken = "";
    server.use(
      http.get("*/api/v1/invitations/validate", ({ request }) => {
        seenToken = new URL(request.url).searchParams.get("token") ?? "";
        return HttpResponse.json({
          email: "maya@example.test",
          workspace_name: "Nusantara Retail",
          role: "QA",
          expires_at: "2026-06-07T10:00:00Z",
        });
      }),
    );

    renderAcceptInvite("/accept-invite?token=abc123");

    expect(await screen.findByText("Nusantara Retail")).toBeInTheDocument();
    expect(screen.getByText("maya@example.test")).toBeInTheDocument();
    expect(screen.getByText("QA")).toBeInTheDocument();
    expect(seenToken).toBe("abc123");
  });

  it("shows an expired-token state without the signup form", async () => {
    server.use(
      http.get("*/api/v1/invitations/validate", () =>
        HttpResponse.json(
          { code: "INVITATION_EXPIRED", message: "Invitation expired" },
          { status: 410 },
        ),
      ),
    );

    renderAcceptInvite();

    expect(await screen.findByText(/invitation link has expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create account/i })).not.toBeInTheDocument();
  });

  it("submits matching email, name, and password, then redirects to dashboard", async () => {
    let acceptBody: unknown = null;
    server.use(
      http.get("*/api/v1/invitations/validate", () =>
        HttpResponse.json({
          email: "maya@example.test",
          workspace_name: "Nusantara Retail",
          role: "ADMIN",
          expires_at: "2026-06-07T10:00:00Z",
        }),
      ),
      http.post("*/api/v1/auth/accept-invite", async ({ request }) => {
        acceptBody = await request.json();
        return HttpResponse.json({ ok: true, requires_login: false });
      }),
    );

    renderAcceptInvite("/accept-invite?token=abc123");

    const user = userEvent.setup();
    // The email field comes prefilled from the public validate endpoint.
    const emailInput = await screen.findByTestId("accept-invite-email");
    expect(emailInput).toHaveValue("maya@example.test");
    await user.clear(emailInput);
    await user.type(emailInput, "maya@example.test");
    await user.type(await screen.findByRole("textbox", { name: /name/i }), "Maya Putri");
    await user.type(screen.getByLabelText(/^password$/i), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(acceptBody).toEqual({
        token: "abc123",
        email: "maya@example.test",
        name: "Maya Putri",
        password: "correct horse battery staple",
      });
      expect(window.location.assign).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("redirects to login when the invite resolves to an existing account", async () => {
    server.use(
      http.get("*/api/v1/invitations/validate", () =>
        HttpResponse.json({
          email: "maya@example.test",
          workspace_name: "Nusantara Retail",
          role: "QA",
          expires_at: "2026-06-07T10:00:00Z",
        }),
      ),
      http.post("*/api/v1/auth/accept-invite", () =>
        HttpResponse.json({ ok: true, requires_login: true }),
      ),
    );

    renderAcceptInvite();

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: /name/i }), "Maya Putri");
    await user.type(screen.getByLabelText(/^password$/i), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith("/login?next=/dashboard");
    });
  });

  it("surfaces a mismatch error when the submitted email differs from the invite", async () => {
    server.use(
      http.get("*/api/v1/invitations/validate", () =>
        HttpResponse.json({
          email: "maya@example.test",
          workspace_name: "Nusantara Retail",
          role: "QA",
          expires_at: "2026-06-07T10:00:00Z",
        }),
      ),
      http.post("*/api/v1/auth/accept-invite", () =>
        HttpResponse.json(
          { detail: "This invitation was issued to a different email address." },
          { status: 403 },
        ),
      ),
    );

    renderAcceptInvite();

    const user = userEvent.setup();
    await user.clear(await screen.findByTestId("accept-invite-email"));
    await user.type(screen.getByTestId("accept-invite-email"), "bob@example.test");
    await user.type(await screen.findByRole("textbox", { name: /name/i }), "Bob");
    await user.type(screen.getByLabelText(/^password$/i), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText(/issued to a different email address/i),
    ).toBeInTheDocument();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("shows revoked or invalid submit errors", async () => {
    server.use(
      http.get("*/api/v1/invitations/validate", () =>
        HttpResponse.json({
          email: "maya@example.test",
          workspace_name: "Nusantara Retail",
          role: "VIEWER",
          expires_at: "2026-06-07T10:00:00Z",
        }),
      ),
      http.post("*/api/v1/auth/accept-invite", () =>
        HttpResponse.json(
          { code: "INVITATION_REVOKED", message: "Invitation revoked" },
          { status: 409 },
        ),
      ),
    );

    renderAcceptInvite();

    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: /name/i }), "Maya Putri");
    await user.type(screen.getByLabelText(/^password$/i), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/invitation link was revoked/i)).toBeInTheDocument();
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
