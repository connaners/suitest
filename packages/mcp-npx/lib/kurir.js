"use strict";

/**
 * Bridge module for integrating with Kurir (github.com/suiflex/kurir).
 * Handles locating Kurir binary/CLI and executing harness registrations.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function resolveKurir() {
  if (process.env.KURIR_BIN) {
    try {
      fs.accessSync(process.env.KURIR_BIN, fs.constants.X_OK);
      return { type: "bin", command: process.env.KURIR_BIN, args: [] };
    } catch {
      // Invalid KURIR_BIN, continue resolving
    }
  }

  // 1. Check if @suiflex/kurir package is available in node_modules
  try {
    const kurirPkgJson = require.resolve("@suiflex/kurir/package.json");
    const kurirDir = path.dirname(kurirPkgJson);
    const kurirBinJs = path.join(kurirDir, "bin", "kurir.js");
    if (fs.existsSync(kurirBinJs)) {
      return { type: "node", command: process.execPath, args: [kurirBinJs] };
    }
  } catch {
    // Not resolvable via require.resolve
  }

  // 2. Check local vendor/node_modules directory fallback
  const localVendor = path.join(__dirname, "..", "node_modules", "@suiflex", "kurir", "bin", "kurir.js");
  if (fs.existsSync(localVendor)) {
    return { type: "node", command: process.execPath, args: [localVendor] };
  }

  // 3. Check kurir on PATH
  const lookup = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(lookup, ["kurir"], { encoding: "utf8" });
  if (found.status === 0 && found.stdout) {
    const lines = found.stdout.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        return { type: "bin", command: line, args: [] };
      }
    }
  }

  // 4. Fallback to npx @suiflex/kurir
  return { type: "npx", command: "npx", args: ["-y", "@suiflex/kurir"] };
}

function execKurir(args, options = {}) {
  const runner = resolveKurir();
  const fullArgs = [...runner.args, ...args];
  const res = spawnSync(runner.command, fullArgs, {
    cwd: options.cwd || process.cwd(),
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: "utf8",
    stdio: options.stdio || ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  return res;
}

function registerServer({
  client,
  name = "suitest",
  command = "npx",
  args = ["-y", "@suiflex/suitest-mcp"],
  env = {},
  scope,
  config,
  cwd,
  force,
  print,
  dryRun,
  transport = "stdio",
  url,
  headers,
}) {
  const kurirArgs = ["register", "--client", client, "--name", name];

  if (transport && transport !== "stdio") {
    kurirArgs.push("--transport", transport);
    if (url) kurirArgs.push("--url", url);
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        kurirArgs.push("--header", `${k}=${v}`);
      }
    }
  } else {
    kurirArgs.push("--command", command);
    for (const a of args) {
      kurirArgs.push(`--arg=${a}`);
    }
  }

  if (env) {
    for (const [k, v] of Object.entries(env)) {
      kurirArgs.push("--env", `${k}=${v}`);
    }
  }

  if (scope) kurirArgs.push("--scope", scope);
  if (config) kurirArgs.push("--config", config);
  if (cwd) kurirArgs.push("--cwd", cwd);
  if (force) kurirArgs.push("--force");
  if (print) kurirArgs.push("--print");
  if (dryRun) kurirArgs.push("--dry-run");

  return execKurir(kurirArgs, { cwd });
}

function runDoctor(client) {
  const args = ["doctor"];
  if (client) args.push("--client", client);
  return execKurir(args, { stdio: "inherit" });
}

function listClients() {
  return execKurir(["clients"]);
}

module.exports = {
  resolveKurir,
  execKurir,
  registerServer,
  runDoctor,
  listClients,
};
