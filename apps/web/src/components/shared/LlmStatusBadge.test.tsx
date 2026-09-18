import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { LlmStatusBadge } from "@/components/shared/LlmStatusBadge";
import { useActiveWorkspace } from "@/stores/use-active-workspace";
import { useCapabilities, type Capabilities } from "@/stores/use-capabilities";
import { CLOUD_CAPS, ZERO_CAPS } from "@/test/capabilities";

function setCaps(capabilities: Capabilities | null): void {
  act(() => useCapabilities.setState({ capabilities, loading: false, error: null }));
}

const VALIDATION_REQUIRED_CAPS: Capabilities = {
  ...ZERO_CAPS,
  llm: {
    status: "validation_required",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    base_url: null,
    is_test_provider: false,
  },
};

describe("<LlmStatusBadge>", () => {
  afterEach(() => {
    setCaps(null);
    useActiveWorkspace.setState({ workspaceId: null });
  });

  it("shows that an LLM is not connected", () => {
    setCaps(ZERO_CAPS);
    render(<LlmStatusBadge />);
    expect(screen.getByTestId("llm-status-badge")).toHaveAttribute(
      "data-llm-status",
      "not_configured",
    );
  });

  it("shows the validated provider and model", async () => {
    setCaps(CLOUD_CAPS);
    render(<LlmStatusBadge />);
    const badge = screen.getByTestId("llm-status-badge");
    expect(badge).toHaveTextContent("Anthropic:claude-opus-4-7");
    await userEvent.click(badge);
    expect(await screen.findByTestId("llm-status-badge-popover")).toHaveTextContent("LLM ready");
  });

  it("shows validation required warning with test button when active workspace is present", async () => {
    setCaps(VALIDATION_REQUIRED_CAPS);
    useActiveWorkspace.setState({ workspaceId: "ws_1" });
    render(<LlmStatusBadge />);
    const badge = screen.getByTestId("llm-status-badge");
    expect(badge).toHaveAttribute("data-llm-status", "validation_required");
    expect(badge).toHaveTextContent("LLM validation required");

    await userEvent.click(badge);
    const popover = await screen.findByTestId("llm-status-badge-popover");
    expect(popover).toHaveTextContent(/Connection not verified/i);
    expect(popover).toHaveTextContent(/Assistant Chat and AI tools are locked/i);
    expect(screen.getByTestId("llm-popover-test-btn")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Settings →/i })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});
