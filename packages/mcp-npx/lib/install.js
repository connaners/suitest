"use strict";

/**
 * `suitest-mcp install` — register the Suitest MCP server into a supported
 * IDE agent's config using Kurir (github.com/suiflex/kurir).
 */

const creds = require("./creds.js");
const picker = require("./picker.js");
const theme = require("./theme.js");
const { findPython } = require("./python.js");
const kurir = require("./kurir.js");

const PKG = "@suiflex/suitest-mcp";
const NPX_ARGS = ["-y", PKG];

// Client registry — supported targets with their Kurir harness IDs
const CLIENTS = {
  "claude-code": {
    kind: "kurir",
    harness: "claude-code",
    label: "claude-code",
    hint: "writes ~/.claude.json or .mcp.json mcpServers",
    envOverride: "CLAUDE_CODE_CONFIG",
  },
  "claude-desktop": {
    kind: "kurir",
    harness: "claude-desktop",
    label: "claude-desktop",
    hint: "writes claude_desktop_config.json in Claude support dir",
    envOverride: "CLAUDE_DESKTOP_CONFIG",
  },
  cursor: {
    kind: "kurir",
    harness: "cursor",
    label: "cursor",
    hint: "writes ~/.cursor/mcp.json",
    envOverride: "CURSOR_CONFIG",
  },
  windsurf: {
    kind: "kurir",
    harness: "windsurf",
    label: "windsurf",
    hint: "writes ~/.codeium/windsurf/mcp_config.json",
    envOverride: "WINDSURF_CONFIG",
  },
  codex: {
    kind: "kurir",
    harness: "codex",
    label: "codex",
    hint: "delegates to `codex mcp add`",
  },
  "gemini-cli": {
    kind: "kurir",
    harness: "gemini-cli",
    label: "gemini-cli",
    hint: "delegates to `gemini mcp add`",
  },
  vscode: {
    kind: "kurir",
    harness: "vscode",
    label: "vscode",
    hint: "delegates to `code --add-mcp` (GitHub Copilot in VS Code)",
  },
  "copilot-cli": {
    kind: "kurir",
    harness: "copilot-cli",
    label: "copilot-cli",
    hint: "writes ~/.copilot/mcp-config.json (GitHub Copilot CLI)",
    envOverride: "COPILOT_CLI_CONFIG",
  },
  opencode: {
    kind: "kurir",
    harness: "opencode",
    label: "opencode",
    hint: "writes opencode.json",
    envOverride: "OPENCODE_CONFIG",
  },
  antigravity: {
    kind: "kurir",
    harness: "antigravity-cli",
    label: "antigravity",
    hint: "writes ~/.gemini/antigravity/mcp_config.json",
    envOverride: "ANTIGRAVITY_CONFIG",
  },
  "antigravity-cli": {
    kind: "kurir",
    harness: "antigravity-cli",
    label: "antigravity-cli",
    hint: "writes ~/.gemini/config/mcp_config.json",
    envOverride: "ANTIGRAVITY_CLI_CONFIG",
  },
  "antigravity-desktop": {
    kind: "kurir",
    harness: "antigravity-desktop",
    label: "antigravity-desktop",
    hint: "writes Antigravity Desktop mcp_config.json",
  },
  hermes: {
    kind: "kurir",
    harness: "hermes",
    label: "hermes",
    hint: "delegates to `hermes mcp add` (~/.hermes/config.yaml)",
  },
  openclaw: {
    kind: "kurir",
    harness: "openclaw",
    label: "openclaw",
    hint: "writes openclaw.json under mcp.servers",
    envOverride: "OPENCLAW_CONFIG",
  },
  zed: {
    kind: "kurir",
    harness: "zed",
    label: "zed",
    hint: "writes Zed context_servers",
  },
  omp: {
    kind: "kurir",
    harness: "omp",
    label: "omp",
    hint: "print portable snippet only",
  },
  "generic-json": {
    kind: "snippet",
    label: "generic-json",
    hint: "print snippet only, no file changes",
  },
};

