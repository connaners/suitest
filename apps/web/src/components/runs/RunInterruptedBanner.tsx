import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";

interface RunInterruptedBannerProps {
  status?: string | undefined;
  errorMessage?: string | null | undefined;
}

export function RunInterruptedBanner({
  status,
  errorMessage,
}: RunInterruptedBannerProps): ReactElement | null {
  if (status !== "ERROR" && !errorMessage) return null;

  return (
    <div
      role="alert"
      data-testid="run-interrupted-banner"
      className="flex items-start gap-2.5 rounded-md border border-red/30 bg-red/10 px-3 py-2.5 text-[12px] text-red"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">Run was interrupted or failed</span>
        <span className="font-mono text-[11px] text-red/90">
          {errorMessage ||
            "The run worker was interrupted or lost connection during processing. You can re-run the test cases above."}
        </span>
      </div>
    </div>
  );
}
