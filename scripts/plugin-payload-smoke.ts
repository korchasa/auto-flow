#!/usr/bin/env -S deno run -A
/**
 * @module
 * Structural smoke checks for the generated Claude Code / Codex plugin
 * payload. This module intentionally avoids host CLI subprocesses; the
 * install smoke in `plugin-install-smoke.ts` owns runtime probing.
 */

import { join, resolve } from "@std/path";

export type PayloadHost = "claude" | "codex";

export interface PayloadHostSmoke {
  host: PayloadHost;
  root: string;
  pluginRoot: string;
  hooks: "declared" | "no hooks declared";
}

export interface PayloadSmokeResult {
  payloadDir: string;
  hosts: PayloadHostSmoke[];
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as unknown;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Missing required JSON file: ${path}`);
    }
    throw new Error(`Malformed JSON in ${path}: ${(error as Error).message}`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function validateMarketplace(
  host: PayloadHost,
  path: string,
  marketplace: unknown,
): void {
  const root = asRecord(marketplace, `${host} marketplace`);
  const name = requireString(root.name, `${host} marketplace name`);
  if (name !== "flowai-workflow") {
    throw new Error(`${path}: marketplace name must be flowai-workflow.`);
  }
  if (!Array.isArray(root.plugins) || root.plugins.length === 0) {
    throw new Error(`${path}: marketplace must declare at least one plugin.`);
  }
  const plugin = asRecord(root.plugins[0], `${host} marketplace plugin`);
  const pluginName = requireString(plugin.name, `${host} plugin name`);
  if (pluginName !== "flowai-workflow") {
    throw new Error(`${path}: first plugin must be flowai-workflow.`);
  }
}

function validateMcp(host: PayloadHost, config: unknown): void {
  const root = asRecord(config, `${host} MCP config`);
  const map = asRecord(
    root.mcpServers ?? root.mcp_servers ?? root,
    `${host} MCP server map`,
  );
  const server = asRecord(
    map["flowai-workflow"],
    `${host} flowai-workflow MCP server`,
  );
  requireString(server.command, `${host} MCP command`);
}

async function validateHost(
  payloadDir: string,
  host: PayloadHost,
): Promise<PayloadHostSmoke> {
  const root = join(payloadDir, host);
  const marketplacePath = host === "claude"
    ? join(root, ".claude-plugin", "marketplace.json")
    : join(root, ".agents", "plugins", "marketplace.json");
  try {
    await Deno.stat(marketplacePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      const label = host === "claude" ? "Claude" : "Codex";
      throw new Error(`missing ${label} marketplace: ${marketplacePath}`);
    }
    throw error;
  }
  validateMarketplace(host, marketplacePath, await readJson(marketplacePath));

  const pluginRoot = join(root, "plugins", "flowai-workflow");
  const manifestPath = host === "claude"
    ? join(pluginRoot, ".claude-plugin", "plugin.json")
    : join(pluginRoot, ".codex-plugin", "plugin.json");
  const manifest = asRecord(
    await readJson(manifestPath),
    `${host} plugin manifest`,
  );
  const pluginName = requireString(manifest.name, `${host} manifest name`);
  if (pluginName !== "flowai-workflow") {
    throw new Error(`${manifestPath}: plugin name must be flowai-workflow.`);
  }

  const mcpPath = join(pluginRoot, ".mcp.json");
  validateMcp(host, await readJson(mcpPath));

  const hooksPath = join(pluginRoot, "hooks", "hooks.json");
  const hooks = await exists(hooksPath) ? "declared" : "no hooks declared";
  if (hooks === "declared") {
    asRecord(await readJson(hooksPath), `${host} hooks`);
  }
  return { host, root, pluginRoot, hooks };
}

export async function validatePluginPayload(
  payloadDir: string,
): Promise<PayloadSmokeResult> {
  const resolved = resolve(payloadDir);
  return {
    payloadDir: resolved,
    hosts: [
      await validateHost(resolved, "claude"),
      await validateHost(resolved, "codex"),
    ],
  };
}

if (import.meta.main) {
  const payloadDir = Deno.args[0] ?? "";
  if (!payloadDir) {
    console.error("Usage: plugin-payload-smoke <payload-dir>");
    Deno.exit(2);
  }
  const result = await validatePluginPayload(payloadDir);
  for (const host of result.hosts) {
    console.log(
      `${host.host}: ${host.pluginRoot} (${host.hooks})`,
    );
  }
}