const CLIENT_ORDER = Object.keys(CLIENTS);

// --- JSON entry shape preview helper -------------------------------------

function serverSpec(client, env) {
  if (client === "opencode") {
    const entry = {
      type: "local",
      command: ["npx", ...NPX_ARGS],
      environment: env,
      enabled: true,
    };
    return { entry, snippet: { mcp: { suitest: entry } } };
  }
  if (client === "openclaw") {
    const entry = { command: "npx", args: NPX_ARGS, env, transport: "stdio" };
    return {
      entry,
      snippet: { mcp: { servers: { suitest: entry } } },
    };
  }
  const entry = { command: "npx", args: NPX_ARGS, env };
  return { entry, snippet: { mcpServers: { suitest: entry } } };
}

// --- install one client via Kurir ----------------------------------------

function installClient(clientId, { name = "suitest", scope, env = {}, print, dryRun, force, config, cwd } = {}) {
  const client = CLIENTS[clientId];
  if (!client) throw new Error(`unknown client: ${clientId}`);

  if (client.kind === "snippet") {
    const { snippet } = serverSpec(clientId, env);
    process.stdout.write(`${JSON.stringify(snippet, null, 2)}\n`);
    return;
  }

  const targetConfig = config || (client.envOverride && process.env[client.envOverride]) || undefined;

  const res = kurir.registerServer({
    client: client.harness || clientId,
    name,
    command: "npx",
    args: NPX_ARGS,
    env,
    scope: scope === "project" ? "project" : "user",
    config: targetConfig,
    cwd,
    force,
    print,
    dryRun,
  });

  if (res.error) {
    throw new Error(`Failed to execute kurir: ${res.error.message}`);
  }

  if (res.status !== 0) {
    const errText = res.stderr ? res.stderr.trim() : `exit status ${res.status}`;
    throw new Error(errText);
  }

  if (res.stdout) {
    process.stdout.write(res.stdout);
  }
}

// --- doctor ---------------------------------------------------------------

function doctor(only) {
  process.stdout.write("MCP doctor\n──────────\n");

  const py = findPython();
  process.stdout.write(
    py
      ? `[ok] Python ${py.version} on PATH (${py.cmd})\n`
      : "[warn] Python >= 3.11 not found on PATH (set SUITEST_PYTHON)\n",
  );

  const saved = creds.loadCreds();
  process.stdout.write(
    saved
      ? `[ok] Credentials saved at ${creds.credsPath()}\n`
      : "[warn] No saved credentials — run `suitest-mcp login`\n",
  );

  kurir.runDoctor(only);
}

// --- interactive orchestration -------------------------------------------

async function runInteractive(opts) {
  process.stdout.write(theme.banner() + "\n\n");

  const py = findPython();
  const saved = creds.loadCreds();
  process.stdout.write(
    theme.step(
      "install — preflight",
      [
        py
          ? `[ok]   Python interpreter: ${py.cmd} (${py.version})`
          : "[fail] Python >= 3.11 not found on PATH",
        saved
          ? "[ok]   Credentials saved (reused automatically)"
          : "[info] No saved credentials — you'll be asked once",
      ],
      { color: py ? theme.accent : theme.amber },
    ) + "\n",
  );

  if (!py) {
    throw new Error(
      "Python >= 3.11 is required to run the server. Install from https://python.org, then retry.",
    );
  }

  const resolved = await interactiveLogin(opts);
  const env = {
    SUITEST_API_URL: resolved.apiUrl,
    SUITEST_API_KEY: resolved.apiKey,
  };
  if (resolved.warn) {
    process.stderr.write(
      "[warn] Using placeholder credentials — edit the config or run `suitest-mcp login`.\n",
    );
  }

  const items = CLIENT_ORDER.map((id) => ({
    value: id,
    label: CLIENTS[id].label,
    hint: CLIENTS[id].hint,
  }));
  const clientIds = await picker.multiselect("Pick the MCP client(s) to install into:", items);

  for (const clientId of clientIds) {
    installClient(clientId, { ...opts, env });
  }
}

