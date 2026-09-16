import { Camera, CameraOff, Maximize2, X } from "lucide-react";
import { useState } from "react";

import type { PlaywrightConfigInput } from "@/hooks/use-runs";
import { ImageLightboxModal } from "./ImageLightboxModal";

interface BrowserPreviewProps {
  url: string | null;
  /** Presigned URL of the run's VIDEO artifact, if any (Phase 2). */
  videoUrl?: string | null;
  /** Generated test source for the Code tab (Phase 2 lifecycle ingest). */
  code?: string | null;
  /** Presigned screenshot URL for the step the user clicked (per-step preview). */
  stepScreenshotUrl?: string | null;
  /** Label of the selected step, e.g. "Step 3". */
  stepLabel?: string | null;
  /** Clear the selected step and return to the run video. */
  onClearStep?: () => void;
  /** Execution settings from run metadata (if media was disabled). */
  playwrightConfig?: PlaywrightConfigInput | null | undefined;
}

type Tab = "preview" | "code";

/**
 * Run preview pane. Two tabs (TestSprite-style):
 *  - **Preview**: plays the run VIDEO when present, else the latest SCREENSHOT.
 *  - **Code**: the persisted generated test source (read-only).
 * The parent route resolves the presigned URLs + code and feeds them in.
 */
export function BrowserPreview({
  url,
  videoUrl,
  code,
  stepScreenshotUrl,
  stepLabel,
  onClearStep,
  playwrightConfig,
}: BrowserPreviewProps): React.ReactElement {
  const [tab, setTab] = useState<Tab>("preview");
  const [lightboxImage, setLightboxImage] = useState<{ src: string; title?: string } | null>(null);
  const hasCode = Boolean(code);
  const showStep = Boolean(stepScreenshotUrl);

  return (
    <div
      className="flex flex-col rounded-md border border-border bg-bg-elev-1 p-3"
      data-testid="browser-preview"
    >
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setTab("preview")}
          className={`rounded-md px-2 py-0.5 text-[12px] ${
            tab === "preview" ? "bg-bg-elev-2 text-fg-1" : "text-fg-4 hover:text-fg-1"
          }`}
          data-testid="preview-tab"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setTab("code")}
          disabled={!hasCode}
          className={`rounded-md px-2 py-0.5 text-[12px] ${
            tab === "code" ? "bg-bg-elev-2 text-fg-1" : "text-fg-4 hover:text-fg-1"
          } disabled:opacity-40`}
          data-testid="code-tab"
        >
          Code
        </button>
        <span className="ml-auto flex items-center gap-1.5 truncate text-right font-mono text-[11px] text-fg-4">
          {tab === "preview"
            ? showStep
              ? `Preview: ${stepLabel ?? "step"}`
              : videoUrl
                ? "video"
                : "screenshot"
            : "test source"}
          {tab === "preview" && showStep && onClearStep ? (
            <button
              type="button"
              onClick={onClearStep}
              aria-label="Back to run video"
              data-testid="preview-clear-step"
              className="rounded p-0.5 text-fg-4 hover:bg-bg-elev-2 hover:text-fg-1"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </div>

      {tab === "preview" ? (
        <div className="mt-3 flex h-[280px] items-center justify-center overflow-hidden rounded-md bg-bg-code text-[12px] text-fg-5">
          {showStep && stepScreenshotUrl ? (
            <button
              type="button"
              onClick={() =>
                setLightboxImage({
                  src: stepScreenshotUrl,
                  title: stepLabel ? `${stepLabel} screenshot` : "Step screenshot",
                })
              }
              className="group relative flex h-full w-full items-center justify-center cursor-zoom-in focus:outline-none"
              aria-label="Zoom step screenshot"
              data-testid="browser-preview-zoom-step-trigger"
            >
              <img
                src={stepScreenshotUrl}
                alt={stepLabel ? `${stepLabel} screenshot` : "Step screenshot"}
                data-testid="browser-preview-step-image"
                className="max-h-full max-w-full object-contain transition-transform group-hover:scale-[1.01]"
              />
              <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-bg-root/80 px-2 py-0.5 text-[11px] text-fg-2 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                <Maximize2 className="h-3 w-3" aria-hidden="true" />
                Click to expand
              </span>
            </button>
          ) : videoUrl ? (
            <video
              src={videoUrl}
              controls
              data-testid="browser-preview-video"
              className="max-h-full max-w-full"
            />
          ) : url ? (
            <button
              type="button"
              onClick={() =>
                setLightboxImage({
                  src: url,
                  title: "Latest run screenshot",
                })
              }
              className="group relative flex h-full w-full items-center justify-center cursor-zoom-in focus:outline-none"
              aria-label="Zoom latest run screenshot"
              data-testid="browser-preview-zoom-run-trigger"
            >
              <img
                src={url}
                alt="Latest run screenshot"
                data-testid="browser-preview-image"
                className="max-h-full max-w-full object-contain transition-transform group-hover:scale-[1.01]"
              />
              <span className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-bg-root/80 px-2 py-0.5 text-[11px] text-fg-2 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                <Maximize2 className="h-3 w-3" aria-hidden="true" />
                Click to expand
              </span>
            </button>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-1.5 p-4 text-center"
              data-testid="browser-preview-placeholder"
            >
              {playwrightConfig &&
              (playwrightConfig.screenshot === "off" || playwrightConfig.video === "off") ? (
                <>
                  <CameraOff className="h-5 w-5 text-fg-4/70" />
                  <span className="font-medium text-[12px] text-fg-3">No preview available</span>
                  <span className="text-[11px] text-fg-4 max-w-xs">
                    Screenshots and video recording were disabled in Execution Settings.
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-2">
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  Preview
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <pre
          className="mt-3 h-[280px] overflow-auto rounded-md bg-bg-code p-3 font-mono text-[11.5px] leading-relaxed text-fg-3"
          data-testid="browser-preview-code"
        >
          {code ?? "No generated source."}
        </pre>
      )}

      <ImageLightboxModal
        open={lightboxImage !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setLightboxImage(null);
          }
        }}
        src={lightboxImage?.src ?? ""}
        title={lightboxImage?.title}
      />
    </div>
  );
}
