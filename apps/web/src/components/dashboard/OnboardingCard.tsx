import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";

import { api } from "@/lib/api-client";
import { useActiveProject } from "@/stores/use-active-project";
import { useActiveWorkspace } from "@/stores/use-active-workspace";

/**
 * First-run checklist for a new workspace: project → case → run → API key.
 * Rendered at the top of the Dashboard until every step is done or the user
 * dismisses it (persisted in localStorage, same bare-storage pattern as
 * `lib/theme.ts`). All state is derived client-side from cheap `limit=1`
 * list queries — no backend changes required.
 */

const DISMISS_KEY = "suitest.onboardingDismissed";

function isDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(DISMISS_KEY) === "1";
}

interface OnboardingStep {
  key: string;
  title: string;
  hint: string;
  done: boolean;
  to: string;
  search?: { tab?: string };
  action: string;
}

/** Numbered marker for a not-yet-done step. */
function StepNumber({ n }: { n: number }): React.ReactElement {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg-elev-2 font-mono text-[11px] text-fg-3">
      {n.toString()}
    </span>
  );
}

export function OnboardingCard(): React.ReactElement | null {
  const projectId = useActiveProject((s) => s.projectId);
  const workspaceId = useActiveWorkspace((s) => s.workspaceId);
  const [dismissed, setDismissed] = useState(isDismissed);

  // `limit=1` keeps these cheap: we only need "does one exist".
  const casesQuery = useQuery({
    queryKey: ["onboarding", "cases", projectId] as const,
    queryFn: async () => {
      const res = await api.get<{ items: unknown[] }>("/test-cases", {
        params: { projectId, limit: 1 },
      });
      return res.data.items.length;
    },
    enabled: projectId !== null,
  });
  const runsQuery = useQuery({
    queryKey: ["onboarding", "runs", projectId] as const,
    queryFn: async () => {
      const res = await api.get<{ items: unknown[] }>("/runs", {
        params: { projectId, limit: 1 },
      });
      return res.data.items.length;
    },
    enabled: projectId !== null,
  });
  const keysQuery = useQuery({
    queryKey: ["onboarding", "api-keys", workspaceId] as const,
    queryFn: async () => {
      const res = await api.get<{ items: unknown[] }>(`/workspaces/${workspaceId}/api-keys`);
      return res.data.items.length;
    },
    enabled: workspaceId !== null,
  });

  const steps: OnboardingStep[] = [
    {
      key: "project",
      title: "Create a project",
      hint: "Projects group your suites, cases, and runs.",
      // The card only renders once a project exists (the dashboard swaps to
      // the first-project bootstrap otherwise), so this step starts done.
      done: projectId !== null,
      to: "/cases",
      action: "New project",
    },
    {
      key: "case",
      title: "Author a test case",
      hint: "Manual steps now; AI generation when you add an LLM.",
      done: (casesQuery.data ?? 0) > 0,
      to: "/cases",
      action: "Go to cases",
    },
    {
      key: "run",
      title: "Run your first test",
      hint: "Deterministic MCP execution — no LLM required.",
      done: (runsQuery.data ?? 0) > 0,
      to: "/cases",
      action: "Open cases",
    },
    {
      key: "apikey",
      title: "Create an API key",
      hint: "Connect the MCP server, CLI, or CI to this workspace.",
      done: (keysQuery.data ?? 0) > 0,
      to: "/settings",
      search: { tab: "api-keys" },
      action: "Open settings",
    },
  ];

  if (dismissed || steps.every((s) => s.done)) return null;

  const dismiss = (): void => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DISMISS_KEY, "1");
    }
    setDismissed(true);
  };

  return (
    <section
      data-testid="onboarding-card"
      className="rounded-md border border-border bg-bg-elev-1 p-[14px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold tracking-[-.01em] text-fg-1">Get started</h2>
          <p className="text-[12.5px] text-fg-3">
            Four steps to your first green run. This guide disappears when you are done.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss onboarding"
          data-testid="onboarding-dismiss"
          onClick={dismiss}
          className="rounded-md p-1.5 text-fg-4 hover:bg-bg-elev-2 hover:text-fg-1"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <ol className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
        {steps.map((step, idx) => (
          <li
            key={step.key}
            data-testid={`onboarding-step-${step.key}`}
            className="flex items-center gap-3 rounded-md px-1.5 py-1.5 hover:bg-bg-elev-2"
          >
            {step.done ? (
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ) : (
              <StepNumber n={idx + 1} />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={`text-[13px] font-medium ${step.done ? "text-fg-4 line-through" : "text-fg-1"}`}
              >
                {step.title}
              </p>
              <p className="truncate text-[11.5px] text-fg-4">{step.hint}</p>
            </div>
            {step.done ? null : (
              <Link
                to={step.to}
                search={step.search ?? {}}
                className="shrink-0 rounded-md border border-border bg-bg-elev-1 px-2.5 py-1 text-[12px] font-medium text-fg-2 hover:bg-bg-elev-2 hover:text-fg-1"
                data-testid={`onboarding-action-${step.key}`}
              >
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
