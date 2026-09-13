import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressBar } from "@/components/shared/ProgressBar";

describe("<ProgressBar>", () => {
  it("renders the fill width based on value", () => {
    render(<ProgressBar value={42} />);
    const fill = screen.getByTestId("progress-bar-fill");
    expect(fill.style.width).toBe("42%");
  });

  it("clamps values above 100", () => {
    render(<ProgressBar value={250} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByTestId("progress-bar-fill").style.width).toBe("100%");
  });

  it("clamps negative values to 0", () => {
    render(<ProgressBar value={-12} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("applies variant class on fill", () => {
    render(<ProgressBar value={50} variant="warn" />);
    expect(screen.getByTestId("progress-bar-fill").className).toContain("bg-amber");
  });

  it("renders label + percentage when label is provided", () => {
    render(<ProgressBar value={75} label="Checkout suite" />);
    expect(screen.getByText("Checkout suite")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  describe("segmented mode", () => {
    it("renders multiple segments with proportional widths", () => {
      render(
        <ProgressBar
          segments={[
            { value: 6, variant: "pass", label: "6 passed" },
            { value: 2, variant: "fail", label: "2 failed" },
            { value: 2, variant: "skip", label: "2 skipped" },
          ]}
          total={10}
        />,
      );

      const segments = screen.getAllByTestId("progress-bar-segment");
      expect(segments).toHaveLength(3);
      expect(segments[0]?.style.width).toBe("60%");
      expect(segments[0]?.className).toContain("bg-accent");
      expect(segments[1]?.style.width).toBe("20%");
      expect(segments[1]?.className).toContain("bg-red");
      expect(segments[2]?.style.width).toBe("20%");
      expect(segments[2]?.className).toContain("bg-amber");

      const bar = screen.getByRole("progressbar");
      expect(bar).toHaveAttribute("aria-valuenow", "100");
    });

    it("renders running segment with pulse animation and remaining capacity", () => {
      render(
        <ProgressBar
          segments={[
            { value: 4, variant: "pass", label: "4 passed" },
            { value: 1, variant: "running", label: "1 running" },
          ]}
          total={10}
          label="Adhoc Run"
        />,
      );

      const segments = screen.getAllByTestId("progress-bar-segment");
      expect(segments).toHaveLength(2);
      expect(segments[0]?.style.width).toBe("40%");
      expect(segments[1]?.style.width).toBe("10%");
      expect(segments[1]?.className).toContain("suitest-pulse");
      expect(segments[1]?.className).toContain("bg-blue");

      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("filters out zero-value segments", () => {
      render(
        <ProgressBar
          segments={[
            { value: 5, variant: "pass" },
            { value: 0, variant: "fail" },
          ]}
          total={5}
        />,
      );

      const segments = screen.getAllByTestId("progress-bar-segment");
      expect(segments).toHaveLength(1);
      expect(segments[0]?.style.width).toBe("100%");
    });
  });
});

