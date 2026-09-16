import * as React from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Maximize2, Minimize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface LightboxImage {
  src: string;
  alt?: string | undefined;
  title?: string | undefined;
  subtitle?: string | null | undefined;
  downloadFilename?: string | undefined;
}

export interface ImageLightboxModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src?: string | null | undefined;
  alt?: string | undefined;
  title?: string | undefined;
  subtitle?: string | null | undefined;
  downloadFilename?: string | undefined;
  images?: LightboxImage[] | undefined;
  currentIndex?: number | undefined;
  onNavigate?: ((index: number) => void) | undefined;
}

export function ImageLightboxModal({
  open,
  onOpenChange,
  src,
  alt = "Screenshot preview",
  title = "Screenshot Preview",
  subtitle,
  downloadFilename,
  images,
  currentIndex,
  onNavigate,
}: ImageLightboxModalProps): React.ReactElement | null {
  const [isActualSize, setIsActualSize] = React.useState(false);

  const hasMultipleImages = Boolean(images && images.length > 1);
  const activeIndex =
    images && images.length > 0
      ? Math.max(0, Math.min(currentIndex ?? 0, images.length - 1))
      : 0;

  const currentItem: LightboxImage | null =
    images && images[activeIndex]
      ? images[activeIndex]
      : src
        ? { src, alt, title, subtitle, downloadFilename }
        : null;

  const activeSrc = currentItem?.src ?? "";
  const activeTitle = currentItem?.title ?? title;
  const activeSubtitle = currentItem?.subtitle ?? subtitle;
  const activeAlt = currentItem?.alt ?? alt;
  const activeDownloadFilename = currentItem?.downloadFilename ?? downloadFilename;

  // Reset zoom mode whenever the modal opens/closes or active image changes
  React.useEffect(() => {
    if (!open) {
      setIsActualSize(false);
    }
  }, [open, activeSrc]);

  const handlePrev = React.useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!images || images.length <= 1) return;
      const prevIndex = activeIndex > 0 ? activeIndex - 1 : images.length - 1;
      onNavigate?.(prevIndex);
    },
    [images, activeIndex, onNavigate],
  );

  const handleNext = React.useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!images || images.length <= 1) return;
      const nextIndex = activeIndex < images.length - 1 ? activeIndex + 1 : 0;
      onNavigate?.(nextIndex);
    },
    [images, activeIndex, onNavigate],
  );

  // Keyboard navigation: ArrowLeft (prev), ArrowRight (next)
  React.useEffect(() => {
    if (!open || !hasMultipleImages) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, hasMultipleImages, handlePrev, handleNext]);

  if (!activeSrc) {
    return null;
  }

  const computedFilename =
    activeDownloadFilename ||
    (activeTitle
      ? `${activeTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`
      : "screenshot.png");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="image-lightbox-modal"
        className="flex h-[88vh] max-h-[92vh] w-[95vw] sm:max-w-6xl flex-col gap-0 overflow-hidden border border-border bg-bg-elev-1 p-0 shadow-2xl"
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-0.5 pr-4 text-left min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate text-[14px] font-semibold text-fg-1">
                {activeTitle}
              </DialogTitle>
              {hasMultipleImages && images ? (
                <span
                  className="shrink-0 rounded-full bg-bg-elev-2 px-2 py-0.5 font-mono text-[11px] text-fg-3 border border-border"
                  data-testid="lightbox-image-counter"
                >
                  {activeIndex + 1} / {images.length}
                </span>
              ) : null}
            </div>
            <DialogDescription
              className={
                activeSubtitle
                  ? "font-mono text-[11.5px] text-fg-4 truncate"
                  : "sr-only"
              }
            >
              {activeSubtitle ?? "Full-resolution screenshot viewer"}
            </DialogDescription>
          </div>

          <div className="mr-6 flex items-center gap-1.5 sm:mr-8 shrink-0">
            {hasMultipleImages ? (
              <div className="flex items-center gap-1 mr-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePrev}
                  data-testid="lightbox-prev-btn"
                  aria-label="Previous image (Left arrow)"
                  title="Previous image (Left arrow)"
                  className="h-7 px-2 text-xs"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleNext}
                  data-testid="lightbox-next-btn"
                  aria-label="Next image (Right arrow)"
                  title="Next image (Right arrow)"
                  className="h-7 px-2 text-xs"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setIsActualSize((prev) => !prev);
              }}
              data-testid="lightbox-zoom-toggle"
              aria-label={isActualSize ? "Fit to window" : "View 1:1 actual size"}
              title={isActualSize ? "Fit to window" : "View 1:1 actual size"}
              className="h-7 text-xs font-normal"
            >
              {isActualSize ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Fit</span>
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">1:1 Size</span>
                </>
              )}
            </Button>

            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-7 text-xs font-normal"
            >
              <a
                href={activeSrc}
                target="_blank"
                rel="noreferrer noopener"
                data-testid="lightbox-open-tab"
                aria-label="Open image in new tab"
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
                href={activeSrc}
                download={computedFilename}
                data-testid="lightbox-download"
                aria-label="Download image"
                title="Download image"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
          </div>
        </DialogHeader>

        <div
          data-testid="lightbox-viewport"
          onClick={() => setIsActualSize((prev) => !prev)}
          className={cn(
            "group relative flex flex-1 select-none overflow-auto bg-bg-code p-4",
            isActualSize
              ? "cursor-zoom-out items-start justify-start"
              : "cursor-zoom-in items-center justify-center"
          )}
        >
          {hasMultipleImages ? (
            <>
              <button
                type="button"
                onClick={handlePrev}
                data-testid="lightbox-floating-prev"
                aria-label="Previous image"
                className="absolute left-4 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border/80 bg-bg-elev-1/90 text-fg-2 shadow-lg backdrop-blur hover:bg-bg-elev-2 hover:text-fg-1 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                data-testid="lightbox-floating-next"
                aria-label="Next image"
                className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border/80 bg-bg-elev-1/90 text-fg-2 shadow-lg backdrop-blur hover:bg-bg-elev-2 hover:text-fg-1 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : null}

          <img
            src={activeSrc}
            alt={activeAlt}
            data-testid="lightbox-image"
            className={cn(
              "transition-all duration-150",
              isActualSize
                ? "m-auto max-h-none max-w-none shadow-md"
                : "max-h-full max-w-full rounded object-contain shadow-sm"
            )}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
