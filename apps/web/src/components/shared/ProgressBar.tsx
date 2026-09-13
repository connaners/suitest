import { cn } from "@/lib/utils";

export type ProgressBarVariant =
  | "default"
  | "warn"
  | "fail"
  | "pass"
  | "skip"
  | "error"
  | "running"
  | "neutral";

export interface ProgressBarSegment {
  /** Relative value or count. */
  value: number;
  variant: ProgressBarVariant;
  /** Optional accessible tooltip or label for this specific segment */
  label?: string;
  key?: string;
}

export interface ProgressBarProps {
  /** 0..100. Out-of-range values are clamped. Used for single-bar mode. */
  value?: number;
  variant?: ProgressBarVariant;
  /** Multi-segment mode for runner condition breakdowns (pass, fail, skip, error, running). */
  segments?: ProgressBarSegment[];
  /** Optional total value to normalize segments against (defaults to sum of segments or 100). */
  total?: number;
  /** Optional label shown above the track. */
  label?: string;
  className?: string;
}

const FILL_CLASSES: Record<ProgressBarVariant, string> = {
  default: "bg-accent",
  pass: "bg-accent",
  warn: "bg-amber",
  skip: "bg-amber",
  fail: "bg-red",
  error: "bg-red/80",
  running: "bg-blue suitest-pulse",
  neutral: "bg-fg-4",
};

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Slim progress track + animated fill (UI_SPEC § 4.5). Supports both single-value
 * metrics (e.g. coverage) and multi-segment runner status distributions
 * (pass, fail, skip, running, error).
 */
export function ProgressBar({
  value = 0,
  variant = "default",
  segments,
  total,
  label,
  className,
}: ProgressBarProps): React.ReactElement {
  if (segments && segments.length > 0) {
    const validSegments = segments.filter((s) => s.value > 0);
    const sumValues = validSegments.reduce((acc, s) => acc + s.value, 0);
    const divisor =
      total !== undefined && total > 0 ? total : sumValues > 0 ? sumValues : 100;
    const overallPct = clamp((sumValues / divisor) * 100);

    return (
      <div
        data-testid="progress-bar"
        data-variant="segmented"
        className={cn("flex flex-col gap-1", className)}
      >
        {label ? (
          <div className="flex items-center justify-between text-[11.5px] text-fg-3">
            <span>{label}</span>
            <span className="font-mono tabular-nums text-fg-4">{Math.round(overallPct)}%</span>
          </div>
        ) : null}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(overallPct)}
          aria-label={label ?? `Progress ${Math.round(overallPct).toString()}%`}
          className="flex h-1 w-full overflow-hidden rounded bg-bg-elev-3"
        >
          {validSegments.map((seg, idx) => {
            const segPct = Math.min(100, Math.max(0, (seg.value / divisor) * 100));
            return (
              <div
                key={seg.key ?? `${seg.variant}-${idx}`}
                data-testid="progress-bar-segment"
                data-variant={seg.variant}
                title={seg.label}
                aria-label={seg.label}
                className={cn(
                  "h-full transition-[width] duration-300",
                  FILL_CLASSES[seg.variant] ?? FILL_CLASSES.default,
                )}
                style={{ width: `${segPct}%` }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  const pct = clamp(value);
  return (
    <div
      data-testid="progress-bar"
      data-variant={variant}
      className={cn("flex flex-col gap-1", className)}
    >
      {label ? (
        <div className="flex items-center justify-between text-[11.5px] text-fg-3">
          <span>{label}</span>
          <span className="font-mono tabular-nums text-fg-4">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label ?? `Progress ${Math.round(pct).toString()}%`}
        className="h-1 w-full overflow-hidden rounded bg-bg-elev-3"
      >
        <div
          data-testid="progress-bar-fill"
          className={cn("h-full rounded transition-[width] duration-300", FILL_CLASSES[variant])}
          style={{ width: `${pct.toString()}%` }}
        />
      </div>
    </div>
  );
}

