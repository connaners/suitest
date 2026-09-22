import type * as TanstackReactQuery from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePermissions } from "./use-permissions";

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof TanstackReactQuery>();
  return {
    ...actual,
    useQuery: vi.fn(() => ({
      data: {
        id: "usr_me_123",
        email: "tester@example.com",
        is_superuser: false,
        memberships: [
          { workspace_id: "ws_1", role: "OWNER" },
          { workspace_id: "ws_2", role: "ADMIN" },
          { workspace_id: "ws_3", role: "QA" },
          { workspace_id: "ws_4", role: "VIEWER" },
        ],
      },
    })),
  };
});

vi.mock("@/stores/use-active-workspace", () => ({
  useActiveWorkspace: (selector: (s: { workspaceId: string }) => unknown) =>
    selector({ workspaceId: "ws_1" }),
}));

describe("usePermissions", () => {
  it("resolves OWNER permissions correctly", () => {
    const { result } = renderHook(() => usePermissions("OWNER"));
    expect(result.current.role).toBe("OWNER");
    expect(result.current.isOwner).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.canManageWorkspace).toBe(true);
    expect(result.current.canManageMembers).toBe(true);
    expect(result.current.canWriteTests).toBe(true);
    expect(result.current.canManageProjects).toBe(true);
  });

  it("resolves ADMIN permissions correctly", () => {
    const { result } = renderHook(() => usePermissions("ADMIN"));
    expect(result.current.role).toBe("ADMIN");
    expect(result.current.isOwner).toBe(false);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.canManageWorkspace).toBe(true);
    expect(result.current.canManageMembers).toBe(true);
    expect(result.current.canWriteTests).toBe(true);
    expect(result.current.canManageProjects).toBe(true);
  });

  it("resolves QA permissions correctly (test write only, no workspace/member/project admin)", () => {
    const { result } = renderHook(() => usePermissions("QA"));
    expect(result.current.role).toBe("QA");
    expect(result.current.isOwner).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isQA).toBe(true);
    expect(result.current.canManageWorkspace).toBe(false);
    expect(result.current.canManageMembers).toBe(false);
    expect(result.current.canWriteTests).toBe(true);
    expect(result.current.canManageProjects).toBe(false);
  });

  it("resolves VIEWER permissions correctly (read-only, no write or admin caps)", () => {
    const { result } = renderHook(() => usePermissions("VIEWER"));
    expect(result.current.role).toBe("VIEWER");
    expect(result.current.isOwner).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isQA).toBe(false);
    expect(result.current.isViewer).toBe(true);
    expect(result.current.canManageWorkspace).toBe(false);
    expect(result.current.canManageMembers).toBe(false);
    expect(result.current.canWriteTests).toBe(false);
    expect(result.current.canManageProjects).toBe(false);
  });

  it("derives role from activeWorkspaceId when roleOverride is not provided", () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.role).toBe("OWNER");
    expect(result.current.isOwner).toBe(true);
    expect(result.current.canManageWorkspace).toBe(true);
  });
});
