import { Camera, ChevronDown, ChevronRight, Eye, Info, RotateCcw, Settings2, Sparkles, Video, Zap } from "lucide-react";
import * as React from "react";

import { type ExecutionSettings, type VideoQuality } from "./execution-settings";
import { cn } from "@/lib/utils";

export interface ExecutionSettingsPanelProps {
  value: ExecutionSettings;
  onChange: (value: ExecutionSettings) => void;
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * Reusable execution settings panel for test runs and re-runs.
 *
 * Configures headless mode, screenshot capture, video recording, and DOM element highlighting.
 * Collapsed by default for zero friction; displays a summary badge when collapsed.
 */
export function ExecutionSettingsPanel({
  value,
  onChange,
  defaultExpanded = false,
  className,
}: ExecutionSettingsPanelProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  const isNoMedia = value.screenshot === "off" && value.video === "off";
  const screenshotSummary = isNoMedia
    ? "No media (Fastest)"
    : value.screenshot === "on"
      ? "Every step"
      : value.screenshot === "only-on-failure"
        ? "Failure only"
        : "No screenshots";

  const videoSummary =
    value.video === "on"
      ? `Video: ${value.videoQuality ?? "720p"}`
      : value.video === "retain-on-failure"
        ? `Video: on fail (${value.videoQuality ?? "720p"})`
        : null;

  const modeSummary = value.headless ? "Headless" : "Headed";

  return (
    <div
      className={cn("rounded-md border border-border bg-bg-elev-1 text-[12px]", className)}
      data-testid="execution-settings-container"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-bg-elev-2/50"
        data-testid="toggle-execution-settings"
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-1.5 font-medium text-fg-1">
          <Settings2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          Execution Settings
        </span>
        <div className="flex items-center gap-2">
          {!isExpanded ? (
            <span
              className="text-[11px] text-fg-4 font-mono"
              data-testid="execution-settings-summary"
            >
              {modeSummary} • {screenshotSummary}
              {videoSummary ? ` • ${videoSummary}` : ""}
              {value.highlightSteps ? " • Highlight" : ""}
            </span>
          ) : null}

          <span className="text-[11px] font-medium text-accent hover:underline">
            {isExpanded ? "Hide" : "Customize"}
          </span>
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-fg-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-fg-4" aria-hidden="true" />
          )}
        </div>
      </button>

