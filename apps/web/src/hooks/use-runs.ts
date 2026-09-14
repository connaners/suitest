import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
  type InfiniteData,
  type UseMutationResult,
  type UseQueryResult,
  type UseSuspenseInfiniteQueryResult,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";

import { api } from "@/lib/api-client";
import type { components } from "@/lib/api-types";
import { useActiveProject } from "@/stores/use-active-project";

type RunsPage = components["schemas"]["Page_RunListItem_"];
type RunDetail = components["schemas"]["RunDetail"];
type Steps = { items: components["schemas"]["RunStepPublic"][] };
type Logs = components["schemas"]["RunLogPage"];
type Artifacts = { items: components["schemas"]["ArtifactPublic"][] };

// Shape returned by ``POST /runs/:id/cancel`` and ``POST /runs/:id/rerun``.
// The OpenAPI client (`api-types.ts`) was generated before M1c shipped the
// cancel/rerun endpoints, so we hand-type the response here. Once the generator
// is re-run this can be swapped for `components["schemas"]["RunPublic"]`.
export interface RunPublicResponse {
  id: string;
  public_id: string;
  publicId?: string;
  status: components["schemas"]["RunStatus"];
}

/**
 * Body shape for ``POST /runs`` (docs/API.md §3.5, ``CreateRunBody``).
 *
 * The backend accepts both snake_case and the camelCase alias forms; we send
 * camelCase here so the request mirrors the FE-facing aliases declared in
 * ``apps/api/.../schemas/runs.py`` and we don't depend on the alias-resolver
 * order. ``selection`` is a list because the runner orchestrator already
 * supports multi-case runs — the M1d "Run now" shortcut on a case detail
 * just sends a one-item selection.
 */
export interface CreateRunInput {
  projectId: string;
  name: string;
  selection: Array<{ caseId: string; selectedStepIds?: string[] }>;
  branch?: string;
  commitSha?: string;
  env?: string;
  trigger?: components["schemas"]["RunTrigger"];
}

export interface RunsSummary {
  activeNow: number;
  today: number;
  passed: number;
  failed: number;
  avgDurationMs: number;
  queue: number;
}

export interface NetworkEvent {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export function useRunsList(limit = 50): UseSuspenseQueryResult<RunsPage> {
  const projectId = useActiveProject((s) => s.projectId);
  return useSuspenseQuery({
    queryKey: ["runs", { projectId, limit }] as const,
    queryFn: async () => {
      const res = await api.get<RunsPage>("/runs", { params: { projectId, limit } });
      return res.data;
    },
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      const hasLive = items?.some((r) => r.status === "RUNNING" || r.status === "QUEUED");
      return hasLive ? 2000 : false;
    },
  });
}

export function useRunsInfiniteList(
  limit = 30,
): UseSuspenseInfiniteQueryResult<InfiniteData<RunsPage, string | null>, Error> {
  const projectId = useActiveProject((s) => s.projectId);
  return useSuspenseInfiniteQuery({
    queryKey: ["runs", "infinite", { projectId, limit }] as const,
    queryFn: async ({ pageParam }) => {
      const res = await api.get<RunsPage>("/runs", {
        params: {
          projectId,
          limit,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      });
      return res.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      const meta = lastPage.meta as {
        nextCursor?: string | null;
        next_cursor?: string | null;
      };
      return meta?.nextCursor || meta?.next_cursor || null;
    },
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      const hasLive = pages?.some((page) =>
        page.items?.some((r) => r.status === "RUNNING" || r.status === "QUEUED"),
      );
      return hasLive ? 2000 : false;
    },
  });
}

export function useRunsSummary(): UseSuspenseQueryResult<RunsSummary> {
  return useSuspenseQuery({
    queryKey: ["runs", "summary"] as const,
    queryFn: async () => {
      // The backend `RunSummary` schema uses `active`/`queued`; the FE-facing
      // shape (consumed by SummaryBar) uses `activeNow`/`queue`. Map the two
      // field names here so the component reads defined values instead of
      // crashing on `undefined.toString()`.
      const res = await api.get<
        | {
            active: number;
            today: number;
            passed: number;
            failed: number;
            avgDurationMs: number;
            queued: number;
          }
        | RunsSummary
      >("/runs/summary");
      const d = res.data;
      if ("activeNow" in d) return d;
      return {
        activeNow: d.active,
        today: d.today,
        passed: d.passed,
        failed: d.failed,
        avgDurationMs: d.avgDurationMs,
        queue: d.queued,
      } satisfies RunsSummary;
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 2000;
      return d.activeNow > 0 || d.queue > 0 ? 2000 : 5000;
    },
  });
}

export function useRun(runId: string | undefined): UseQueryResult<RunDetail> {
  return useQuery({
    queryKey: ["runs", runId] as const,
    enabled: Boolean(runId),
    queryFn: async () => {
      const res = await api.get<RunDetail>(`/runs/${runId ?? ""}`);
      return res.data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const terminal =
        status === "PASS" || status === "FAIL" || status === "ERROR" || status === "CANCELLED";
      return terminal ? false : 2000;
    },
  });
}

