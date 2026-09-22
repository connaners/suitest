import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CopyButton } from "@/components/shared/CopyButton";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePermissions } from "@/hooks/use-permissions";
import type { CurrentUser } from "@/hooks/use-current-user";
import { broadcastWorkspaceSwitch, logoutAndRedirect } from "@/lib/auth-session";
import { useWorkspaceStream } from "@/lib/ws-client";
import { useActiveProject } from "@/stores/use-active-project";
import { useActiveWorkspace } from "@/stores/use-active-workspace";
import { useCapabilities } from "@/stores/use-capabilities";
import {
  ApiError,
  api,
  changeWorkspaceMemberRole,
  createInvitation,
  type InvitationOut,
  type InvitationStatus,
  invitationStatus,
  listInvitations,
  listMembers,
  lookupInviteEmail,
  removeWorkspaceMember,
  resendInvitation,
  revokeInvitation,
  updateInvitationRole,
  type Role,
  type WorkspaceMemberPublic,
} from "@/lib/api-client";

/** Debounce delay before an in-flight email is checked against existing
 * accounts (M1e-9 autocomplete chip) — long enough to skip mid-typing. */
const EMAIL_LOOKUP_DEBOUNCE_MS = 400;

/** Invite creation is limited to ADMIN/QA/VIEWER — OWNER stays a separate action. */
const INVITE_ROLES: Role[] = ["ADMIN", "QA", "VIEWER"];
const ROLE_OPTIONS = INVITE_ROLES.map((r) => (
  <option key={r} value={r}>
    {r}
  </option>
));

