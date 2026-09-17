import { Zap } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface WakeLockIndicatorProps {
  /** True when the run is currently actively running / executing */
  isLive: boolean;
  className?: string;
  /** Whether sleep prevention was enabled for this run (defaults to true) */
  preventSleep?: boolean;
}

/**
 * Visual indicator that sleep inhibition / wake-lock is active.
 *
 * In addition to the backend OS sleep inhibitor (caffeinate/kernel32/systemd),
 * this component requests a browser Screen Wake Lock when supported, keeping
 * the display and browser active while watching live test execution.
 */
export function WakeLockIndicator({
  isLive,
  className,
  preventSleep = true,
}: WakeLockIndicatorProps): React.ReactElement | null {
  const [hasScreenLock, setHasScreenLock] = React.useState(false);

  React.useEffect(() => {
    if (!isLive || preventSleep === false) {
      setHasScreenLock(false);
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    async function acquireLock() {
      if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
        try {
          sentinel = await navigator.wakeLock.request("screen");
          if (!released) {
            setHasScreenLock(true);
          } else {
            void sentinel.release();
          }
          sentinel.addEventListener("release", () => {
            if (!released) {
              setHasScreenLock(false);
            }
          });
        } catch {
          // Fail open gracefully (e.g. low battery mode or permission denied)
          setHasScreenLock(false);
        }
      }
    }

    void acquireLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isLive) {
        void acquireLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sentinel) {
        void sentinel.release().catch(() => {});
      }
    };
  }, [isLive, preventSleep]);

  if (!isLive || preventSleep === false) return null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-500 transition-all select-none",
        className,
      )}
      data-testid="wake-lock-indicator"
      title={
        hasScreenLock
          ? "System sleep and display sleep are actively prevented while tests are running. Normal power settings resume automatically when the run completes."
          : "System sleep is actively prevented while tests are running. Normal power settings resume automatically when the run completes."
      }
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      <Zap className="h-3 w-3 fill-amber-500 text-amber-500" aria-hidden="true" />
      <span>Sleep Prevented</span>
    </div>
  );
}
