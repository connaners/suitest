import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ImageLightbox } from "@/components/runs/ImageLightbox";

const SRC = "https://example.com/signed/step-2.png";

function renderLightbox() {
  render(
    <ImageLightbox src={SRC} title="Step 2 — Screenshot">
      <img src={SRC} alt="Step 2 screenshot" data-testid="inline-preview" />
    </ImageLightbox>,
  );
}

describe("<ImageLightbox>", () => {
  it("opens the full-resolution view when the inline preview is clicked", async () => {
    const user = userEvent.setup();
    renderLightbox();

    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("inline-preview"));

    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();
    expect(screen.getByTestId("image-lightbox-image")).toHaveAttribute("src", SRC);
    expect(screen.getByText("Step 2 — Screenshot")).toBeInTheDocument();
  });

  it("toggles between fit-to-window and actual pixel size", async () => {
    const user = userEvent.setup();
    renderLightbox();
    await user.click(screen.getByTestId("inline-preview"));

    const image = screen.getByTestId("image-lightbox-image");
    expect(image.className).toContain("object-contain");

    await user.click(screen.getByTestId("image-lightbox-zoom"));
    expect(image.className).toContain("max-w-none");

    await user.click(screen.getByTestId("image-lightbox-zoom"));
    expect(image.className).toContain("object-contain");
  });

  it("offers open-in-new-tab and download actions against the source URL", async () => {
    const user = userEvent.setup();
    renderLightbox();
    await user.click(screen.getByTestId("inline-preview"));

    expect(screen.getByTestId("image-lightbox-open-tab")).toHaveAttribute("href", SRC);
    expect(screen.getByTestId("image-lightbox-open-tab")).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("image-lightbox-download")).toHaveAttribute("href", SRC);
    expect(screen.getByTestId("image-lightbox-download")).toHaveAttribute("download");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderLightbox();
    await user.click(screen.getByTestId("inline-preview"));
    expect(screen.getByTestId("image-lightbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("image-lightbox")).not.toBeInTheDocument();
  });
});
