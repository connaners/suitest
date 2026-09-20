import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { MembersPanel } from "@/components/settings/MembersPanel";
import { server } from "@/mocks/server";
import { useActiveWorkspace } from "@/stores/use-active-workspace";
import { installMockWs } from "@/test/mock-ws";

const FUTURE = "2099-06-07T10:00:00Z";

function renderPanel(role = "ADMIN", workspaceName = "Acme Corp") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MembersPanel workspaceId="ws_1" workspaceName={workspaceName} currentRole={role} />
    </QueryClientProvider>,
  );
}

const member = {
  user_id: "u_1",
  email: "owner@example.test",
  name: "Owner",
  role: "OWNER",
  joined_at: "2026-05-01T00:00:00Z",
};

describe("MembersPanel", () => {
  beforeEach(() => {
    server.use(http.get("*/api/v1/workspaces/ws_1/members", () => HttpResponse.json([member])));
  });

  it("lists members", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
    );
    renderPanel();
    expect(await screen.findByText("owner@example.test")).toBeInTheDocument();
  });

  it("hides the Invite button for non-admins", async () => {
    renderPanel("QA");
    await screen.findByText("owner@example.test");
    expect(screen.queryByTestId("invite-button")).not.toBeInTheDocument();
  });

  it("creates an invite and shows a copyable link", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
      http.post("*/api/v1/workspaces/ws_1/invitations", () =>
        HttpResponse.json(
          {
            id: "inv_1",
            email: "qa@example.test",
            role: "QA",
            expires_at: FUTURE,
            accepted_at: null,
            revoked_at: null,
            link: "http://localhost/accept-invite?token=new-token",
          },
          { status: 201 },
        ),
      ),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("invite-button"));
    await user.type(await screen.findByLabelText(/email/i), "qa@example.test");
    await user.click(screen.getByTestId("invite-submit"));

    const panel = await screen.findByTestId("invite-link-panel");
    expect(within(panel).getByText(/accept-invite\?token=new-token/)).toBeInTheDocument();

    await user.click(within(panel).getByTestId("copy-button"));
    expect(await within(panel).findByText("Copied")).toBeInTheDocument();
  });

  it("shows a confirmation chip when the invited email already has an account (M1e-9)", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
      http.get("*/api/v1/workspaces/ws_1/invitations/lookup", ({ request }) => {
        const email = new URL(request.url).searchParams.get("email");
        if (email === "alice@example.test") {
          return HttpResponse.json({ exists: true, name: "Alice" });
        }
        return HttpResponse.json({ exists: false, name: null });
      }),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("invite-button"));
    await user.type(await screen.findByLabelText(/email/i), "alice@example.test");

    expect(
      await screen.findByTestId("invite-lookup-match", undefined, { timeout: 2000 }),
    ).toHaveTextContent("Alice is already registered");
  });

  it("does not show a confirmation chip for an unregistered email", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
      http.get("*/api/v1/workspaces/ws_1/invitations/lookup", () =>
        HttpResponse.json({ exists: false, name: null }),
      ),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("invite-button"));
    await user.type(await screen.findByLabelText(/email/i), "nobody@example.test");

    // Project `lib` target is ES2023 — no `Promise.withResolvers` yet.
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    expect(screen.queryByTestId("invite-lookup-match")).not.toBeInTheDocument();
  });

  it("revokes a pending invite and invalidates the cache", async () => {
    let listCalls = 0;
    let revoked = false;
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () => {
        listCalls += 1;
        return HttpResponse.json({
          items: revoked
            ? []
            : [
                {
                  id: "inv_1",
                  email: "qa@example.test",
                  role: "QA",
                  expires_at: FUTURE,
                  accepted_at: null,
                  revoked_at: null,
                  link: null,
                },
              ],
        });
      }),
      http.post("*/api/v1/invitations/inv_1/revoke", () => {
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("revoke-inv_1"));
    await waitFor(() => {
      expect(listCalls).toBeGreaterThan(1);
    });
  });

  it("resends a pending invite and shows the rotated link", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () =>
        HttpResponse.json({
          items: [
            {
              id: "inv_1",
              email: "qa@example.test",
              role: "QA",
              expires_at: FUTURE,
              accepted_at: null,
              revoked_at: null,
              link: null,
            },
          ],
        }),
      ),
      http.post("*/api/v1/invitations/inv_1/resend", () =>
        HttpResponse.json({
          id: "inv_1",
          email: "qa@example.test",
          role: "QA",
          expires_at: FUTURE,
          accepted_at: null,
          revoked_at: null,
          link: "http://localhost/accept-invite?token=rotated",
        }),
      ),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("resend-inv_1"));
    const panel = await screen.findByTestId("invite-link-panel");
    expect(within(panel).getByText(/token=rotated/)).toBeInTheDocument();
  });

  it("refreshes members and invitations on an `invitation.resolved` WS event", async () => {
    let membersCalls = 0;
    let invitesCalls = 0;
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () => {
        membersCalls += 1;
        return HttpResponse.json([member]);
      }),
      http.get("*/api/v1/workspaces/ws_1/invitations", () => {
        invitesCalls += 1;
        return HttpResponse.json({ items: [] });
      }),
    );

    useActiveWorkspace.setState({ workspaceId: "ws_1" });
    const { ws, restore } = installMockWs();
    try {
      renderPanel("ADMIN");
      await screen.findByText("owner@example.test");
      const membersBefore = membersCalls;
      const invitesBefore = invitesCalls;

      await act(async () => {
        ws.emit({
          topic: "workspace:ws_1",
          event: "invitation.resolved",
          data: { invitationId: "inv_1", status: "approved", email: "qa@example.test" },
        });
      });

      await waitFor(() => {
        expect(membersCalls).toBeGreaterThan(membersBefore);
        expect(invitesCalls).toBeGreaterThan(invitesBefore);
      });
    } finally {
      restore();
      useActiveWorkspace.setState({ workspaceId: null });
    }
  });

  it("allows an ADMIN to change another member's role", async () => {
    let patchedRole: string | null = null;
    const qaMember = {
      user_id: "u_2",
      email: "engineer@example.test",
      name: "Engineer",
      role: "QA",
      joined_at: "2026-05-02T00:00:00Z",
    };
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () => HttpResponse.json([member, qaMember])),
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
      http.patch("*/api/v1/workspaces/ws_1/members/u_2", async ({ request }) => {
        const body = (await request.json()) as { role: string };
        patchedRole = body.role;
        return HttpResponse.json({ ...qaMember, role: body.role });
      }),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    const select = await screen.findByTestId("member-role-select-u_2");
    expect(select).toHaveValue("QA");

    await user.selectOptions(select, "ADMIN");
    await waitFor(() => {
      expect(patchedRole).toBe("ADMIN");
    });
  });

  it("disables role select and removal for the sole OWNER", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () => HttpResponse.json([member])),
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
    );
    renderPanel("ADMIN");
    const select = await screen.findByTestId("member-role-select-u_1");
    expect(select).toBeDisabled();

    const removeBtn = screen.getByTestId("remove-member-u_1");
    expect(removeBtn).toBeDisabled();
  });

  it("opens confirmation dialog with email and deletes a member", async () => {
    let deletedId: string | null = null;
    const qaMember = {
      user_id: "u_2",
      email: "contractor@example.test",
      name: "Contractor",
      role: "VIEWER",
      joined_at: "2026-05-02T00:00:00Z",
    };
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () => HttpResponse.json([member, qaMember])),
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
      http.delete("*/api/v1/workspaces/ws_1/members/u_2", () => {
        deletedId = "u_2";
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    const removeBtn = await screen.findByTestId("remove-member-u_2");
    expect(removeBtn).toHaveTextContent("Remove");

    await user.click(removeBtn);

    // Dialog appears with anti-clipping email span
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove Member")).toBeInTheDocument();
    expect(within(dialog).getByText("contractor@example.test")).toHaveClass("break-all");

    // Click confirm remove button
    const confirmBtn = within(dialog).getByTestId("confirm-remove-member-btn");
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(deletedId).toBe("u_2");
    });
  });

  it("renders read-only table without Actions column for VIEWER and QA", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () => HttpResponse.json([member])),
    );
    renderPanel("VIEWER");
    await screen.findByText("owner@example.test");
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-role-select-u_1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-member-u_1")).not.toBeInTheDocument();
  });

  it("prevents an ADMIN from demoting or removing an OWNER even when multiple owners exist", async () => {
    const secondOwner = {
      user_id: "u_2",
      email: "owner2@example.test",
      name: "Owner Two",
      role: "OWNER",
      joined_at: "2026-05-02T00:00:00Z",
    };
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () =>
        HttpResponse.json([member, secondOwner]),
      ),
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
    );
    renderPanel("ADMIN");

    // Both owner rows should have disabled role select and disabled remove button for an ADMIN
    const select1 = await screen.findByTestId("member-role-select-u_1");
    expect(select1).toBeDisabled();
    expect(select1).toHaveAttribute("title", "Only a workspace Owner can modify an Owner's role.");

    const removeBtn1 = screen.getByTestId("remove-member-u_1");
    expect(removeBtn1).toBeDisabled();
    expect(removeBtn1).toHaveAttribute("title", "Only a workspace Owner can remove another Owner.");

    const select2 = screen.getByTestId("member-role-select-u_2");
    expect(select2).toBeDisabled();
    expect(removeBtn1).toBeDisabled();
  });

  it("clears active workspace store when a member leaves the workspace", async () => {
    const { useActiveWorkspace } = await import("@/stores/use-active-workspace");
    useActiveWorkspace.getState().setWorkspaceId("ws_1");

    const selfMember = {
      user_id: "u_self",
      email: "self@example.test",
      name: "Self User",
      role: "ADMIN",
      joined_at: "2026-05-02T00:00:00Z",
    };
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({
          id: "u_self",
          email: "self@example.test",
          name: "Self User",
          memberships: [],
        }),
      ),
      http.get("*/api/v1/workspaces/ws_1/members", () =>
        HttpResponse.json([member, selfMember]),
      ),
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
      http.delete("*/api/v1/workspaces/ws_1/members/u_self", () => {
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();

    const leaveBtn = await screen.findByTestId("remove-member-u_self");
    expect(leaveBtn).toHaveTextContent("Leave");

    await user.click(leaveBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Leave Workspace")).toBeInTheDocument();

    const confirmBtn = within(dialog).getByTestId("confirm-remove-member-btn");
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(useActiveWorkspace.getState().workspaceId).toBeNull();
    });
  });

  it("filters accepted invitations out of the Pending tab and shows them in the All tab", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () =>
        HttpResponse.json([
          member,
          {
            user_id: "u_accepted",
            email: "accepted@example.test",
            name: "Accepted User",
            role: "VIEWER",
            joined_at: "2026-05-02T00:00:00Z",
          },
        ]),
      ),
      http.get("*/api/v1/workspaces/ws_1/invitations", () =>
        HttpResponse.json({
          items: [
            {
              id: "inv_pending",
              email: "pending@example.test",
              role: "QA",
              expires_at: FUTURE,
              accepted_at: null,
              revoked_at: null,
              link: null,
            },
            {
              id: "inv_accepted",
              email: "accepted@example.test",
              role: "VIEWER",
              expires_at: FUTURE,
              accepted_at: "2026-05-02T00:00:00Z",
              revoked_at: null,
              link: null,
            },
          ],
        }),
      ),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();

    // In default Pending tab: pending@example.test is present in invite-row, accepted@example.test is NOT
    expect(await screen.findByText("pending@example.test")).toBeInTheDocument();
    const pendingRows = screen.getAllByTestId("invite-row");
    expect(pendingRows).toHaveLength(1);
    expect(within(pendingRows[0]!).getByText("pending@example.test")).toBeInTheDocument();

    // Pending tab counter should be 1
    expect(screen.getByTestId("invite-tab-pending")).toHaveTextContent("Pending (1)");
    expect(screen.getByTestId("invite-tab-all")).toHaveTextContent("All (2)");

    // Switch to All tab
    await user.click(screen.getByTestId("invite-tab-all"));

    // Both should be visible in All tab
    const allRows = screen.getAllByTestId("invite-row");
    expect(allRows).toHaveLength(2);
    expect(screen.getByText("Active member")).toBeInTheDocument();
  });

  it("allows an ADMIN to update a pending invitation's role", async () => {
    let patchedRoleId: string | null = null;
    let patchedRoleVal: string | null = null;

    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () => HttpResponse.json([member])),
      http.get("*/api/v1/workspaces/ws_1/invitations", () =>
        HttpResponse.json({
          items: [
            {
              id: "inv_pending",
              email: "pending@example.test",
              role: "QA",
              expires_at: FUTURE,
              accepted_at: null,
              revoked_at: null,
              link: null,
            },
          ],
        }),
      ),
      http.patch("*/api/v1/invitations/:id", async ({ params, request }) => {
        patchedRoleId = params.id as string;
        const body = (await request.json()) as { role: string };
        patchedRoleVal = body.role;
        return HttpResponse.json({
          id: params.id,
          email: "pending@example.test",
          role: body.role,
          expires_at: FUTURE,
          accepted_at: null,
          revoked_at: null,
          link: null,
        });
      }),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();

    const roleSelect = await screen.findByTestId("invite-role-select-inv_pending");
    expect(roleSelect).toHaveValue("QA");

    await user.selectOptions(roleSelect, "ADMIN");

    await waitFor(() => {
      expect(patchedRoleId).toBe("inv_pending");
      expect(patchedRoleVal).toBe("ADMIN");
    });
  });

  it("allows dismissing the invite-link-panel via the close button", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () =>
        HttpResponse.json({
          items: [
            {
              id: "inv_1",
              email: "qa@example.test",
              role: "QA",
              expires_at: FUTURE,
              accepted_at: null,
              revoked_at: null,
              link: null,
            },
          ],
        }),
      ),
      http.post("*/api/v1/invitations/inv_1/resend", () =>
        HttpResponse.json({
          id: "inv_1",
          email: "qa@example.test",
          role: "QA",
          expires_at: FUTURE,
          accepted_at: null,
          revoked_at: null,
          link: "http://localhost/accept-invite?token=rotated",
        }),
      ),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("resend-inv_1"));
    expect(await screen.findByTestId("invite-link-panel")).toBeInTheDocument();

    await user.click(screen.getByTestId("dismiss-invite-link"));
    expect(screen.queryByTestId("invite-link-panel")).not.toBeInTheDocument();
  });

  it("dismisses the invite-link-panel when revoking the active link invitation", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () =>
        HttpResponse.json({
          items: [
            {
              id: "inv_1",
              email: "qa@example.test",
              role: "QA",
              expires_at: FUTURE,
              accepted_at: null,
              revoked_at: null,
              link: null,
            },
          ],
        }),
      ),
      http.post("*/api/v1/invitations/inv_1/resend", () =>
        HttpResponse.json({
          id: "inv_1",
          email: "qa@example.test",
          role: "QA",
          expires_at: FUTURE,
          accepted_at: null,
          revoked_at: null,
          link: "http://localhost/accept-invite?token=rotated",
        }),
      ),
      http.post("*/api/v1/invitations/inv_1/revoke", () => new HttpResponse(null, { status: 204 })),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("resend-inv_1"));
    expect(await screen.findByTestId("invite-link-panel")).toBeInTheDocument();

    await user.click(screen.getByTestId("revoke-inv_1"));
    await waitFor(() => {
      expect(screen.queryByTestId("invite-link-panel")).not.toBeInTheDocument();
    });
  });

  it("distinguishes currently active members from past accepted members in all invitations", async () => {
    const activeMember = {
      user_id: "u_active",
      email: "active@example.test",
      name: "Active Member",
      role: "QA",
      joined_at: "2026-05-01T00:00:00Z",
    };
    server.use(
      http.get("*/api/v1/workspaces/ws_1/members", () =>
        HttpResponse.json([member, activeMember]),
      ),
      http.get("*/api/v1/workspaces/ws_1/invitations", () =>
        HttpResponse.json({
          items: [
            {
              id: "inv_active",
              email: "active@example.test",
              role: "QA",
              expires_at: FUTURE,
              accepted_at: "2026-05-01T00:00:00Z",
              revoked_at: null,
              link: null,
            },
            {
              id: "inv_past",
              email: "past@example.test",
              role: "QA",
              expires_at: FUTURE,
              accepted_at: "2026-04-01T00:00:00Z",
              revoked_at: null,
              link: null,
            },
          ],
        }),
      ),
    );
    renderPanel("ADMIN");
    const user = userEvent.setup();

    // Switch to All tab
    await user.click(await screen.findByTestId("invite-tab-all"));

    expect(await screen.findByText("Active member")).toBeInTheDocument();
    expect(screen.getByText("accepted (past)")).toBeInTheDocument();
    expect(screen.getByText("No longer a member")).toBeInTheDocument();

    // Clicking Re-invite should open the invite modal prefilled with past member's email
    await user.click(screen.getByTestId("reinvite-inv_past"));
    expect(await screen.findByDisplayValue("past@example.test")).toBeInTheDocument();
  });

  it("displays target workspace badge and mentions workspace name in invite modal", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
    );
    renderPanel("ADMIN", "Acme Corp");
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("invite-button"));
    const badge = await screen.findByTestId("target-workspace-badge");
    expect(badge).toHaveTextContent("Target Workspace:");
    expect(badge).toHaveTextContent("Acme Corp");

    expect(screen.getByText("Invite a member to Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("They will receive an invitation to join Acme Corp.")).toBeInTheDocument();
    expect(screen.getByTestId("invite-submit")).toHaveTextContent("Invite to Acme Corp");
  });

  it("disables submit button and shows amber warning when typing an already active member's email", async () => {
    server.use(
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
    );
    renderPanel("ADMIN", "Acme Corp");
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("invite-button"));
    const input = await screen.findByLabelText(/email/i);

    // Typing owner@example.test which is already active member
    await user.type(input, "owner@example.test");

    const warning = await screen.findByTestId("invite-already-member");
    expect(warning).toHaveTextContent("This user is already an active member of Acme Corp.");
    expect(screen.getByTestId("invite-submit")).toBeDisabled();
    expect(screen.queryByTestId("invite-lookup-match")).not.toBeInTheDocument();
  });

  it("falls back to another workspace when user leaves active workspace but still has another workspace", async () => {
    const selfMember = {
      user_id: "u_self",
      email: "self@example.test",
      name: "Self User",
      role: "ADMIN",
      joined_at: "2026-05-02T00:00:00Z",
    };
    useActiveWorkspace.getState().setWorkspaceId("ws_1");
    server.use(
      http.get("*/api/v1/auth/me", () =>
        HttpResponse.json({
          id: "u_self",
          email: "self@example.test",
          name: "Self User",
          memberships: [
            {
              workspace_id: "ws_2",
              role: "QA",
              workspace: { id: "ws_2", slug: "beta", name: "Beta Workspace" },
            },
          ],
        }),
      ),
      http.get("*/api/v1/workspaces/ws_1/members", () =>
        HttpResponse.json([member, selfMember]),
      ),
      http.get("*/api/v1/workspaces/ws_1/invitations", () => HttpResponse.json({ items: [] })),
      http.delete("*/api/v1/workspaces/ws_1/members/u_self", () => {
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPanel("ADMIN", "Acme Corp");
    const user = userEvent.setup();

    const leaveBtn = await screen.findByTestId("remove-member-u_self");
    expect(leaveBtn).toHaveTextContent("Leave");

    await user.click(leaveBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Leave Workspace")).toBeInTheDocument();

    const confirmBtn = within(dialog).getByTestId("confirm-remove-member-btn");
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(useActiveWorkspace.getState().workspaceId).toBe("ws_2");
    });
>>>>>>> f7d6ba0 (feat(web): full CRUD for workspace member management, real-time sync, and multi-workspace fallback (closes #224))
  });
});