async function interactiveLogin(opts, streams = {}) {
  if (opts.apiUrl && opts.apiKey) {
    return { apiUrl: opts.apiUrl, apiKey: opts.apiKey, warn: false };
  }
  if (process.env.SUITEST_API_URL && process.env.SUITEST_API_KEY) {
    return {
      apiUrl: process.env.SUITEST_API_URL,
      apiKey: process.env.SUITEST_API_KEY,
      warn: false,
    };
  }

  const saved = creds.loadCreds();

  let wantLogin;
  for (;;) {
    try {
      wantLogin = await picker.confirm("Set up Suitest login now?", { default: "yes" }, streams);
    } catch (err) {
      if (err.code !== "BACK") throw err;
      continue;
    }
    if (!wantLogin) return { ...creds.PLACEHOLDER, warn: true };

    if (!saved) break;

    let useExisting;
    try {
      useExisting = await picker.confirm(
        `Saved credentials found (${saved.apiUrl}) — use them?`,
        { default: "yes" },
        streams,
      );
    } catch (err) {
      if (err.code === "BACK") continue;
      throw err;
    }
    if (useExisting) return { ...saved, warn: false };
    break;
  }

  const entered = await creds.promptCreds(saved || {});
  if (!entered) {
    throw new Error("login cancelled — both URL and key are required.");
  }
  creds.saveCreds(entered);
  process.stdout.write(`Saved credentials to ${creds.credsPath()} (chmod 600).\n\n`);
  return { ...entered, warn: false };
}

// --- arg parsing + entrypoints -------------------------------------------

function parseArgs(argv) {
  const out = {
    client: null,
    name: "suitest",
    scope: "global",
    print: false,
    dryRun: false,
    force: false,
    apiUrl: undefined,
    apiKey: undefined,
    config: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--client":
        out.client = argv[++i];
        break;
      case "--name":
        out.name = argv[++i];
        break;
      case "--scope":
        out.scope = argv[++i];
        break;
      case "--config":
        out.config = argv[++i];
        break;
      case "--api-url":
        out.apiUrl = argv[++i];
        break;
      case "--api-key":
        out.apiKey = argv[++i];
        break;
      case "--print":
        out.print = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--force":
        out.force = true;
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

async function handleInstall(argv) {
  const opts = parseArgs(argv);
  if (!opts.client) {
    return runInteractive(opts);
  }
  if (!CLIENTS[opts.client]) {
    throw new Error(
      `unknown --client '${opts.client}'. Choose from: ${CLIENT_ORDER.join(", ")}`,
    );
  }
  const resolved = await creds.resolveCreds(opts);
  if (resolved.warn) {
    process.stderr.write(
      "[warn] No credentials — writing placeholders. Run `suitest-mcp login` or pass --api-url/--api-key.\n",
    );
  }
  const env = {
    SUITEST_API_URL: resolved.apiUrl,
    SUITEST_API_KEY: resolved.apiKey,
  };
  installClient(opts.client, { ...opts, env });
}

async function handleLogin() {
  if (!process.stdin.isTTY) {
    throw new Error(
      "login needs a TTY. Non-interactive? Pass --api-url/--api-key to install, or set SUITEST_API_URL/KEY.",
    );
  }
  const existing = creds.loadCreds() || {};
  const entered = await creds.promptCreds(existing);
  if (!entered) {
    throw new Error("login cancelled — both URL and key are required.");
  }
  const p = creds.saveCreds(entered);
  process.stdout.write(`Saved credentials to ${p} (chmod 600).\n`);
}

function handleDoctor(argv) {
  const opts = parseArgs(argv);
  doctor(opts.client || null);
}

module.exports = {
  CLIENTS,
  CLIENT_ORDER,
  serverSpec,
  installClient,
  interactiveLogin,
  parseArgs,
  handleInstall,
  handleLogin,
  handleDoctor,
};
