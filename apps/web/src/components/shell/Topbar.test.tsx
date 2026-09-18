import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Topbar } from "@/components/shell/Topbar";
import { useAiPanel } from "@/stores/use-ai-panel";
import { useCapabilities, type Capabilities } from "@/stores/use-capabilities";

const ZERO_CAPS: Capabilities = {
  llm: {
    status: "not_configured",
    provider: null,
    model: null,
    base_url: null,
    is_test_provider: false,
  },
  embeddings: { enabled: false, backend: "none", model: null, dim: null },
  features: {
    manual_tcm: true,
    deterministic_runner: true,
    deterministic_generator_openapi: true,
    deterministic_generator_recorder: true,
    deterministic_generator_crawler: true,
    ai_generation: false,
    ai_execution_agentic: false,
    ai_diagnose: false,
    ai_conversation: false,
    semantic_search: false,
    fts_search: true,
    auto_defect_filing_ai: false,
    auto_defect_filing_rule: true,
  },
  autonomy: { available: ["manual"], default: "manual" },
  mcpProviders: [],
  version: "1.0.0",
};

const CLOUD_CAPS: Capabilities = {
  llm: {
    status: "ready",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    base_url: null,
    is_test_provider: false,
  },
  embeddings: { enabled: true, backend: "openai", model: "text-embedding-3-small", dim: 1536 },
  features: {
    manual_tcm: true,
    deterministic_runner: true,
    deterministic_generator_openapi: true,
    deterministic_generator_recorder: true,
    deterministic_generator_crawler: true,
    ai_generation: true,
    ai_execution_agentic: true,
    ai_diagnose: true,
    ai_conversation: true,
    semantic_search: true,
    fts_search: true,
    auto_defect_filing_ai: true,
    auto_defect_filing_rule: true,
  },
  autonomy: { available: ["manual", "assist", "semi_auto", "auto"], default: "assist" },
  mcpProviders: [],
  version: "1.0.0",
};

async function renderTopbar(initialPath: string): Promise<ReturnType<typeof render>> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const rootRoute = createRootRoute({
    component: () => (
      <div>
        <Topbar />
        <Outlet />
      </div>
    ),
  });

  const targets = [
    { path: "/dashboard", title: "Dashboard" },
    { path: "/cases", title: "Test Cases" },
    { path: "/runs", title: "Test Runs" },
    { path: "/defects", title: "Defects" },
    { path: "/analytics", title: "Analytics" },
    { path: "/trace", title: "Traceability" },
    { path: "/integrations", title: "Integrations" },
    { path: "/docs", title: "Documents" },
    { path: "/inbox", title: "Inbox" },
  ];
  const children = targets.map((t) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: t.path,
      component: () => <div data-testid={`page-${t.path}`}>{t.title}</div>,
      staticData: { title: t.title },
    }),
  );
  const routeTree = rootRoute.addChildren(children);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(result.container.querySelector("[data-testid='topbar']")).not.toBeNull();
  });
  return result;
}

