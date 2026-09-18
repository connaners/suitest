import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { testLlmConfig } from "@/lib/api-client";
import { providerLabel } from "@/lib/llm-vendors";
import { cn } from "@/lib/utils";
import { useActiveWorkspace } from "@/stores/use-active-workspace";
import { useCapabilities, type LlmStatus } from "@/stores/use-capabilities";

function useOptionalQueryClient() {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

const STATUS_TONE: Record<LlmStatus, string> = {
  not_configured: "bg-bg-elev-2 text-fg-3 border-border",
  validation_required: "bg-amber/10 text-amber border-amber/20",
  ready: "bg-accent/10 text-accent border-accent/20",
};

const STATUS_LABEL: Record<LlmStatus, string> = {
  not_configured: "LLM not connected",
  validation_required: "LLM validation required",
  ready: "LLM ready",
};

export function LlmStatusBadge(): React.ReactElement {
  const queryClient = useOptionalQueryClient();
  const capabilities = useCapabilities((state) => state.capabilities);
  const workspaceId = useActiveWorkspace((state) => state.workspaceId);
  const status = capabilities?.llm?.status ?? "not_configured";
  const provider = capabilities?.llm?.provider ?? null;
  const model = capabilities?.llm?.model ?? null;
  const providerName = provider ? providerLabel(provider) : null;
  const providerModel = providerName && model ? `${providerName}:${model}` : providerName;
  const label = status === "ready" && providerModel ? providerModel : STATUS_LABEL[status];

  const [isTesting, setIsTesting] = useState(false);
  const [testResultMsg, setTestResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleQuickTest = async () => {
    if (!workspaceId) return;
    setIsTesting(true);
    setTestResultMsg(null);
    try {
      const res = await testLlmConfig(workspaceId);
      if (res.ok) {
        setTestResultMsg({ ok: true, text: `Verified (${res.latencyMs}ms)` });
        if (queryClient) {
          await queryClient.invalidateQueries({
            queryKey: ["workspace", workspaceId, "llm-config"],
          });
          await queryClient.invalidateQueries({ queryKey: ["capabilities"] });
        }
        await useCapabilities.getState().fetch();
      } else {
        setTestResultMsg({
          ok: false,
          text: `Failed: ${res.error?.code ?? "ERROR"} — ${res.error?.message ?? "Check upstream server"}`,
        });
      }
    } catch (err: unknown) {
      setTestResultMsg({
        ok: false,
        text: (err as Error).message || "Connection test failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="llm-status-badge"
          data-llm-status={status}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium transition-colors hover:brightness-110",
            STATUS_TONE[status],
          )}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 border-border bg-bg-elev-1 p-3.5 shadow-lg"
        data-testid="llm-status-badge-popover"
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-fg-5 font-semibold">
              LLM status
            </span>
            <span
              className={cn(
                "rounded border px-1.5 py-0.2 font-mono text-[10.5px] font-medium",
                STATUS_TONE[status],
              )}
            >
              {status.replaceAll("_", " ")}
            </span>
          </div>

          <div className="text-[13px] font-semibold text-fg-1">{STATUS_LABEL[status]}</div>

          {status === "validation_required" ? (
            <div className="rounded border border-amber/30 bg-amber/10 p-2 text-[12px] text-fg-2">
              <p className="font-semibold text-amber">Connection not verified</p>
              <p className="mt-0.5 text-[11.5px] text-fg-3 leading-relaxed">
                Assistant Chat and AI tools are locked until connection is verified.
              </p>
            </div>
          ) : status === "not_configured" ? (
            <p className="text-[12px] text-fg-3 leading-relaxed">
              No LLM configured. Set up a provider in Settings to unlock the Assistant and automated
              testing agents.
            </p>
          ) : (
            <p className="text-[12px] text-fg-3 leading-relaxed">
              LLM is active and verified. All AI capabilities are ready.
            </p>
          )}

          {provider || model ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border/50 pt-2 text-[12.5px]">
              <dt className="text-fg-4">Provider</dt>
              <dd className="font-mono text-fg-1">{providerLabel(provider)}</dd>
              <dt className="text-fg-4">Model</dt>
              <dd className="font-mono text-fg-1">{model ?? "—"}</dd>
            </dl>
          ) : null}

          <div className="flex items-center justify-between border-t border-border/50 pt-2">
            {status === "validation_required" && workspaceId ? (
              <button
                type="button"
                onClick={() => void handleQuickTest()}
                disabled={isTesting}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-amber px-2.5 text-[11.5px] font-semibold text-black hover:bg-amber/90 disabled:opacity-60 transition-opacity"
                data-testid="llm-popover-test-btn"
              >
                {isTesting ? "Testing…" : "⚡ Test Connection"}
              </button>
            ) : null}

            <a
              href="/settings"
              className="ml-auto text-[12px] font-medium text-accent hover:underline"
            >
              {status === "ready" ? "Configure →" : "Open Settings →"}
            </a>
          </div>

          {testResultMsg ? (
            <div
              className={cn(
                "rounded p-2 text-[11.5px] font-medium",
                testResultMsg.ok
                  ? "border border-accent/30 bg-accent/10 text-accent"
                  : "border border-red/30 bg-red/10 text-red",
              )}
              data-testid="llm-popover-test-result"
            >
              {testResultMsg.text}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
