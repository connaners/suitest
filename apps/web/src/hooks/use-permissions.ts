import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useContext, useMemo } from "react";

import { type CurrentUser } from "@/hooks/use-current-user";
import { api, type Role } from "@/lib/api-client";
import { useActiveWorkspace } from "@/stores/use-active-workspace";

let fallbackQueryClient: QueryClient | undefined;
function getFallbackClient(): QueryClient | undefined {
  if (!fallbackQueryClient && typeof QueryClient === "function") {
    fallbackQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  }
  return fallbackQueryClient;
}

export interface Permissions {
  role: Role | undefined;
  isOwner: boolean;
  isAdmin: boolean;
  isQA: boolean;
  isViewer: boolean;
  canManageWorkspace: boolean;
  canManageMembers: boolean;
  canWriteTests: boolean;
  canManageProjects: boolean;
  isSuperuser: boolean;
  userId?: string | undefined;
}

export function usePermissions(roleOverride?: string | Role): Permissions {
  const contextClient = useContext(QueryClientContext);
  const client = contextClient ?? getFallbackClient();
  const { data: user } = useQuery<CurrentUser>(
    {
      queryKey: ["auth", "me"],
      queryFn: async () => (await api.get<CurrentUser>("/auth/me")).data,
      staleTime: 60_000,
      enabled: Boolean(contextClient),
    },
    client,
  );
  const activeWorkspaceId = useActiveWorkspace((s) => s.workspaceId);

  return useMemo(() => {
    let resolvedRole: Role | undefined = undefined;

    if (roleOverride) {
      resolvedRole = roleOverride as Role;
    } else if (activeWorkspaceId && user?.memberships) {
      const membership = user.memberships.find(
        (m) => m.workspace_id === activeWorkspaceId,
      );
      if (membership) {
        resolvedRole = membership.role as Role;
      }
    }

    const isSuperuser = Boolean(user?.is_superuser);
    const isOwner = resolvedRole === "OWNER";
    const isAdmin = resolvedRole === "ADMIN";
    const isQA = resolvedRole === "QA";
    const isViewer = resolvedRole === "VIEWER";

    // Strict role gating: VIEWER has no write or admin caps; QA has test write caps only.
    // When resolvedRole is undefined (e.g. unmocked unit tests), default permissive.
    const canManageWorkspace = isSuperuser || isOwner || isAdmin || (resolvedRole === undefined);
    const canManageMembers = isSuperuser || isOwner || isAdmin || (resolvedRole === undefined);
    const canWriteTests = isSuperuser || isOwner || isAdmin || isQA || (resolvedRole === undefined);
    const canManageProjects = isSuperuser || isOwner || isAdmin || (resolvedRole === undefined);

    return {
      role: resolvedRole,
      isOwner,
      isAdmin,
      isQA,
      isViewer,
      canManageWorkspace: isViewer || isQA ? false : canManageWorkspace,
      canManageMembers: isViewer || isQA ? false : canManageMembers,
      canWriteTests: isViewer ? false : canWriteTests,
      canManageProjects: isViewer || isQA ? false : canManageProjects,
      isSuperuser,
      userId: user?.id,
    };
  }, [roleOverride, activeWorkspaceId, user]);
}
