/**
 * Utilities to sanitize and classify MCP and runner error messages for user presentation.
 */

export interface ErrorClassification {
  isEnvironmentError: boolean;
  title: string;
  hint: string;
}

const INFRA_PATTERNS = [
  {
    regex: /browser is already in use/i,
    title: "Browser Profile Locked",
    hint: "Another process is holding the browser profile lock. Running in isolated mode or restarting the runner resolves this.",
  },
  {
    regex: /target (?:page, context or )?browser has been closed|target closed/i,
    title: "Browser Target Disconnected",
    hint: "The browser window or tab unexpectedly closed during test execution.",
  },
  {
    regex: /connection refused|econnrefused/i,
    title: "Service Connection Refused",
    hint: "The target service or MCP provider is offline or unreachable on the configured port.",
  },
  {
    regex: /auto-disabled \(down past threshold\)/i,
    title: "MCP Provider Auto-Disabled",
    hint: "The provider health monitor detected persistent downtime and temporarily unrouted calls.",
  },
  {
    regex: /mcp_tool_timeout/i,
    title: "MCP Execution Timeout",
    hint: "The MCP tool call exceeded its operational timeout budget.",
  },
];

/**
 * Strips raw markdown artifacts, repetitive prefixes, and machine-local paths from error messages.
 */
export function cleanErrorMessage(raw: string | null | undefined): string {
  if (!raw) return "";

  let msg = raw.trim();

  // Strip envelope prefixes like MCP_TOOL_FAILED: or MCP_TOOL_ERROR:
  msg = msg.replace(/^(?:MCP_TOOL_(?:FAILED|ERROR):\s*)+/gi, "");

  // Strip markdown headers like ### Error
  msg = msg.replace(/^#+\s*Error\s*/gi, "");

  // Strip redundant leading "Error: "
  msg = msg.replace(/^Error:\s*/gi, "");

  // Anonymize/shorten noisy local cache directory paths
  // e.g. /Users/.../Library/Caches/ms-playwright-mcp/mcp-chrome-for-testing-...
  msg = msg.replace(
    /(?:\/[a-zA-Z0-9._-]+)+\/Library\/Caches\/[a-zA-Z0-9._\/-]+/g,
    "[browser cache]",
  );

  return msg.trim();
}

/**
 * Classifies an error message into an environment/infrastructure failure or a test assertion failure.
 */
export function classifyError(raw: string | null | undefined): ErrorClassification {
  if (!raw) {
    return {
      isEnvironmentError: false,
      title: "Error",
      hint: "",
    };
  }

  const cleaned = cleanErrorMessage(raw);
  for (const pat of INFRA_PATTERNS) {
    if (pat.regex.test(raw) || pat.regex.test(cleaned)) {
      return {
        isEnvironmentError: true,
        title: pat.title,
        hint: pat.hint,
      };
    }
  }

  return {
    isEnvironmentError: false,
    title: "Test Step Failed",
    hint: "",
  };
}
