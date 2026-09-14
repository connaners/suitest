import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "@/lib/api-client";
import { server } from "@/mocks/server";
import { useActiveWorkspace } from "@/stores/use-active-workspace";

describe("api-client", () => {
  beforeEach(() => {
    vi.stubGlobal("location", {
      pathname: "/dashboard",
      assign: vi.fn(),
    });
    useActiveWorkspace.getState().setWorkspaceId(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useActiveWorkspace.getState().setWorkspaceId(null);
  });

  it("returns parsed JSON on 200 happy path", async () => {
    server.use(
      http.get("*/api/v1/ping", () => HttpResponse.json({ ok: true, value: 42 })),
    );

    const res = await api.get<{ ok: boolean; value: number }>("/ping");

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, value: 42 });
  });

  it("redirects to /login?next= on 401", async () => {
    server.use(
      http.get("*/api/v1/protected", () =>
        HttpResponse.json({ code: "UNAUTHORIZED", message: "nope" }, { status: 401 }),
      ),
    );

    await expect(api.get("/protected")).rejects.toBeInstanceOf(ApiError);

    expect(window.location.assign).toHaveBeenCalledWith(
      "/login?next=" + encodeURIComponent("/dashboard"),
    );
  });

  it("throws ApiError with retryable=true on 500", async () => {
    server.use(
      http.get("*/api/v1/boom", () =>
        HttpResponse.json({ code: "INTERNAL", message: "kaboom" }, { status: 500 }),
      ),
    );

    let caught: ApiError | null = null;
    try {
      await api.get("/boom");
    } catch (err) {
      caught = err as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(500);
    expect(caught?.code).toBe("INTERNAL");
    expect(caught?.retryable).toBe(true);
  });

  it("attaches X-Workspace-Id header from active workspace store", async () => {
    useActiveWorkspace.getState().setWorkspaceId("ws_test_123");
    const received: { header: string | null } = { header: null };
    server.use(
      http.get("*/api/v1/test-endpoint", ({ request }) => {
        received.header = request.headers.get("X-Workspace-Id");
        return HttpResponse.json({ ok: true });
      }),
    );

    await api.get("/test-endpoint");

    expect(received.header).toBe("ws_test_123");
  });

  it("omits X-Workspace-Id header when no active workspace is set", async () => {
    useActiveWorkspace.getState().setWorkspaceId(null);
    const received: { header: string | null; called: boolean } = {
      header: null,
      called: false,
    };
    server.use(
      http.get("*/api/v1/test-endpoint-2", ({ request }) => {
        received.called = true;
        received.header = request.headers.get("X-Workspace-Id");
        return HttpResponse.json({ ok: true });
      }),
    );

    await api.get("/test-endpoint-2");

    expect(received.called).toBe(true);
    expect(received.header).toBeNull();
  });

  it("does NOT redirect to /login on 401 when already at /login", async () => {
    vi.stubGlobal("location", {
      pathname: "/login",
      assign: vi.fn(),
    });
    server.use(
      http.get("*/api/v1/something", () =>
        HttpResponse.json({ code: "UNAUTHORIZED", message: "nope" }, { status: 401 }),
      ),
    );

    await expect(api.get("/something")).rejects.toBeInstanceOf(ApiError);

    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("throws ApiError with code LLM_DISABLED and retryable=false on 400", async () => {
    server.use(
      http.get("*/api/v1/agent/generate", () =>
        HttpResponse.json(
          { code: "LLM_DISABLED", message: "LLM is disabled in ZERO tier" },
          { status: 400 },
        ),
      ),
    );

    let caught: ApiError | null = null;
    try {
      await api.get("/agent/generate");
    } catch (err) {
      caught = err as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(400);
    expect(caught?.code).toBe("LLM_DISABLED");
    expect(caught?.retryable).toBe(false);
    expect(caught?.message).toBe("LLM is disabled in ZERO tier");
  });

  it("extracts code, message, and details from FastAPI detail.error envelope", async () => {
    server.use(
      http.patch("*/api/v1/test-cases/TC-1000/steps", () =>
        HttpResponse.json(
          {
            detail: {
              error: {
                code: "STEPS_REQUIRE_CODE_IN_ZERO_LLM",
                message:
                  "Step #2 has no executable code. ZERO tier cannot translate action -> MCP call at runtime.",
                details: { stepIndex: 1, stepOrder: 2 },
              },
            },
          },
          { status: 400 },
        ),
      ),
    );

    let caught: ApiError | null = null;
    try {
      await api.patch("/test-cases/TC-1000/steps", { steps: [] });
    } catch (err) {
      caught = err as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(400);
    expect(caught?.code).toBe("STEPS_REQUIRE_CODE_IN_ZERO_LLM");
    expect(caught?.message).toBe(
      "Step #2 has no executable code. ZERO tier cannot translate action -> MCP call at runtime.",
    );
    expect(caught?.details).toEqual({ stepIndex: 1, stepOrder: 2 });
  });

  it("extracts message from string detail in FastAPI error response", async () => {
    server.use(
      http.get("*/api/v1/some-not-found", () =>
        HttpResponse.json({ detail: "test case not found" }, { status: 404 }),
      ),
    );

    let caught: ApiError | null = null;
    try {
      await api.get("/some-not-found");
    } catch (err) {
      caught = err as ApiError;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.status).toBe(404);
    expect(caught?.message).toBe("test case not found");
  });
});
