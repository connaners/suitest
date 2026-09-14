import { Download, ExternalLink, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ImageLightboxProps {
  /** Full-resolution image URL (usually a presigned artifact URL). */
  src: string;
  /** Context shown in the header, e.g. "Step 2 — Screenshot". */
  title: string;
  /** The inline preview; rendered inside a zoom-in trigger button. */
  children: React.ReactNode;
}

/**
 * Full-resolution viewer for screenshots and image artifacts. Wraps an inline
 * preview; clicking it opens a dialog with fit/1:1 zoom, open-in-new-tab, and
 * download. Esc-to-close and focus trapping come from the Radix Dialog.
 */
export function ImageLightbox({ src, title, children }: ImageLightboxProps): React.ReactElement {
  const [actualSize, setActualSize] = useState(false);

  const toolButtonClass = "rounded p-1.5 text-fg-4 hover:bg-bg-elev-2 hover:text-fg-1";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setActualSize(false);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full cursor-zoom-in items-center justify-center"
          aria-label={`View ${title} full size`}
          data-testid="image-lightbox-trigger"
        >
          {children}
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[90vh] w-full max-w-7xl flex-col gap-3 border-border bg-bg-elev-1 p-4"
        aria-describedby={undefined}
        data-testid="image-lightbox"
      >
        <DialogHeader className="flex-row items-center gap-2">
          <DialogTitle className="truncate text-[13px] font-medium text-fg-1">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {`Full-resolution view of ${title}`}
          </DialogDescription>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setActualSize((v) => !v);
              }}
              aria-label={actualSize ? "Fit to window" : "View actual size"}
              data-testid="image-lightbox-zoom"
              className={toolButtonClass}
            >
              {actualSize ? (
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              aria-label="Open image in new tab"
              data-testid="image-lightbox-open-tab"
              className={toolButtonClass}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href={src}
              download
              aria-label="Download image"
              data-testid="image-lightbox-download"
              className={toolButtonClass}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </DialogHeader>
        <div
          className={
            actualSize
              ? "min-h-0 flex-1 overflow-auto rounded-md bg-bg-code"
              : "flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-bg-code"
          }
        >
          <img
            src={src}
            alt={title}
            data-testid="image-lightbox-image"
            onClick={() => {
              setActualSize((v) => !v);
            }}
            className={
              actualSize
                ? "max-w-none cursor-zoom-out"
                : "max-h-full max-w-full cursor-zoom-in object-contain"
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
