import * as React from "react";
import { Download, ExternalLink, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface VideoPlayerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src?: string | null | undefined;
  title?: string | undefined;
  subtitle?: string | null | undefined;
  downloadFilename?: string | undefined;
}

export function VideoPlayerModal({
  open,
  onOpenChange,
  src,
  title = "Run Video Recording",
  subtitle,
  downloadFilename,
}: VideoPlayerModalProps): React.ReactElement | null {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  // Pause playback when modal is closed
  React.useEffect(() => {
    if (!open && videoRef.current) {
      videoRef.current.pause();
    }
  }, [open]);

  if (!src) {
    return null;
  }

  const computedFilename =
    downloadFilename ||
    (title
      ? `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.webm`
      : "recording.webm");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="video-player-modal"
        className="flex h-[88vh] max-h-[92vh] w-[95vw] sm:max-w-6xl flex-col gap-0 overflow-hidden border border-border bg-bg-elev-1 p-0 shadow-2xl"
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-0.5 pr-4 text-left min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-accent shrink-0" aria-hidden="true" />
              <DialogTitle className="truncate text-[14px] font-semibold text-fg-1">
                {title}
              </DialogTitle>
            </div>
            <DialogDescription
              className={
                subtitle ? "font-mono text-[11.5px] text-fg-4 truncate" : "sr-only"
              }
            >
              {subtitle ?? "Browser session recording"}
            </DialogDescription>
          </div>

          <div className="mr-6 flex items-center gap-1.5 sm:mr-8 shrink-0">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-7 text-xs font-normal"
            >
              <a
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                data-testid="video-modal-open-tab"
                aria-label="Open video in new tab"
                title="Open in new tab"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Open tab</span>
              </a>
            </Button>

            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-7 text-xs font-normal"
            >
              <a
                href={src}
                download={computedFilename}
                data-testid="video-modal-download"
                aria-label="Download video (.webm)"
                title="Download video"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
          </div>
        </DialogHeader>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-bg-code p-4">
          <video
            ref={videoRef}
            src={src}
            controls
            autoPlay
            playsInline
            data-testid="video-modal-player"
            className="max-h-full max-w-full rounded-md shadow-lg"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
