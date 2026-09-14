#!/usr/bin/env node
/**
 * Installer unit checks — exercises Kurir-backed registration, spec shape,
 * idempotency, config redirects, and interactive login flows.
 */

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");

const install = require("../lib/install.js");
const creds = require("../lib/creds.js");
const { multiselect } = require("../lib/picker.js");

const KEY_ESC = "\x1b";
const KEY_ENTER = "\r";
const KEY_DOWN = "\x1b[B";
const KEY_SPACE = " ";

const ENV = { SUITEST_API_URL: "http://localhost:4000", SUITEST_API_KEY: "sk_test" };

function tmp(name) {
  const p = path.join(
    os.tmpdir(),
    `suitest-mcp-test-${process.pid}-${name}`,
  );
  fs.rmSync(p, { recursive: true, force: true });
  return p;
}

function silence(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = orig;
  }
}

// 1. serverSpec shape (default mcpServers client)
{
  const { entry, snippet } = install.serverSpec("claude-code", ENV);
  assert.strictEqual(entry.command, "npx");
  assert.deepStrictEqual(entry.args, ["-y", "@suiflex/suitest-mcp"]);
  assert.deepStrictEqual(entry.env, ENV);
  assert.ok(snippet.mcpServers.suitest, "snippet has mcpServers.suitest");
}

// 2. opencode variant uses `mcp` + command array + environment
{
  const { entry, snippet } = install.serverSpec("opencode", ENV);
  assert.strictEqual(entry.type, "local");
  assert.deepStrictEqual(entry.command, ["npx", "-y", "@suiflex/suitest-mcp"]);
  assert.deepStrictEqual(entry.environment, ENV);
  assert.ok(snippet.mcp.suitest, "snippet has mcp.suitest");
}

// 3. Antigravity registration via Kurir
{
  const target = tmp("antigravity.json");
  process.env.ANTIGRAVITY_CONFIG = target;
  silence(() =>
    install.installClient("antigravity", {
      name: "suitest",
      scope: "global",
      env: ENV,
      config: target,
      force: true,
    }),
  );
  const written = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.ok(written.mcpServers.suitest, "written mcpServers.suitest");
  assert.strictEqual(written.mcpServers.suitest.command, "npx");
  assert.strictEqual(written.mcpServers.suitest.env.SUITEST_API_KEY, "sk_test");
  fs.rmSync(target, { force: true });
  delete process.env.ANTIGRAVITY_CONFIG;
}

// 4. OpenClaw registration via Kurir
{
  const target = tmp("openclaw.json");
  process.env.OPENCLAW_CONFIG = target;
  fs.writeFileSync(
    target,
    JSON.stringify({ mcp: { servers: { docs: { url: "https://example.test" } } } }),
  );
  silence(() =>
    install.installClient("openclaw", {
      name: "suitest",
      scope: "global",
      env: ENV,
      config: target,
      force: true,
    }),
  );
  const written = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.strictEqual(written.mcp.servers.docs.url, "https://example.test");
  assert.ok(written.mcp.servers.suitest, "written mcp.servers.suitest");
  fs.rmSync(target, { force: true });
  delete process.env.OPENCLAW_CONFIG;
}

// 5. Write into claude-code config, idempotency + conflict handling
{
  const target = tmp("claude.json");
  process.env.CLAUDE_CODE_CONFIG = target;
  const opts = {
    name: "suitest",
    scope: "global",
    env: ENV,
    config: target,
    print: false,
    dryRun: false,
    force: false,
  };

  silence(() => install.installClient("claude-code", opts));
  const written = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.strictEqual(written.mcpServers.suitest.command, "npx");

  // second identical run is a no-op / success
  silence(() => install.installClient("claude-code", opts));

  // different env without force throws or replaces with --force
  const conflict = { ...opts, env: { ...ENV, SUITEST_API_KEY: "sk_other" }, force: true };
  silence(() => install.installClient("claude-code", conflict));
  const after = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.strictEqual(after.mcpServers.suitest.env.SUITEST_API_KEY, "sk_other");

  fs.rmSync(target, { force: true });
  fs.rmSync(`${target}.bak`, { force: true });
  delete process.env.CLAUDE_CODE_CONFIG;
}