/** Roles allowed to manage invitations (OWNER + ADMIN). */
function canManageInvites(role: string | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const STATUS_STYLE: Record<InvitationStatus, string> = {
  pending: "text-amber",
  accepted: "text-accent",
  revoked: "text-fg-4",
  declined: "text-fg-4",
  expired: "text-red",
};

const STATUS_KEY: Record<InvitationStatus, string> = {
  pending: "members.statusPending",
  accepted: "members.statusAccepted",
  revoked: "members.statusRevoked",
  declined: "members.statusDeclined",
  expired: "members.statusExpired",
};

interface MembersPanelProps {
  workspaceId: string;
  workspaceName?: string | undefined;
  /** Current user's role in this workspace; gates the Invite affordances. */
  currentRole: string | undefined;
}

export function MembersPanel({
  workspaceId,
  workspaceName,
  currentRole,
}: MembersPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const permissions = usePermissions(currentRole);
  const { isOwner, canManageMembers, userId: currentUserId } = permissions;
  const isAdmin = canManageInvites(currentRole);

  const membersQuery = useQuery({
    queryKey: ["workspace", workspaceId, "members"],
    queryFn: () => listMembers(workspaceId),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const invitesQuery = useQuery({
    queryKey: ["workspace", workspaceId, "invitations"],
    queryFn: () => listInvitations(workspaceId),
    enabled: isAdmin,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteInitialEmail, setInviteInitialEmail] = useState("");
  const [created, setCreated] = useState<InvitationOut | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMemberPublic | null>(null);

  const invalidateMembers = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId, "members"] });
  };

  const invalidateInvites = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId, "invitations"] });
  };

  useWorkspaceStream(
    (event) => {
      if (event.event === "invitation.resolved") {
        invalidateInvites();
        invalidateMembers();
      }
      if (
        event.event === "workspace.member.role_changed" ||
        event.event === "workspace.member.removed" ||
        event.event === "workspace.member.joined"
      ) {
        invalidateMembers();
        if (event.event === "workspace.member.role_changed" && event.data.userId === currentUserId) {
          void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
        }
      }
      if (
        event.event === "workspace.invitation.created" ||
        event.event === "workspace.invitation.updated" ||
        event.event === "workspace.invitation.revoked" ||
        event.event === "workspace.invitation.accepted"
      ) {
        if (
          event.event === "workspace.invitation.revoked" ||
          event.event === "workspace.invitation.accepted"
        ) {
          const invData = event.data as { invitationId?: string; email?: string };
          setCreated((prev) => {
            if (!prev) return null;
            if (invData.invitationId && prev.id === invData.invitationId) return null;
            if (invData.email && prev.email.toLowerCase() === invData.email.toLowerCase()) return null;
            return prev;
          });
        }
        invalidateInvites();
      }
    },
    () => {
      invalidateMembers();
      invalidateInvites();
    },
  );

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      changeWorkspaceMemberRole(workspaceId, userId, role),
    onSuccess: (updated) => {
      toast.success("Member role updated");
      invalidateMembers();
      if (updated.user_id === currentUserId) {
        void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      }
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError &&
        (err.code === "SOLE_OWNER_PROTECTED" || err.message?.toLowerCase().includes("sole"))
          ? "You cannot change the role of the sole remaining Owner. Promote another member to Owner first."
          : err instanceof ApiError &&
              (err.code === "OWNER_GRANT_REQUIRES_OWNER" ||
                err.message?.toLowerCase().includes("only an owner"))
            ? "Only a workspace Owner can modify an Owner's role or grant the Owner role."
            : err instanceof ApiError
              ? err.message
              : "Failed to update member role.";
      toast.error("Role update failed", { description: msg });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(workspaceId, userId),
    onSuccess: async (_, userId) => {
      setRemoveTarget(null);
      if (userId === currentUserId) {
        try {
          const freshMe = (await api.get<CurrentUser>("/auth/me")).data;
          queryClient.setQueryData<CurrentUser>(["auth", "me"], freshMe);
          const remaining = freshMe.memberships.filter((m) => m.workspace_id !== workspaceId);
          if (remaining.length > 0) {
            const nextWs = remaining[0]!;
            useActiveWorkspace.getState().setWorkspaceId(nextWs.workspace_id);
            useActiveProject.getState().setProjectId(null);
            broadcastWorkspaceSwitch(nextWs.workspace_id);
            void queryClient.cancelQueries();
            void queryClient.invalidateQueries();
            void useCapabilities.getState().fetch();
            toast.info(t("workspace.leftTitle", "Left workspace"), {
              description: t(
                "workspace.leftDesc",
                "You left {{prev}}. Switched to {{next}}.",
                { prev: workspaceName || "workspace", next: nextWs.workspace.name },
              ),
              duration: 5000,
            });
            try {
              window.location.assign("/dashboard");
            } catch {
              // jsdom in tests
            }
          } else {
            toast.success("You left the workspace");
            void logoutAndRedirect("left");
          }
        } catch {
          toast.success("You left the workspace");
          void logoutAndRedirect("left");
        }
      } else {
        toast.success("Member removed");
        invalidateMembers();
      }
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError &&
        (err.code === "SOLE_OWNER_PROTECTED" || err.message?.toLowerCase().includes("sole"))
          ? "The sole remaining Owner cannot be removed from the workspace. Transfer ownership to another member before leaving or removing this account."
          : err instanceof ApiError &&
              (err.code === "OWNER_GRANT_REQUIRES_OWNER" ||
                err.message?.toLowerCase().includes("only an owner"))
            ? "Only a workspace Owner can remove another Owner from the workspace."
            : err instanceof ApiError
              ? err.message
              : "Failed to remove member.";
      toast.error("Action failed", { description: msg });
    },
  });

  const [inviteTab, setInviteTab] = useState<"pending" | "all">("pending");

  const inviteRoleMutation = useMutation({
    mutationFn: ({ invitationId, role }: { invitationId: string; role: Role }) =>
      updateInvitationRole(invitationId, role),
    onSuccess: () => {
      toast.success("Invitation role updated");
      invalidateInvites();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : "Failed to update invitation role.";
      toast.error("Role update failed", { description: msg });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: (_, revokedId) => {
      setCreated((prev) => (prev?.id === revokedId ? null : prev));
      invalidateInvites();
    },
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendInvitation(id),
    onSuccess: (res) => {
      if (res.link) {
        setCreated(res);
      }
      invalidateInvites();
    },
  });

  const members = membersQuery.data ?? [];
  const ownerCount = members.filter((m) => m.role === "OWNER").length;

  const allInvites = invitesQuery.data ?? [];
  const pendingInvites = allInvites.filter((inv) => invitationStatus(inv) === "pending");
  const displayedInvites = inviteTab === "pending" ? pendingInvites : allInvites;

  const activeMemberEmails = new Set(members.map((m) => m.email.toLowerCase()));
  const isCreatedRevokedOrAccepted = created?.id
    ? allInvites.some((i) => i.id === created.id && (Boolean(i.revoked_at) || Boolean(i.accepted_at)))
    : false;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-fg-1">{t("members.title")}</h2>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => {
                setCreated(null);
                setInviteInitialEmail("");
                setInviteOpen(true);
              }}
              className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:opacity-90"
              data-testid="invite-button"
            >
              {t("members.inviteButton")}
            </button>
          ) : null}
        </div>

        {membersQuery.isError ? (
          <p
            role="alert"
            className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12.5px] text-red"
          >
            {t("members.loadError")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-bg-elev-2 text-[11px] uppercase tracking-[0.07em] text-fg-4">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("members.columnMember")}</th>
                  <th className="px-3 py-2 font-medium">{t("members.columnEmail")}</th>
                  <th className="px-3 py-2 font-medium">{t("members.columnRole")}</th>
                  {canManageMembers ? (
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isSoleOwner = m.role === "OWNER" && ownerCount <= 1;
                  const isSelf = m.user_id === currentUserId;
                  const isOwnerTarget = m.role === "OWNER";
                  const cannotModifyRole = isSoleOwner || (isOwnerTarget && !isOwner);
                  const cannotRemove = isSoleOwner || (isOwnerTarget && !isOwner && !isSelf);

                  const roleTitle = isSoleOwner
                    ? "You cannot change the role of the sole remaining Owner. Promote another member to Owner first."
                    : isOwnerTarget && !isOwner
                      ? "Only a workspace Owner can modify an Owner's role."
                      : undefined;

                  const removeTitle = isSoleOwner
                    ? "The sole remaining Owner cannot be removed from the workspace. Transfer ownership to another member before leaving or removing this account."
                    : isOwnerTarget && !isOwner && !isSelf
                      ? "Only a workspace Owner can remove another Owner."
                      : undefined;

                  return (
                    <tr key={m.user_id} className="border-t border-border" data-testid="member-row">
                      <td className="px-3 py-2 text-fg-1">{m.name}</td>
                      <td className="px-3 py-2 text-fg-3">{m.email}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-fg-1">
                        {canManageMembers ? (
                          <select
                            value={m.role}
                            disabled={cannotModifyRole || roleMutation.isPending}
                            onChange={(e) => {
                              const newRole = e.target.value as Role;
                              if (newRole !== m.role) {
                                roleMutation.mutate({ userId: m.user_id, role: newRole });
                              }
                            }}
                            className="rounded border border-border bg-bg-base px-2 py-1 font-mono text-[12px] text-fg-1 outline-none focus:border-accent disabled:opacity-50"
                            data-testid={`member-role-select-${m.user_id}`}
                            title={roleTitle}
                          >
                            {isOwner || m.role === "OWNER" ? (
                              <option value="OWNER">OWNER</option>
                            ) : null}
                            <option value="ADMIN">ADMIN</option>
                            <option value="QA">QA</option>
                            <option value="VIEWER">VIEWER</option>
                          </select>
                        ) : (
                          m.role
                        )}
                      </td>
                      {canManageMembers ? (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={cannotRemove || removeMutation.isPending}
                            onClick={() => setRemoveTarget(m)}
                            className="rounded px-2 py-1 text-[12px] font-medium text-red hover:bg-red/10 disabled:opacity-40 disabled:hover:bg-transparent"
                            data-testid={`remove-member-${m.user_id}`}
                            title={removeTitle}
                          >
                            {isSelf ? "Leave" : "Remove"}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Confirmation Dialog for Remove / Leave */}
      <Dialog open={removeTarget !== null} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="leading-snug break-words text-lg font-semibold">
              {removeTarget?.user_id === currentUserId ? "Leave Workspace" : "Remove Member"}
            </DialogTitle>
            <DialogDescription className="break-words leading-relaxed text-[13px] text-muted-foreground pt-1">
              {removeTarget?.user_id === currentUserId ? (
                "Are you sure you want to leave this workspace? You will lose access to all test cases, test runs, and workspace data until re-invited by an administrator."
              ) : (
                <>
                  Are you sure you want to remove{" "}
                  <span className="break-all font-mono font-medium text-fg-1">
                    {removeTarget?.email}
                  </span>{" "}
                  from this workspace? They will immediately lose access to all test cases, test runs, and workspace configurations.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 flex gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setRemoveTarget(null)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-[13px] font-medium text-fg-2 hover:bg-bg-elev-2 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={removeMutation.isPending}
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.user_id)}
              className="inline-flex h-9 items-center justify-center rounded-md bg-red px-4 text-[13px] font-medium text-white hover:bg-red/90 whitespace-nowrap shrink-0 disabled:opacity-60"
              data-testid="confirm-remove-member-btn"
            >
              {removeMutation.isPending
                ? "Processing..."
                : removeTarget?.user_id === currentUserId
                  ? "Leave"
                  : "Remove"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isAdmin ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-[15px] font-semibold text-fg-1">Invitations</h2>
              <div className="flex rounded-md border border-border bg-bg-elev-1 p-0.5 text-[12px]">
                <button
                  type="button"
                  onClick={() => setInviteTab("pending")}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    inviteTab === "pending"
                      ? "bg-bg-elev-3 text-fg-1 shadow-sm"
                      : "text-fg-4 hover:text-fg-2"
                  }`}
                  data-testid="invite-tab-pending"
                >
                  Pending ({pendingInvites.length})
                </button>
                <button
                  type="button"
                  onClick={() => setInviteTab("all")}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    inviteTab === "all"
                      ? "bg-bg-elev-3 text-fg-1 shadow-sm"
                      : "text-fg-4 hover:text-fg-2"
                  }`}
                  data-testid="invite-tab-all"
                >
                  All ({allInvites.length})
                </button>
              </div>
            </div>
          </div>

          {invitesQuery.isError ? (
            <p
              role="alert"
              className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12.5px] text-red"
            >
              {t("members.pendingLoadError")}
            </p>
          ) : displayedInvites.length === 0 ? (
            <p className="text-[13px] text-fg-4">
              {inviteTab === "pending" ? "No pending invitations." : "No invitations yet."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-bg-elev-2 text-[11px] uppercase tracking-[0.07em] text-fg-4">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("members.columnEmail")}</th>
                    <th className="px-3 py-2 font-medium">{t("members.columnRole")}</th>
                    <th className="px-3 py-2 font-medium">{t("members.columnStatus")}</th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t("members.columnActions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedInvites.map((inv) => {
                    const status = invitationStatus(inv);
                    const isPending = status === "pending";
                    const isMemberNow = activeMemberEmails.has(inv.email.toLowerCase());
                    return (
                      <tr key={inv.id} className="border-t border-border" data-testid="invite-row">
                        <td className="px-3 py-2 text-fg-1">{inv.email}</td>
                        <td className="px-3 py-2 font-mono text-[12px] text-fg-1">
                          {isPending ? (
                            <select
                              value={inv.role}
                              disabled={inviteRoleMutation.isPending}
                              onChange={(e) => {
                                const newRole = e.target.value as Role;
                                if (newRole !== inv.role) {
                                  inviteRoleMutation.mutate({
                                    invitationId: inv.id,
                                    role: newRole,
                                  });
                                }
                              }}
                              className="rounded border border-border bg-bg-base px-2 py-1 font-mono text-[12px] text-fg-1 outline-none focus:border-accent disabled:opacity-50"
                              data-testid={`invite-role-select-${inv.id}`}
                            >
                              {ROLE_OPTIONS}
                            </select>
                          ) : (
                            inv.role
                          )}
                        </td>
                        <td className={`px-3 py-2 font-medium ${STATUS_STYLE[status]}`}>
                          {status === "accepted" && !isMemberNow ? "accepted (past)" : t(STATUS_KEY[status])}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isPending ? (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={resendMutation.isPending}
                                onClick={() => resendMutation.mutate(inv.id)}
                                className="rounded-md px-2 py-1 text-[12px] font-medium text-fg-1 hover:bg-bg-elev-2 disabled:opacity-50"
                                data-testid={`resend-${inv.id}`}
                              >
                                {t("members.resend")}
                              </button>
                              <button
                                type="button"
                                disabled={revokeMutation.isPending}
                                onClick={() => revokeMutation.mutate(inv.id)}
                                className="rounded-md px-2 py-1 text-[12px] font-medium text-red hover:bg-red/10 disabled:opacity-50"
                                data-testid={`revoke-${inv.id}`}
                              >
                                {t("members.revoke")}
                              </button>
                            </div>
                          ) : status === "accepted" ? (
                            isMemberNow ? (
                              <span className="text-[12px] text-fg-4 italic">Active member</span>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <span
                                  className="text-[12px] text-fg-4 italic"
                                  title="Member has left or was removed from this workspace"
                                >
                                  No longer a member
                                </span>
                                {isAdmin ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCreated(null);
                                      setInviteInitialEmail(inv.email);
                                      setInviteOpen(true);
                                    }}
                                    className="rounded-md border border-border px-2 py-0.5 text-[12px] font-medium text-fg-2 hover:bg-bg-elev-2 hover:text-fg-1"
                                    data-testid={`reinvite-${inv.id}`}
                                  >
                                    Re-invite
                                  </button>
                                ) : null}
                              </div>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {created?.link && !isCreatedRevokedOrAccepted ? (
            <div
              className="space-y-2 rounded-lg border border-border bg-bg-elev-1 p-4"
              data-testid="invite-link-panel"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12.5px] font-medium text-fg-1">
                  Personal link for {created.email} to join {workspaceName || "workspace"}
                </p>
                <button
                  type="button"
                  onClick={() => setCreated(null)}
                  aria-label="Dismiss link panel"
                  className="rounded p-1 text-fg-4 hover:bg-bg-elev-2 hover:text-fg-1"
                  data-testid="dismiss-invite-link"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[12px] text-fg-4">
                Send this link only to {created.email}. It works once and lets
                that person join {workspaceName ? <span className="font-medium text-fg-2">{workspaceName}</span> : "this workspace"} — it cannot be reused by
                anyone else.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-border bg-bg-base px-3 py-2 font-mono text-[12px] text-fg-1">
                  {created.link}
                </code>
                <CopyButton value={created.link} label={t("members.copyLink")} />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <InviteModal
        open={inviteOpen}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        activeMemberEmails={activeMemberEmails}
        initialEmail={inviteInitialEmail}
        onOpenChange={setInviteOpen}
        onCreated={(inv) => {
          if (inv.link) {
            setCreated(inv);
          }
          invalidateInvites();
        }}
      />
    </div>
  );
}

interface InviteModalProps {
  open: boolean;
  workspaceId: string;
  workspaceName?: string | undefined;
  activeMemberEmails: Set<string>;
  initialEmail?: string | undefined;
  onOpenChange: (open: boolean) => void;
  onCreated: (inv: InvitationOut) => void;
}

function InviteModal({
  open,
  workspaceId,
  workspaceName,
  activeMemberEmails,
  initialEmail = "",
  onOpenChange,
  onCreated,
}: InviteModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [debouncedEmail, setDebouncedEmail] = useState(initialEmail);
  const [role, setRole] = useState<Role>("QA");
  const [error, setError] = useState<string | null>(null);

  const isReinvite = Boolean(initialEmail);
  const targetWsLabel = workspaceName || "this workspace";

  useEffect(() => {
    if (open) {
      setEmail(initialEmail);
      setDebouncedEmail(initialEmail.trim().toLowerCase());
      setError(null);
    }
  }, [open, initialEmail]);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedEmail(email.trim().toLowerCase()),
      EMAIL_LOOKUP_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [email]);

  const isPlausibleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debouncedEmail);
  const isAlreadyMember = isPlausibleEmail && activeMemberEmails.has(debouncedEmail);

  const lookup = useQuery({
    queryKey: ["invite-lookup", workspaceId, debouncedEmail] as const,
    queryFn: () => lookupInviteEmail(workspaceId, debouncedEmail),
    enabled: isPlausibleEmail && !isAlreadyMember,
  });

  const createMutation = useMutation({
    mutationFn: () => createInvitation(workspaceId, { email, role }),
    onSuccess: (res) => {
      onCreated(res);
      setEmail("");
      setRole("QA");
      setError(null);
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("members.conflictError"));
        return;
      }
      setError(t("members.genericError"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isReinvite
              ? `Re-invite member to ${targetWsLabel}`
              : `Invite a member to ${targetWsLabel}`}
          </DialogTitle>
          <DialogDescription>
            They will receive an invitation to join {targetWsLabel}.
          </DialogDescription>
        </DialogHeader>

        {workspaceName ? (
          <div
            className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-2 text-[12px] text-fg-2"
            data-testid="target-workspace-badge"
          >
            <span className="font-medium text-fg-3">Target Workspace:</span>
            <span className="font-semibold text-fg-1">{workspaceName}</span>
          </div>
        ) : null}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (isAlreadyMember) return;
            createMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="invite-email" className="text-[12.5px] font-medium text-fg-1">
              {t("members.emailLabel")}
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-[13px] text-fg-1 outline-none focus:border-accent"
            />
            {isAlreadyMember ? (
              <p
                data-testid="invite-already-member"
                className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-500"
              >
                This user is already an active member of {targetWsLabel}.
              </p>
            ) : isPlausibleEmail && lookup.data?.exists ? (
              <p
                data-testid="invite-lookup-match"
                className="rounded-md border border-accent/20 bg-accent/10 px-2.5 py-1.5 text-[12px] text-accent"
              >
                {t("members.lookupMatch", { name: lookup.data.name })}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="invite-role" className="text-[12.5px] font-medium text-fg-1">
              {t("members.roleLabel")}
            </label>
            <select
              id="invite-role"
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-[13px] text-fg-1 outline-none focus:border-accent"
            >
              {ROLE_OPTIONS}
            </select>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-[12.5px] text-red"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <button
              type="submit"
              disabled={createMutation.isPending || isAlreadyMember}
              className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-60"
              data-testid="invite-submit"
            >
              {createMutation.isPending
                ? "Creating…"
                : isReinvite
                  ? `Re-invite to ${targetWsLabel}`
                  : `Invite to ${targetWsLabel}`}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