describe("<Topbar>", () => {
  beforeEach(() => {
    act(() => {
      useCapabilities.setState({ capabilities: ZERO_CAPS, loading: false, error: null });
      useAiPanel.setState({ isOpen: true });
    });
  });
  afterEach(() => {
    act(() => {
      useCapabilities.setState({ capabilities: null, loading: true, error: null });
      useAiPanel.setState({ isOpen: true });
    });
    localStorage.removeItem("suitest.aiPanelOpen");
  });

  it("renders the LLM status badge slot", async () => {
    await renderTopbar("/dashboard");
    expect(screen.getByTestId("llm-status-badge")).toHaveTextContent("LLM not connected");
  });

  it("links the sponsor icons out to GitHub Sponsors and Saweria", async () => {
    await renderTopbar("/dashboard");
    const gh = screen.getByTestId("topbar-sponsor-link");
    expect(gh).toHaveAttribute("href", "https://github.com/sponsors/suiflex");
    expect(gh).toHaveAttribute("rel", "noopener noreferrer");
    const saweria = screen.getByTestId("topbar-saweria-link");
    expect(saweria).toHaveAttribute("href", "https://saweria.co/suiflex");
    expect(saweria).toHaveAttribute("target", "_blank");
  });

  it("shows a tooltip when an icon-only control is hovered", async () => {
    await renderTopbar("/dashboard");
    const user = userEvent.setup();
    await user.hover(screen.getByTestId("topbar-help-link"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Help & documentation");
  });

  it("labels the theme toggle with the theme it switches to", async () => {
    await renderTopbar("/dashboard");
    const user = userEvent.setup();
    await user.hover(screen.getByTestId("theme-toggle"));
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toMatch(/Switch to (light|dark) theme/);
  });

  it("reflects current route title in breadcrumbs", async () => {
    await renderTopbar("/runs");
    const crumbs = await screen.findByTestId("topbar-breadcrumbs");
    expect(crumbs).toHaveTextContent("Test Runs");
  });

  it("renders breadcrumbs for a different route after mount", async () => {
    await renderTopbar("/analytics");
    const crumbs = screen.getByTestId("topbar-breadcrumbs");
    expect(crumbs).toHaveTextContent("Analytics");
  });

  it("disables the + New button with a tooltip reason", async () => {
    await renderTopbar("/dashboard");
    const newBtn = screen.getByTestId("topbar-new-button");
    expect(newBtn).toBeDisabled();
  });

  it("opens the command palette on ⌘K keydown", async () => {
    await renderTopbar("/dashboard");
    // shadcn CommandDialog mounts dialog content only when open.
    expect(screen.queryByPlaceholderText(/Type a command/i)).toBeNull();

    // userEvent.keyboard routes the event through the JSDOM input pipeline
    // (vs. raw dispatchEvent) so the global keydown listener observes a
    // properly-built KeyboardEvent without racing the act() flush. Fixes a
    // flake where the synthetic event landed before the listener attached
    // when the test ran inside the full suite.
    const user = userEvent.setup();
    await user.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByPlaceholderText(/Type a command/i)).toBeInTheDocument();
  });

  it("opens the command palette on Ctrl+K keydown", async () => {
    await renderTopbar("/dashboard");
    const user = userEvent.setup();
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByPlaceholderText(/Type a command/i)).toBeInTheDocument();
  });

  it("opens the command palette when the search trigger is clicked", async () => {
    await renderTopbar("/dashboard");
    const trigger = screen.getByTestId("topbar-search-trigger");
    await userEvent.click(trigger);
    expect(await screen.findByPlaceholderText(/Type a command/i)).toBeInTheDocument();
  });

  it("lists all 9 navigation commands inside the palette", async () => {
    await renderTopbar("/dashboard");
    await userEvent.click(screen.getByTestId("topbar-search-trigger"));
    await screen.findByPlaceholderText(/Type a command/i);
    const list = screen.getByTestId("topbar-command-list");
    const labels = [
      "Go to Dashboard",
      "Go to Test Cases",
      "Go to Test Runs",
      "Go to Defects",
      "Go to Analytics",
      "Go to Traceability",
      "Go to Integrations",
      "Go to Docs",
      "Go to Inbox",
    ];
    for (const label of labels) {
      expect(list).toHaveTextContent(label);
    }
  });

  it("does not render assistant toggle button in ZERO tier", async () => {
    await renderTopbar("/dashboard");
    expect(screen.queryByTestId("topbar-ai-panel-toggle")).toBeNull();
  });

  it("renders assistant toggle button in CLOUD tier with LLM ready and toggles open state on click", async () => {
    act(() => {
      useCapabilities.setState({ capabilities: CLOUD_CAPS, loading: false, error: null });
    });
    await renderTopbar("/dashboard");

    const toggleBtn = screen.getByTestId("topbar-ai-panel-toggle");
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("aria-label", "Collapse assistant");

    await userEvent.click(toggleBtn);
    expect(useAiPanel.getState().isOpen).toBe(false);

    await userEvent.click(toggleBtn);
    expect(useAiPanel.getState().isOpen).toBe(true);
  });

  it("toggles assistant open state on ⌘J keydown", async () => {
    act(() => {
      useCapabilities.setState({ capabilities: CLOUD_CAPS, loading: false, error: null });
    });
    await renderTopbar("/dashboard");

    expect(useAiPanel.getState().isOpen).toBe(true);
    const user = userEvent.setup();
    await user.keyboard("{Meta>}j{/Meta}");
    expect(useAiPanel.getState().isOpen).toBe(false);

    await user.keyboard("{Meta>}j{/Meta}");
    expect(useAiPanel.getState().isOpen).toBe(true);
  });

  it("toggles assistant open state on ⌘Shift+L keydown", async () => {
    act(() => {
      useCapabilities.setState({ capabilities: CLOUD_CAPS, loading: false, error: null });
    });
    await renderTopbar("/dashboard");

    expect(useAiPanel.getState().isOpen).toBe(true);
    const user = userEvent.setup();
    await user.keyboard("{Meta>}{Shift>}l{/Shift}{/Meta}");
    expect(useAiPanel.getState().isOpen).toBe(false);

    await user.keyboard("{Meta>}{Shift>}l{/Shift}{/Meta}");
    expect(useAiPanel.getState().isOpen).toBe(true);
  });

  it("toggles assistant open state on Ctrl+J keydown", async () => {
    act(() => {
      useCapabilities.setState({ capabilities: CLOUD_CAPS, loading: false, error: null });
    });
    await renderTopbar("/dashboard");

    expect(useAiPanel.getState().isOpen).toBe(true);
    const user = userEvent.setup();
    await user.keyboard("{Control>}j{/Control}");
    expect(useAiPanel.getState().isOpen).toBe(false);
  });
});
