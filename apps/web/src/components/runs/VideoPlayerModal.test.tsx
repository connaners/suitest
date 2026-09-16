import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VideoPlayerModal } from "./VideoPlayerModal";

describe("<VideoPlayerModal>", () => {
  const sampleSrc = "https://example.com/artifacts/run_1/recording.webm";

  it("does not render when open is false", () => {
    render(
      <VideoPlayerModal
        open={false}
        onOpenChange={vi.fn()}
        src={sampleSrc}
        title="Run Video Recording"
      />,
    );

    expect(screen.queryByTestId("video-player-modal")).not.toBeInTheDocument();
  });

  it("does not render when src is null or empty", () => {
    render(
      <VideoPlayerModal
        open={true}
        onOpenChange={vi.fn()}
        src={null}
        title="Run Video Recording"
      />,
    );

    expect(screen.queryByTestId("video-player-modal")).not.toBeInTheDocument();
  });

  it("renders video element, title, subtitle, and action links when open is true", () => {
    render(
      <VideoPlayerModal
        open={true}
        onOpenChange={vi.fn()}
        src={sampleSrc}
        title="Checkout Test Recording"
        subtitle="video/webm • 150 KB"
        downloadFilename="checkout-recording.webm"
      />,
    );

    expect(screen.getByTestId("video-player-modal")).toBeInTheDocument();
    expect(screen.getByText("Checkout Test Recording")).toBeInTheDocument();
    expect(screen.getByText("video/webm • 150 KB")).toBeInTheDocument();

    const video = screen.getByTestId("video-modal-player");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("src", sampleSrc);
    expect(video).toHaveAttribute("controls");

    const openTabLink = screen.getByTestId("video-modal-open-tab");
    expect(openTabLink).toHaveAttribute("href", sampleSrc);
    expect(openTabLink).toHaveAttribute("target", "_blank");

    const downloadLink = screen.getByTestId("video-modal-download");
    expect(downloadLink).toHaveAttribute("href", sampleSrc);
    expect(downloadLink).toHaveAttribute("download", "checkout-recording.webm");
  });

  it("uses slugified title as default downloadFilename if not specified", () => {
    render(
      <VideoPlayerModal
        open={true}
        onOpenChange={vi.fn()}
        src={sampleSrc}
        title="My Custom Test!"
      />,
    );

    const downloadLink = screen.getByTestId("video-modal-download");
    expect(downloadLink).toHaveAttribute("download", "my-custom-test-.webm");
  });
});