      {isExpanded ? (
        <div
          className="flex flex-col gap-3 border-t border-border p-3 pt-2.5"
          data-testid="execution-settings-panel"
        >
          {/* Screenshot capture */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col">
              <label
                htmlFor="cfg-screenshot"
                className="flex items-center gap-1.5 font-medium text-fg-2"
              >
                <Camera className="h-3.5 w-3.5 text-fg-4" aria-hidden="true" />
                Screenshot capture
              </label>
              <span className="text-[11px] text-fg-4">
                Capture screenshots for Lightbox Viewer inspection.
              </span>
            </div>
            <select
              id="cfg-screenshot"
              value={value.screenshot}
              onChange={(e) =>
                onChange({
                  ...value,
                  screenshot: e.target.value as "off" | "only-on-failure" | "on",
                })
              }
              data-testid="config-screenshot-select"
              className="h-7 rounded border border-border bg-bg-root px-2 text-[11.5px] text-fg-1 focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="only-on-failure">On failure only (Recommended)</option>
              <option value="on">Every step (Full capture)</option>
              <option value="off">Off</option>
            </select>
          </div>

          {/* Video recording */}
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-t border-border/50 pt-2.5">
            <div className="flex flex-col">
              <label
                htmlFor="cfg-video"
                className="flex items-center gap-1.5 font-medium text-fg-2"
              >
                <Video className="h-3.5 w-3.5 text-fg-4" aria-hidden="true" />
                Video recording
              </label>
              <span className="text-[11px] text-fg-4">
                Record web browser session video artifact.
              </span>
            </div>
            <select
              id="cfg-video"
              value={value.video}
              onChange={(e) =>
                onChange({
                  ...value,
                  video: e.target.value as "off" | "retain-on-failure" | "on",
                })
              }
              data-testid="config-video-select"
              className="h-7 rounded border border-border bg-bg-root px-2 text-[11.5px] text-fg-1 focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="off">Off</option>
              <option value="retain-on-failure">Retain on failure</option>
              <option value="on">Always record</option>
            </select>
          </div>

          {/* Video quality / resolution */}
          {value.video !== "off" ? (
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-t border-border/30 bg-bg-elev-2/30 px-2 py-1.5 rounded">
              <div className="flex flex-col">
                <label
                  htmlFor="cfg-video-quality"
                  className="font-medium text-fg-2 text-[11px]"
                >
                  Video quality / resolution
                </label>
                <span className="text-[10.5px] text-fg-4">
                  Output resolution for recorded .webm session.
                </span>
              </div>
              <select
                id="cfg-video-quality"
                value={value.videoQuality ?? "720p"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    videoQuality: e.target.value as VideoQuality,
                  })
                }
                data-testid="config-video-quality-select"
                className="h-6.5 rounded border border-border bg-bg-root px-2 text-[11px] text-fg-1 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="360p">360p (Low bandwidth)</option>
                <option value="480p">480p (Standard definition)</option>
                <option value="720p">720p (HD - Recommended)</option>
                <option value="1080p">1080p (Full HD)</option>
              </select>
            </div>
          ) : null}

          {/* Headless mode */}
          <div className="flex items-start justify-between border-t border-border/50 pt-2.5">
            <div className="flex flex-col pr-2">
              <label
                htmlFor="cfg-headless"
                className="flex cursor-pointer items-center gap-1.5 font-medium text-fg-2"
              >
                <Eye className="h-3.5 w-3.5 text-fg-4" aria-hidden="true" />
                Headless mode
              </label>
              <span className="text-[11px] text-fg-4">
                Run browser in background. Toggle OFF to watch actions live on screen.
              </span>
            </div>
            <input
              id="cfg-headless"
              type="checkbox"
              checked={value.headless}
              onChange={(e) => onChange({ ...value, headless: e.target.checked })}
              data-testid="config-headless-toggle"
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-accent"
            />
          </div>

          {/* Headed mode auto-close & session cleanup option */}
          {!value.headless ? (
            <div className="flex items-start justify-between border-t border-border/40 bg-accent/5 p-2 rounded border-l-2 border-l-accent">
              <div className="flex flex-col pr-2">
                <label
                  htmlFor="cfg-clean-session"
                  className="flex cursor-pointer items-center gap-1.5 font-medium text-fg-1 text-[11.5px]"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  Auto-close browser & clean session between cases
                </label>
                <span className="text-[11px] text-fg-4 leading-tight mt-0.5">
                  Automatically closes the browser window and clears cookies/localStorage before starting the next test case to prevent window clutter and state leakage.
                </span>
              </div>
              <input
                id="cfg-clean-session"
                type="checkbox"
                checked={value.cleanSessionBetweenCases}
                onChange={(e) =>
                  onChange({ ...value, cleanSessionBetweenCases: e.target.checked })
                }
                data-testid="config-clean-session-toggle"
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-accent"
              />
            </div>
          ) : null}

          {/* Highlight elements */}
          <div className="flex flex-col border-t border-border/50 pt-2.5">
            <div className="flex items-start justify-between">
              <div className="flex flex-col pr-2">
                <label
                  htmlFor="cfg-highlight"
                  className="flex cursor-pointer items-center gap-1.5 font-medium text-fg-2"
                >
                  <Sparkles className="h-3.5 w-3.5 text-fg-4" aria-hidden="true" />
                  Highlight element per step
                </label>
                <span className="text-[11px] text-fg-4">
                  Visually outlines the target element before executing step actions.
                </span>
              </div>
              <input
                id="cfg-highlight"
                type="checkbox"
                checked={value.highlightSteps}
                onChange={(e) => onChange({ ...value, highlightSteps: e.target.checked })}
                data-testid="config-highlight-toggle"
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-accent"
              />
            </div>
            {value.headless && value.screenshot === "off" && value.video === "off" && value.highlightSteps ? (
              <div
                className="mt-2 flex items-start gap-1.5 rounded border border-border/60 bg-bg-elev-2/60 p-2 text-[11px] text-fg-4 leading-normal"
                data-testid="highlight-no-media-note"
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                <span>
                  <strong>Live visual only:</strong> Highlights occur inside the browser. Because Headless is on and screenshots/video are off, no visual evidence will be recorded in artifacts. To see highlights live, turn off Headless (headed mode) or enable Screenshots/Video.
                </span>
              </div>
            ) : null}
          </div>

          {/* Sleep Prevention */}
          <div className="flex flex-col border-t border-border/50 pt-2.5">
            <div className="flex items-start justify-between">
              <div className="flex flex-col pr-2">
                <label
                  htmlFor="cfg-prevent-sleep"
                  className="flex cursor-pointer items-center gap-1.5 font-medium text-fg-2"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  Keep system awake during run
                </label>
                <span className="text-[11px] text-fg-4">
                  Inhibits OS sleep on the machine running the runner (not your browser) while test cases execute. No effect in docker/server deployments.
                </span>
              </div>
              <input
                id="cfg-prevent-sleep"
                type="checkbox"
                checked={value.preventSleep}
                onChange={(e) => onChange({ ...value, preventSleep: e.target.checked })}
                data-testid="config-prevent-sleep-toggle"
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-accent"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