export function useRunSteps(runId: string | undefined): UseQueryResult<Steps> {
  return useQuery({
    queryKey: ["runs", runId, "steps"] as const,
    enabled: Boolean(runId),
    queryFn: async () => {
      // Endpoint returns a BARE array (`list[RunStepPublic]`) — wrap as { items }.
      const res = await api.get<Steps["items"] | Steps>(`/runs/${runId ?? ""}/steps`);
      return { items: Array.isArray(res.data) ? res.data : res.data.items };
    },
  });
}

export function useRunLogs(runId: string | undefined): UseQueryResult<Logs> {
  return useQuery({
    queryKey: ["runs", runId, "logs"] as const,
    enabled: Boolean(runId),
    queryFn: async () => {
      const res = await api.get<Logs>(`/runs/${runId ?? ""}/logs`);
      return res.data;
    },
  });
}

export function useRunArtifacts(runId: string | undefined): UseQueryResult<Artifacts> {
  return useQuery({
    queryKey: ["runs", runId, "artifacts"] as const,
    enabled: Boolean(runId),
    queryFn: async () => {
      // Endpoint returns a BARE array (`list[ArtifactPublic]`) — wrap as { items }.
      const res = await api.get<Artifacts["items"] | Artifacts>(`/runs/${runId ?? ""}/artifacts`);
      return { items: Array.isArray(res.data) ? res.data : res.data.items };
    },
  });
}

export function useRunNetwork(
  runId: string | undefined,
): UseQueryResult<{ items: NetworkEvent[] }> {
  return useQuery({
    queryKey: ["runs", runId, "network"] as const,
    enabled: Boolean(runId),
    queryFn: async () => {
      const res = await api.get<{ items: NetworkEvent[] }>(`/runs/${runId ?? ""}/network`);
      return res.data;
    },
  });
}

/**
 * ``POST /runs`` — enqueue an ad-hoc run from the case detail "Run now" button.
 *
 * The backend returns 202 with a :class:`RunPublic` envelope; we narrow to the
 * fields the M1d shortcut needs (``public_id`` for navigation, ``status`` for
 * the optimistic queue badge). Invalidates the runs list + summary so the new
 * row pops in immediately on the Runs screen.
 */
export function useCreateRun(): UseMutationResult<RunPublicResponse, Error, CreateRunInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRunInput) => {
      const res = await api.post<RunPublicResponse>("/runs", {
        projectId: input.projectId,
        name: input.name,
        selection: input.selection,
        branch: input.branch ?? null,
        commitSha: input.commitSha ?? null,
        env: input.env ?? "staging",
        trigger: input.trigger ?? "MANUAL",
      });
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}

/**
 * ``POST /runs/:id/cancel`` — flip a QUEUED/RUNNING run to CANCELLED.
 *
 * Invalidates the run detail + the runs list on success so the UI badge
 * flips immediately. The server returns 409 ``run not cancellable`` for
 * runs already in a terminal state — surfaced via the mutation's `error`.
 */
export function useCancelRun(): UseMutationResult<RunPublicResponse, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const res = await api.post<RunPublicResponse>(`/runs/${runId}/cancel`);
      return res.data;
    },
    onSuccess: (data) => {
      const publicId = data.publicId || data.public_id;
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["run"] });
      qc.setQueryData(["run", data.id], (old: RunDetail | undefined) =>
        old ? { ...old, status: "CANCELLED" } : old,
      );
      qc.setQueryData(["runs", data.id], (old: RunDetail | undefined) =>
        old ? { ...old, status: "CANCELLED" } : old,
      );
      if (publicId) {
        qc.setQueryData(["run", publicId], (old: RunDetail | undefined) =>
          old ? { ...old, status: "CANCELLED" } : old,
        );
        qc.setQueryData(["runs", publicId], (old: RunDetail | undefined) =>
          old ? { ...old, status: "CANCELLED" } : old,
        );
      }
    },
  });
}

export interface RerunRunInput {
  runId: string;
  caseIds?: string[] | undefined;
  failedOnly?: boolean | undefined;
}

/**
 * ``POST /runs/:id/rerun`` — clone a run's selection into a new QUEUED row.
 *
 * Supports full rerun, selective rerun by caseIds, or failedOnly rerun.
 * Returns the new run on 202 so the caller can navigate to it. Invalidates
 * the runs list so the new row shows up at the top.
 */
export function useRerunRun(): UseMutationResult<
  RunPublicResponse,
  Error,
  string | RerunRunInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | RerunRunInput) => {
      const runId = typeof input === "string" ? input : input.runId;
      const caseIds = typeof input === "string" ? undefined : input.caseIds;
      const failedOnly = typeof input === "string" ? false : Boolean(input.failedOnly);

      const url = `/runs/${runId}/rerun${failedOnly ? "?failedOnly=true" : ""}`;
      const body =
        caseIds && caseIds.length > 0
          ? { case_ids: caseIds, caseIds, failed_only: failedOnly, failedOnly }
          : undefined;
      const res = await api.post<RunPublicResponse>(url, body);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}
