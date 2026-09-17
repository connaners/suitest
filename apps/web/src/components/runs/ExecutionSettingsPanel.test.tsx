import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExecutionSettingsPanel } from "./ExecutionSettingsPanel";
import {
  DEFAULT_EXECUTION_SETTINGS,
  type ExecutionSettings,
} from "./execution-settings";

describe("ExecutionSettingsPanel", () => {
  it("renders collapsed by default with summary badge", () => {
    const onChange = vi.fn();
    render(
      <ExecutionSettingsPanel
        value={DEFAULT_EXECUTION_SETTINGS}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId("execution-settings-container")).toBeInTheDocument();
    expect(screen.getByTestId("execution-settings-summary")).toHaveTextContent(
      "Headless • Failure only",
    );
    expect(screen.queryByTestId("execution-settings-panel")).not.toBeInTheDocument();
  });

  it("expands when toggle button is clicked", () => {
    const onChange = vi.fn();
    render(
      <ExecutionSettingsPanel
        value={DEFAULT_EXECUTION_SETTINGS}
        onChange={onChange}
      />,
    );

    const toggleBtn = screen.getByTestId("toggle-execution-settings");
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId("execution-settings-panel")).toBeInTheDocument();
    expect(screen.getByTestId("config-screenshot-select")).toBeInTheDocument();
    expect(screen.getByTestId("config-video-select")).toBeInTheDocument();
    expect(screen.getByTestId("config-headless-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("config-highlight-toggle")).toBeInTheDocument();
  });

  it("calls onChange when video select is changed", () => {
    const onChange = vi.fn();
    render(
      <ExecutionSettingsPanel
        value={DEFAULT_EXECUTION_SETTINGS}
        onChange={onChange}
        defaultExpanded={true}
      />,
    );

    const select = screen.getByTestId("config-video-select");
    fireEvent.change(select, { target: { value: "on" } });

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXECUTION_SETTINGS,
      video: "on",
    });
  });

  it("calls onChange when screenshot select is changed", () => {
    const onChange = vi.fn();
    render(
      <ExecutionSettingsPanel
        value={DEFAULT_EXECUTION_SETTINGS}
        onChange={onChange}
        defaultExpanded={true}
      />,
    );

    const select = screen.getByTestId("config-screenshot-select");
    fireEvent.change(select, { target: { value: "on" } });

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXECUTION_SETTINGS,
      screenshot: "on",
    });
  });

  it("calls onChange when headless toggle is clicked", () => {
    const onChange = vi.fn();
    render(
      <ExecutionSettingsPanel
        value={DEFAULT_EXECUTION_SETTINGS}
        onChange={onChange}
        defaultExpanded={true}
      />,
    );

    const headlessToggle = screen.getByTestId("config-headless-toggle");
    fireEvent.click(headlessToggle);

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXECUTION_SETTINGS,
      headless: false,
    });
  });

  it("calls onChange when highlight toggle is clicked", () => {
    const onChange = vi.fn();
    render(
      <ExecutionSettingsPanel
        value={DEFAULT_EXECUTION_SETTINGS}
        onChange={onChange}
        defaultExpanded={true}
      />,
    );

    const highlightToggle = screen.getByTestId("config-highlight-toggle");
    fireEvent.click(highlightToggle);

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXECUTION_SETTINGS,
      highlightSteps: true,
    });
  });

  it("displays pre-populated custom settings summary correctly", () => {
    const customSettings: ExecutionSettings = {
      headless: false,
      screenshot: "on",
      video: "retain-on-failure",
      videoQuality: "720p",
      highlightSteps: true,
      cleanSessionBetweenCases: true,
      preventSleep: true,
    };
    render(
      <ExecutionSettingsPanel
        value={customSettings}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("execution-settings-summary")).toHaveTextContent(
      "Headed • Every step • Video: on fail (720p) • Highlight",
    );
  });

  it("calls onChange when video quality select is changed", () => {
    const onChange = vi.fn();
    render(
      <ExecutionSettingsPanel
        value={{ ...DEFAULT_EXECUTION_SETTINGS, video: "on", videoQuality: "720p" }}
        onChange={onChange}
        defaultExpanded={true}
      />,
    );

    const qualitySelect = screen.getByTestId("config-video-quality-select");
    expect(qualitySelect).toBeInTheDocument();
    expect(qualitySelect).toHaveValue("720p");

    fireEvent.change(qualitySelect, { target: { value: "1080p" } });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_EXECUTION_SETTINGS,
      video: "on",
      videoQuality: "1080p",
    });
  });

  it("renders and toggles cleanSessionBetweenCases when headed mode is active", () => {
    const onChange = vi.fn();
    const headedSettings: ExecutionSettings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      headless: false,
      cleanSessionBetweenCases: true,
    };
    render(
      <ExecutionSettingsPanel
        value={headedSettings}
        onChange={onChange}
        defaultExpanded={true}
      />,
    );

    const toggle = screen.getByTestId("config-clean-session-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({
      ...headedSettings,
      cleanSessionBetweenCases: false,
    });
  });

  it("displays 'No media (Fastest)' in summary when screenshot and video are off", () => {
    const noMediaSettings: ExecutionSettings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      screenshot: "off",
      video: "off",
    };
    render(
      <ExecutionSettingsPanel
        value={noMediaSettings}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId("execution-settings-summary")).toHaveTextContent(
      "Headless • No media (Fastest)",
    );
  });

  it("renders contextual hint note when headless=true, screenshot=off, video=off, and highlightSteps=true", () => {
    const highlightNoMediaSettings: ExecutionSettings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      headless: true,
      screenshot: "off",
      video: "off",
      highlightSteps: true,
    };
    render(
      <ExecutionSettingsPanel
        value={highlightNoMediaSettings}
        onChange={vi.fn()}
        defaultExpanded={true}
      />,
    );

    const note = screen.getByTestId("highlight-no-media-note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/Live visual only/);
    expect(note).toHaveTextContent(/no visual evidence will be recorded in artifacts/);
  });
});


