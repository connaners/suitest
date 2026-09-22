import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { TestingApproachBadge } from "@/components/cases/TestingApproachBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

type Strategy = components["schemas"]["TestStrategyPublic"];
type StrategyDocument = components["schemas"]["TestStrategyDocument"];

export function TestStrategyDialog({
  open,
  onOpenChange,
  projectId,
  aiEnabled = false,
  canWrite = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  aiEnabled?: boolean;
  canWrite?: boolean;
}): React.ReactElement {
  const queryClient = useQueryClient();
  const [repository, setRepository] = useState(true);
  const [observability, setObservability] = useState(false);
  const [internalProvider, setInternalProvider] = useState(false);
  const [context, setContext] = useState("");
  const [documentText, setDocumentText] = useState("");

  const strategies = useQuery({
    queryKey: ["test-strategies", projectId] as const,
    enabled: open,
    queryFn: async () => {
      const response = await api.get<Strategy[]>(`/projects/${projectId}/test-strategies`);
      return response.data;
    },
  });
  const current = strategies.data?.[0];

  useEffect(() => {
    if (current) setDocumentText(JSON.stringify(current.document, null, 2));
  }, [current]);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ["test-strategies", projectId] });
  };
  const createDraft = useMutation({
    mutationFn: async () =>
      (
        await api.post<Strategy>(`/projects/${projectId}/test-strategies/draft`, {
          hasRepository: repository,
          hasInternalObservability: observability,
          hasInternalTestProvider: internalProvider,
          context,
        })
      ).data,
    onSuccess: refresh,
  });
  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error("No strategy selected");
      let document: StrategyDocument;
      try {
        document = JSON.parse(documentText) as StrategyDocument;
      } catch {
        throw new Error("Strategy JSON is invalid");
      }
      return (await api.put<Strategy>(`/test-strategies/${current.id}`, { document })).data;
    },
    onSuccess: refresh,
  });
  const approve = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error("No strategy selected");
      return (await api.post<Strategy>(`/test-strategies/${current.id}/approve`)).data;
    },
    onSuccess: refresh,
  });
  const enrich = useMutation({
    mutationFn: async () => {
      if (!current) throw new Error("No strategy selected");
      return (await api.post<Strategy>(`/test-strategies/${current.id}/enrich`)).data;
    },
    onSuccess: refresh,
  });
  const actionError =
    createDraft.error ?? saveDraft.error ?? approve.error ?? enrich.error ?? strategies.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-bg-elev-1 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Risk-based test strategy</DialogTitle>
          <DialogDescription>
            Choose access honestly. Approach is separate from test level and can be overridden per
            case.
          </DialogDescription>
        </DialogHeader>

        {!current ? (
          canWrite ? (
            <div className="flex flex-col gap-4 text-[13px]">
              <AccessCheck
                label="Repository source is available"
                checked={repository}
                onChange={setRepository}
              />
              <AccessCheck
                label="Logs, database, or internal observability is available"
                checked={observability}
                onChange={setObservability}
              />
              <AccessCheck
                label="A white-box test provider is configured"
                checked={internalProvider}
                onChange={setInternalProvider}
              />
              <textarea
                value={context}
                onChange={(event) => {
                  setContext(event.target.value);
                }}
                placeholder="Product risks, constraints, and assumptions…"
                className="min-h-24 rounded-md border border-border bg-bg-base p-3 text-fg-1 outline-none focus:border-accent"
              />
              <Button
                onClick={() => {
                  createDraft.mutate();
                }}
                disabled={createDraft.isPending}
              >
                {createDraft.isPending ? "Creating…" : "Create deterministic draft"}
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-fg-4">
              No test strategy has been configured for this project yet.
            </p>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <TestingApproachBadge approach={current.document.recommended_approach} />
              <span className="font-mono text-[11px] text-fg-4">
                v{current.version} · {current.status}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-fg-2">{current.document.summary}</p>
            <p className="text-[12px] leading-relaxed text-fg-3">
              {current.document.approach_reason}
            </p>
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-4">
                Highest-value risks
              </h3>
              <ul className="space-y-2">
                {(current.document.risks ?? []).map((risk) => (
                  <li key={risk.id} className="rounded-md border border-border bg-bg-base p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-medium text-fg-1">{risk.title}</span>
                      <TestingApproachBadge approach={risk.recommended_approach} />
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-fg-4">
                      {risk.impact} impact · {risk.likelihood} likelihood ·{" "}
                      {(risk.test_levels ?? []).join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
            {canWrite && current.status === "DRAFT" ? (
              <details>
                <summary className="cursor-pointer text-[12px] text-fg-3">
                  Edit strategy JSON
                </summary>
                <textarea
                  aria-label="Strategy JSON"
                  value={documentText}
                  onChange={(event) => {
                    setDocumentText(event.target.value);
                  }}
                  className="mt-2 min-h-72 w-full rounded-md border border-border bg-bg-base p-3 font-mono text-[11px] text-fg-2 outline-none focus:border-accent"
                />
              </details>
            ) : null}
          </div>
        )}

        {actionError ? (
          <p role="alert" className="text-[12px] text-red">
            {actionError.message}
          </p>
        ) : null}
        <DialogFooter>
          {canWrite && current?.status === "DRAFT" ? (
            <>
              {aiEnabled ? (
                <Button
                  variant="outline"
                  disabled={enrich.isPending}
                  onClick={() => {
                    enrich.mutate();
                  }}
                >
                  {enrich.isPending ? "Enriching…" : "Enrich with AI"}
                </Button>
              ) : null}
              <Button
                variant="outline"
                disabled={saveDraft.isPending}
                onClick={() => {
                  saveDraft.mutate();
                }}
              >
                Save changes
              </Button>
              <Button
                disabled={approve.isPending}
                onClick={() => {
                  approve.mutate();
                }}
              >
                {approve.isPending ? "Approving…" : "Approve strategy"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccessCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-fg-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => {
          onChange(value === true);
        }}
      />
      {label}
    </label>
  );
}
