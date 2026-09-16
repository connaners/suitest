import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrowserPreview } from "./BrowserPreview";

describe("BrowserPreview", () => {
  it("renders placeholder when no preview or video is provided", () => {
    render(<BrowserPreview url={null} />);
    expect(screen.getByTestId("browser-preview-placeholder")).toBeInTheDocument();
  });

  it("renders run screenshot and opens lightbox on click", () => {
    render(<BrowserPreview url="https://example.com/latest.png" />);

    const trigger = screen.getByTestId("browser-preview-zoom-run-trigger");
    expect(trigger).toBeInTheDocument();
    expect(screen.getByTestId("browser-preview-image")).toHaveAttribute(
      "src",
      "https://example.com/latest.png",
    );

    // Lightbox closed initially
    expect(screen.queryByTestId("image-lightbox-modal")).not.toBeInTheDocument();

    // Click trigger to open lightbox
    fireEvent.click(trigger);
    expect(screen.getByTestId("image-lightbox-modal")).toBeInTheDocument();
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute(
      "src",
      "https://example.com/latest.png",
    );
  });

  it("renders step screenshot with zoom trigger and opens lightbox", () => {
    render(
      <BrowserPreview
        url="https://example.com/latest.png"
        stepScreenshotUrl="https://example.com/step-3.png"
        stepLabel="Step 3"
      />,
    );

    const stepTrigger = screen.getByTestId("browser-preview-zoom-step-trigger");
    expect(stepTrigger).toBeInTheDocument();
    expect(screen.getByTestId("browser-preview-step-image")).toHaveAttribute(
      "src",
      "https://example.com/step-3.png",
    );

    fireEvent.click(stepTrigger);
    expect(screen.getByTestId("image-lightbox-modal")).toBeInTheDocument();
    expect(screen.getByTestId("lightbox-image")).toHaveAttribute(
      "src",
      "https://example.com/step-3.png",
    );
    expect(screen.getByText("Step 3 screenshot")).toBeInTheDocument();
  });

  it("renders video element when videoUrl is provided and no step screenshot is selected", () => {
    render(
      <BrowserPreview
        url="https://example.com/latest.png"
        videoUrl="https://example.com/run.mp4"
      />,
    );

    expect(screen.getByTestId("browser-preview-video")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-preview-zoom-run-trigger")).not.toBeInTheDocument();
  });

  it("switches to Code tab when code is provided", () => {
    render(
      <BrowserPreview
        url="https://example.com/latest.png"
        code="await page.goto('https://example.com');"
      />,
    );

    const codeTab = screen.getByTestId("code-tab");
    expect(codeTab).not.toBeDisabled();

    fireEvent.click(codeTab);
    expect(screen.getByTestId("browser-preview-code")).toHaveTextContent(
      "await page.goto('https://example.com');",
    );
  });

  it("renders informative placeholder when screenshots and video recording are disabled", () => {
    render(
      <BrowserPreview
        url={null}
        playwrightConfig={{
          headless: true,
          screenshot: "off",
          video: "off",
          highlightSteps: true,
        }}
      />,
    );

    const placeholder = screen.getByTestId("browser-preview-placeholder");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveTextContent("No preview available");
    expect(placeholder).toHaveTextContent(
      "Screenshots and video recording were disabled in Execution Settings",
    );
  });
});

