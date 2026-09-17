import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmBulkRunDialog } from "./ConfirmBulkRunDialog";

describe("<ConfirmBulkRunDialog>", () => {
  it("renders with default execution settings collapsed and submits them directly", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ConfirmBulkRunDialog
        open={true}
        onOpenChange={onOpenChange}
        count={3}
        onConfirm={onConfirm}
        isPending={false}
      />,
    );

    expect(screen.getByTestId("bulk-run-confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText("Run 3 Selected Test Cases?")).toBeInTheDocument();
    expect(screen.getByTestId("execution-settings-container")).toBeInTheDocument();
    expect(screen.getByTestId("execution-settings-summary")).toHaveTextContent(
      "Headless • Failure only",
    );
    expect(screen.queryByTestId("execution-settings-panel")).not.toBeInTheDocument();

    // Submit with defaults without expanding
    await user.click(screen.getByTestId("bulk-run-confirm-submit"));
    expect(onConfirm).toHaveBeenCalledWith({
      cleanSessionBetweenCases: true,
      headless: true,
      screenshot: "only-on-failure",
      video: "off",
      videoQuality: "1080p",
      highlightSteps: false,
      preventSleep: false,
    });
  });

  it("customizes execution settings when expanded and submits updated payload", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmBulkRunDialog
        open={true}
        onOpenChange={vi.fn()}
        count={1}
        caseTitle="Login test"
        onConfirm={onConfirm}
        isPending={false}
      />,
    );

    // Expand settings
    await user.click(screen.getByTestId("toggle-execution-settings"));
    expect(screen.getByTestId("execution-settings-panel")).toBeInTheDocument();

    // Select screenshot = on (Every step)
    const screenshotSelect = screen.getByTestId("config-screenshot-select");
    await user.selectOptions(screenshotSelect, "on");

    // Select video = retain-on-failure
    const videoSelect = screen.getByTestId("config-video-select");
    await user.selectOptions(videoSelect, "retain-on-failure");

    // Toggle headless off (Headed mode)
    const headlessToggle = screen.getByTestId("config-headless-toggle");
    await user.click(headlessToggle);

    // Toggle highlight on
    const highlightToggle = screen.getByTestId("config-highlight-toggle");
    await user.click(highlightToggle);

    // Submit
    await user.click(screen.getByTestId("bulk-run-confirm-submit"));
    expect(onConfirm).toHaveBeenCalledWith({
      cleanSessionBetweenCases: true,
      headless: false,
      screenshot: "on",
      video: "retain-on-failure",
      videoQuality: "1080p",
      highlightSteps: true,
      preventSleep: false,
    });
  });


  it("toggles execution settings visibility and pre-populates initialSettings", async () => {
    const user = userEvent.setup();

    render(
      <ConfirmBulkRunDialog
        open={true}
        onOpenChange={vi.fn()}
        count={2}
        onConfirm={vi.fn()}
        isPending={false}
        initialSettings={{
          headless: false,
          screenshot: "on",
          highlightSteps: true,
        }}
      />,
    );

    // Should display custom pre-populated summary
    expect(screen.getByTestId("execution-settings-summary")).toHaveTextContent(
      "Headed • Every step • Highlight",
    );

    // Expand panel
    await user.click(screen.getByTestId("toggle-execution-settings"));
    expect(screen.getByTestId("execution-settings-panel")).toBeInTheDocument();

    const headlessToggle = screen.getByTestId("config-headless-toggle") as HTMLInputElement;
    expect(headlessToggle.checked).toBe(false);

    const highlightToggle = screen.getByTestId("config-highlight-toggle") as HTMLInputElement;
    expect(highlightToggle.checked).toBe(true);

    // Collapse panel
    await user.click(screen.getByTestId("toggle-execution-settings"));
    expect(screen.queryByTestId("execution-settings-panel")).not.toBeInTheDocument();
  });
});
