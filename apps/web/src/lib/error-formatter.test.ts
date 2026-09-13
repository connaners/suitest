import { describe, expect, it } from "vitest";
import { cleanErrorMessage, classifyError } from "./error-formatter";

describe("error-formatter", () => {
  it("cleans raw markdown, envelope prefixes, and verbose paths from browser lock error", () => {
    const raw =
      "MCP_TOOL_FAILED: ### Error\nError: Browser is already in use for /Users/rohmnsa/Library/Caches/ms-playwright-mcp/mcp-chrome-for-testing-e49f97c, use --isolated to run multiple instances of the same browser";
    const cleaned = cleanErrorMessage(raw);
    expect(cleaned).toBe(
      "Browser is already in use for [browser cache], use --isolated to run multiple instances of the same browser",
    );
    expect(cleaned).not.toContain("###");
    expect(cleaned).not.toContain("MCP_TOOL_FAILED");
  });

  it("cleans MCP_TOOL_ERROR prefix", () => {
    const raw = "MCP_TOOL_ERROR: Target page, context or browser has been closed";
    const cleaned = cleanErrorMessage(raw);
    expect(cleaned).toBe("Target page, context or browser has been closed");
  });

  it("handles null and empty input gracefully", () => {
    expect(cleanErrorMessage(null)).toBe("");
    expect(cleanErrorMessage(undefined)).toBe("");
    expect(cleanErrorMessage("")).toBe("");
  });

  it("classifies browser lock error as environment error", () => {
    const raw =
      "MCP_TOOL_FAILED: ### Error\nError: Browser is already in use for /Users/test/Library/Caches/chrome";
    const classification = classifyError(raw);
    expect(classification.isEnvironmentError).toBe(true);
    expect(classification.title).toBe("Browser Profile Locked");
    expect(classification.hint).toContain("isolated mode");
  });

  it("classifies target closed as environment error", () => {
    const raw = "Target page, context or browser has been closed";
    const classification = classifyError(raw);
    expect(classification.isEnvironmentError).toBe(true);
    expect(classification.title).toBe("Browser Target Disconnected");
  });

  it("classifies element assertion failure as normal test step failure", () => {
    const raw = 'Error: "#submit-btn" does not match any elements.';
    const classification = classifyError(raw);
    expect(classification.isEnvironmentError).toBe(false);
    expect(classification.title).toBe("Test Step Failed");
  });
});