// 6. credsPath honours XDG_CONFIG_HOME
{
  const prev = process.env.XDG_CONFIG_HOME;
  const prevDir = process.env.SUITEST_CONFIG_DIR;
  delete process.env.SUITEST_CONFIG_DIR;
  process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
  assert.strictEqual(
    creds.credsPath(),
    path.join("/tmp/xdg-test", "suitest", "credentials.json"),
  );
  if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prev;
  if (prevDir !== undefined) process.env.SUITEST_CONFIG_DIR = prevDir;
}

// 7. interactiveLogin: Esc on "use saved creds?" goes back to "log in now?"
(async () => {
  const prevDir = process.env.SUITEST_CONFIG_DIR;
  const dir = tmp("interactive-login-back");
  process.env.SUITEST_CONFIG_DIR = dir;
  creds.saveCreds({ apiUrl: "http://127.0.0.1:4000", apiKey: "sk_saved" });

  const input = new PassThrough();
  const output = new PassThrough();
  output.on("data", () => {});

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const p = install.interactiveLogin({}, { input, output });
  await delay(20);
  input.write(KEY_ENTER); // "log in now?" -> Yes (default)
  await delay(20);
  input.write(KEY_ESC); // "use saved creds?" -> back
  await delay(600);
  input.write(KEY_ENTER); // "log in now?" again -> Yes
  await delay(20);
  input.write(KEY_ENTER); // "use saved creds?" -> Yes (default)

  const resolved = await p;
  assert.strictEqual(resolved.apiUrl, "http://127.0.0.1:4000");
  assert.strictEqual(resolved.apiKey, "sk_saved");
  assert.strictEqual(resolved.warn, false);

  fs.rmSync(dir, { recursive: true, force: true });
  if (prevDir === undefined) delete process.env.SUITEST_CONFIG_DIR;
  else process.env.SUITEST_CONFIG_DIR = prevDir;

  // 8. multiselect() -> install into picked clients
  {
    const claudeTarget = tmp("multi-client-claude.json");
    const cursorTarget = tmp("multi-client-cursor.json");
    const prevClaude = process.env.CLAUDE_CODE_CONFIG;
    const prevCursor = process.env.CURSOR_CONFIG;
    process.env.CLAUDE_CODE_CONFIG = claudeTarget;
    process.env.CURSOR_CONFIG = cursorTarget;

    const items = install.CLIENT_ORDER.map((id) => ({
      value: id,
      label: install.CLIENTS[id].label,
      hint: install.CLIENTS[id].hint,
    }));

    const mInput = new PassThrough();
    const mOutput = new PassThrough();
    mOutput.on("data", () => {});
    const picked = multiselect("Pick the MCP client(s) to install into:", items, {
      input: mInput,
      output: mOutput,
    });
    await delay(20);
    mInput.write(KEY_SPACE); // check claude-code
    await delay(20);
    mInput.write(KEY_DOWN);
    await delay(20);
    mInput.write(KEY_DOWN); // cursor
    await delay(20);
    mInput.write(KEY_SPACE); // check cursor
    await delay(20);
    mInput.write(KEY_ENTER);

    const clientIds = await picked;
    assert.deepStrictEqual(clientIds.sort(), ["claude-code", "cursor"]);

    for (const clientId of clientIds) {
      silence(() =>
        install.installClient(clientId, {
          name: "suitest",
          scope: "global",
          env: ENV,
          config: clientId === "claude-code" ? claudeTarget : cursorTarget,
          force: true,
        }),
      );
    }
    assert.ok(fs.existsSync(claudeTarget), "expected claude-code config to be written");
    assert.ok(fs.existsSync(cursorTarget), "expected cursor config to be written");

    fs.rmSync(claudeTarget, { force: true });
    fs.rmSync(cursorTarget, { force: true });
    if (prevClaude === undefined) delete process.env.CLAUDE_CODE_CONFIG;
    else process.env.CLAUDE_CODE_CONFIG = prevClaude;
    if (prevCursor === undefined) delete process.env.CURSOR_CONFIG;
    else process.env.CURSOR_CONFIG = prevCursor;
  }

  process.stdout.write("install.test.js OK\n");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
