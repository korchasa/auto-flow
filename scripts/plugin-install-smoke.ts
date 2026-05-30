#!/usr/bin/env -S deno run -A
/**
 * @module
 * Publish-shape plugin install smoke for Claude Code and Codex.
 *
 * The runner keeps all host state under temporary homes, installs the
 * official marketplace name, probes the installed plugin cache, and validates
 * MCP plus optional hook payloads.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  resolve,
  SEPARATOR,
} from "@std/path";
import {
  type BuildPayloadOptions,
  buildPluginPayload,
  type BuildResult,
} from "./build-plugin-payload.ts";

export type HostKind = "claude" | "codex";

export const OFFICIAL_MARKETPLACE_NAME = "flowai-workflow";

export const EXPECTED_MCP_TOOL_NAMES = [
  "apply_workflow_patch",
  "cancel_run",
  "get_state",
  "get_workflow",
  "list_runs",
  "resume_node",
  "tail_artifacts",
] as const;

const MCP_STARTUP_TIMEOUT_MS = 90_000;
const MCP_TOOLS_LIST_TIMEOUT_MS = 10_000;

export interface SmokeCommandOutput {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export type SmokeRunCommand = (
  command: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    cwd?: string;
    stdin?: string;
  },
) => Promise<SmokeCommandOutput>;

export interface McpProbeRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  startupTimeoutMs?: number;
  toolsListTimeoutMs?: number;
}

export interface McpProbeResult {
  serverName: string;
  tools: string[];
}

export type McpProbe = (request: McpProbeRequest) => Promise<McpProbeResult>;

export type SmokeReporter = (message: string) => void;

export interface HostSmokeResult {
  host: HostKind;
  status: "passed" | "skipped";
  hostHome?: string;
  pluginDataDir?: string;
  pluginRoot?: string;
  reason?: string;
}

export interface PluginInstallSmokeResult {
  payloadDir: string;
  hosts: HostSmokeResult[];
}

export interface InstallSmokeOptions {
  engineRoot?: string;
  version?: string;
  payloadDir?: string;
  host?: HostKind | "all";
  allowMissingHostCli?: boolean;
  skipHostCliInstall?: boolean;
  runCommand?: SmokeRunCommand;
  probeMcp?: McpProbe;
  buildPayload?: (opts: BuildPayloadOptions) => Promise<BuildResult>;
  makeTempDir?: (prefix: string) => Promise<string>;
  reporter?: SmokeReporter;
}

interface HostInstallOptions {
  host: HostKind;
  payloadDir: string;
  allowMissingHostCli: boolean;
  skipHostCliInstall: boolean;
  runCommand?: SmokeRunCommand;
  probeMcp?: McpProbe;
  makeTempDir?: (prefix: string) => Promise<string>;
  reporter?: SmokeReporter;
}

interface DiscoverInstalledRootOptions {
  host: HostKind;
  hostHome: string;
  installOutputs: string[];
  reporter?: SmokeReporter;
}

interface HookCommand {
  command: string;
  args: string[];
  allowPathExecutable: boolean;
}

interface HookSmokeOptions {
  host: HostKind;
  pluginRoot: string;
  pluginDataDir: string;
  runCommand?: SmokeRunCommand;
  reporter?: SmokeReporter;
}

interface HookSmokeResult {
  status: "validated" | "no hooks declared";
  commands: number;
}

async function defaultRunCommand(
  command: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    cwd?: string;
    stdin?: string;
  },
): Promise<SmokeCommandOutput> {
  const child = new Deno.Command(command, {
    args,
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (opts.stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
  }
  const output = await child.output();
  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

function report(reporter: SmokeReporter | undefined, message: string): void {
  reporter?.(`[plugin-install-smoke] ${message}`);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function reportOutput(
  reporter: SmokeReporter | undefined,
  stream: "stdout" | "stderr",
  text: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  for (const line of trimmed.split(/\r?\n/)) {
    report(reporter, `${stream}: ${line}`);
  }
}

async function runEvidenceCommand(
  runCommand: SmokeRunCommand,
  command: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    cwd?: string;
    stdin?: string;
    reporter?: SmokeReporter;
  },
): Promise<SmokeCommandOutput> {
  const cwd = opts.cwd ? ` (cwd=${opts.cwd})` : "";
  report(opts.reporter, `$ ${formatCommand(command, args)}${cwd}`);
  if (opts.stdin !== undefined) {
    report(opts.reporter, `stdin: ${opts.stdin.trim()}`);
  }
  const output = await runCommand(command, args, opts);
  report(opts.reporter, `exit code: ${output.code}`);
  reportOutput(opts.reporter, "stdout", output.stdout);
  reportOutput(opts.reporter, "stderr", output.stderr);
  return output;
}

function readEngineVersion(root: string): string {
  const json = JSON.parse(Deno.readTextFileSync(join(root, "deno.json"))) as {
    version?: unknown;
  };
  if (typeof json.version !== "string" || json.version.length === 0) {
    throw new Error(`${join(root, "deno.json")} is missing version.`);
  }
  return json.version;
}

function scriptEngineRoot(): string {
  return fromFileUrl(new URL("..", import.meta.url));
}

function hostsFromOption(host: HostKind | "all" | undefined): HostKind[] {
  if (host === "claude") return ["claude"];
  if (host === "codex") return ["codex"];
  return ["claude", "codex"];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function ensurePayload(
  opts: InstallSmokeOptions,
  makeTempDir: (prefix: string) => Promise<string>,
): Promise<string> {
  if (opts.payloadDir) {
    const resolved = resolve(opts.payloadDir);
    await Deno.stat(resolved);
    report(opts.reporter, `payload: using existing directory ${resolved}`);
    return resolved;
  }
  const engineRoot = resolve(opts.engineRoot ?? scriptEngineRoot());
  const version = opts.version ?? readEngineVersion(engineRoot);
  const outDir = await makeTempDir("flowai-plugin-payload-");
  report(
    opts.reporter,
    `payload: building from ${engineRoot} version ${version} into ${outDir}`,
  );
  const result = await (opts.buildPayload ?? buildPluginPayload)({
    engineRoot,
    version,
    outDir,
    marketplaceName: OFFICIAL_MARKETPLACE_NAME,
  });
  report(
    opts.reporter,
    `payload: wrote ${result.filesWritten.length} files, updated ${result.manifestsUpdated.length} manifests`,
  );
  return outDir;
}

function hostPayloadRoot(payloadDir: string, host: HostKind): string {
  return join(payloadDir, host);
}

function hostPluginRoot(payloadDir: string, host: HostKind): string {
  return join(hostPayloadRoot(payloadDir, host), "plugins", "flowai-workflow");
}

function hostCommand(host: HostKind): string {
  return host === "claude" ? "claude" : "codex";
}

function hostDataEnv(
  host: HostKind,
  hostHome: string,
): Record<string, string> {
  const base = Deno.env.toObject();
  const dataRoot = join(hostHome, "plugin-data", host);
  return {
    ...base,
    HOME: hostHome,
    CODEX_HOME: join(hostHome, ".codex"),
    CLAUDE_CONFIG_DIR: join(hostHome, ".claude"),
    PLUGIN_DATA: dataRoot,
    FLOWAI_PLUGIN_DATA: dataRoot,
    CLAUDE_PLUGIN_DATA: dataRoot,
  };
}

function installCommands(host: HostKind, payloadDir: string): string[][] {
  const root = hostPayloadRoot(payloadDir, host);
  if (host === "codex") {
    return [
      ["plugin", "marketplace", "add", root],
      ["plugin", "add", "flowai-workflow@flowai-workflow"],
    ];
  }
  return [
    ["plugin", "marketplace", "add", root],
    ["plugin", "install", "flowai-workflow@flowai-workflow", "--scope", "user"],
  ];
}

async function assertHostCliAvailable(
  host: HostKind,
  runCommand: SmokeRunCommand,
  env: Record<string, string>,
  allowMissing: boolean,
  reporter?: SmokeReporter,
): Promise<HostSmokeResult | null> {
  try {
    report(reporter, `${host}: checking required host CLI`);
    const result = await runEvidenceCommand(
      runCommand,
      hostCommand(host),
      ["--version"],
      { env, reporter },
    );
    if (result.success) return null;
    throw new Error(
      `required host CLI \`${hostCommand(host)}\` version probe failed: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      const reason = `required host CLI \`${hostCommand(host)}\` was not found`;
      if (allowMissing) return { host, status: "skipped", reason };
      throw new Error(`${reason}.`);
    }
    throw error;
  }
}

function candidateManifestPath(host: HostKind, root: string): string {
  return host === "claude"
    ? join(root, ".claude-plugin", "plugin.json")
    : join(root, ".codex-plugin", "plugin.json");
}

async function isPluginRoot(host: HostKind, path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    if (!stat.isDirectory) return false;
    if (await pathExists(candidateManifestPath(host, path))) return true;
    return await pathExists(join(path, ".mcp.json"));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function extractAbsolutePaths(text: string): string[] {
  return text.match(/\/[^\s"'`]+/g)?.map((path) =>
    path.replace(/[),.;:]+$/, "")
  ) ?? [];
}

async function findCandidateRoots(
  host: HostKind,
  root: string,
): Promise<string[]> {
  const candidates: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(dir)) entries.push(entry);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (!entry.isDirectory) continue;
      if (await isPluginRoot(host, path)) {
        candidates.push(path);
      }
      await walk(path);
    }
  }
  await walk(root);
  return [...new Set(candidates)].sort();
}

export async function discoverInstalledPluginRoot(
  opts: DiscoverInstalledRootOptions,
): Promise<string> {
  report(
    opts.reporter,
    `${opts.host}: discovering installed plugin root under ${opts.hostHome}`,
  );
  const outputCandidates = opts.installOutputs.flatMap(extractAbsolutePaths);
  for (const candidate of outputCandidates) {
    if (await isPluginRoot(opts.host, candidate)) {
      report(
        opts.reporter,
        `${opts.host}: plugin root discovered from CLI output: ${candidate}`,
      );
      return candidate;
    }
  }

  const candidates = await findCandidateRoots(opts.host, opts.hostHome);
  if (candidates.length === 1) {
    report(
      opts.reporter,
      `${opts.host}: plugin root discovered by cache scan: ${candidates[0]}`,
    );
    return candidates[0];
  }
  if (candidates.length > 1) {
    throw new Error(
      `ambiguous installed flowai-workflow plugin roots under ${opts.hostHome}: ${
        candidates.join(", ")
      }`,
    );
  }
  throw new Error(
    `could not discover installed flowai-workflow plugin root under ${opts.hostHome}`,
  );
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) || !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return [...value];
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

function interpolate(value: string, env: Record<string, string>): string {
  return value.replace(
    /\$\{([A-Z0-9_]+)\}/g,
    (_match, name: string) => env[name] ?? "",
  );
}

function mcpServerMap(config: unknown): Record<string, unknown> {
  const root = asRecord(config, "MCP config");
  return asRecord(root.mcpServers ?? root.mcp_servers ?? root, "MCP servers");
}

function mcpEnv(
  host: HostKind,
  pluginRoot: string,
  pluginDataDir: string,
  declared: Record<string, unknown>,
): Record<string, string> {
  const base = {
    ...Deno.env.toObject(),
    HOME: pluginDataDir,
    CODEX_HOME: pluginDataDir,
    PLUGIN_ROOT: pluginRoot,
    PLUGIN_DATA: pluginDataDir,
    FLOWAI_PLUGIN_DATA: pluginDataDir,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PLUGIN_DATA: pluginDataDir,
  };
  const result: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value !== "string") {
      throw new Error(`MCP env ${key} must be a string.`);
    }
    result[key] = interpolate(value, result);
  }
  if (host === "claude") result.CLAUDE_PLUGIN_ROOT = pluginRoot;
  return result;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function defaultProbeMcp(
  request: McpProbeRequest,
): Promise<McpProbeResult> {
  const transport = new StdioClientTransport({
    command: request.command,
    args: request.args,
    cwd: request.cwd,
    env: request.env,
    stderr: "pipe",
  });
  const client = new Client({
    name: "flowai-plugin-smoke",
    version: "0.0.0",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  try {
    await withTimeout(
      client.connect(transport),
      request.startupTimeoutMs ?? MCP_STARTUP_TIMEOUT_MS,
      "MCP initialize",
    );
    const serverName = client.getServerVersion()?.name ?? "";
    if (serverName !== "flowai-workflow") {
      throw new Error(
        `MCP server name mismatch: expected flowai-workflow, got ${
          serverName || "<missing>"
        }.`,
      );
    }
    const capabilities = client.getServerCapabilities();
    if (!capabilities?.tools) {
      throw new Error(
        "MCP initialize response did not advertise tools capability.",
      );
    }
    const tools = await withTimeout(
      client.listTools(),
      request.toolsListTimeoutMs ?? MCP_TOOLS_LIST_TIMEOUT_MS,
      "MCP tools/list",
    ) as { tools: Array<{ name: string }> };
    return {
      serverName,
      tools: tools.tools.map((tool) => tool.name).sort(),
    };
  } catch (error) {
    const suffix = stderr.trim() ? ` stderr: ${stderr.trim()}` : "";
    throw new Error(
      `MCP probe failed for ${request.command} ${
        request.args.join(" ")
      } (cwd=${request.cwd}). ${(error as Error).message}${suffix}`,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

export async function probeInstalledMcp(opts: {
  host: HostKind;
  pluginRoot: string;
  pluginDataDir: string;
  probeMcp?: McpProbe;
  reporter?: SmokeReporter;
}): Promise<McpProbeResult> {
  const mcpPath = join(opts.pluginRoot, ".mcp.json");
  report(opts.reporter, `${opts.host}: reading MCP config ${mcpPath}`);
  const server = asRecord(
    mcpServerMap(await readJson(mcpPath))["flowai-workflow"],
    "flowai-workflow MCP server",
  );
  if (typeof server.command !== "string") {
    throw new Error(`${mcpPath}: flowai-workflow.command must be a string.`);
  }
  const declaredEnv = asRecord(server.env ?? {}, "MCP env");
  const env = mcpEnv(
    opts.host,
    opts.pluginRoot,
    opts.pluginDataDir,
    declaredEnv,
  );
  const cwdRaw = typeof server.cwd === "string"
    ? interpolate(server.cwd, env)
    : ".";
  const cwd = isAbsolute(cwdRaw) ? cwdRaw : join(opts.pluginRoot, cwdRaw);
  const request: McpProbeRequest = {
    command: interpolate(server.command, env),
    args: optionalStringArray(server.args, "MCP args").map((arg) =>
      interpolate(arg, env)
    ),
    cwd,
    env,
    startupTimeoutMs: MCP_STARTUP_TIMEOUT_MS,
    toolsListTimeoutMs: MCP_TOOLS_LIST_TIMEOUT_MS,
  };
  report(
    opts.reporter,
    `${opts.host}: MCP command: ${
      formatCommand(request.command, request.args)
    } (cwd=${request.cwd})`,
  );
  report(
    opts.reporter,
    `${opts.host}: MCP expected tools: ${EXPECTED_MCP_TOOL_NAMES.join(", ")}`,
  );
  report(
    opts.reporter,
    `${opts.host}: MCP check: initialize over stdio, require tools capability, call tools/list`,
  );
  const result = await (opts.probeMcp ?? defaultProbeMcp)(request);
  report(opts.reporter, `${opts.host}: MCP server name: ${result.serverName}`);
  report(
    opts.reporter,
    `${opts.host}: MCP returned tools: ${result.tools.join(", ")}`,
  );
  if (result.serverName !== "flowai-workflow") {
    throw new Error(
      `MCP server name mismatch: expected flowai-workflow, got ${result.serverName}.`,
    );
  }
  const tools = new Set(result.tools);
  const missing = EXPECTED_MCP_TOOL_NAMES.filter((name) => !tools.has(name));
  if (missing.length > 0) {
    throw new Error(
      `MCP tools/list missing expected tools: ${missing.join(", ")}`,
    );
  }
  report(opts.reporter, `${opts.host}: MCP tool check passed`);
  return result;
}

function parseHookCommands(value: unknown): HookCommand[] {
  const commands: HookCommand[] = [];
  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record.command === "string") {
      commands.push({
        command: record.command,
        args: optionalStringArray(record.args, "hook args"),
        allowPathExecutable: record.allow_path_executable === true ||
          record.allowPathExecutable === true,
      });
    }
    for (const value of Object.values(record)) visit(value);
  }
  visit(value);
  return commands;
}

export function resolveCommandHookPath(
  pluginRoot: string,
  command: string,
  allowPathExecutable = false,
): string {
  if (!command.includes("/") && !command.includes("\\")) {
    if (allowPathExecutable) return command;
    throw new Error(
      `hook command ${command} is a bare executable; hook file must explicitly allow PATH resolution.`,
    );
  }
  const resolved = isAbsolute(command)
    ? normalize(command)
    : normalize(join(pluginRoot, command));
  const normalizedRoot = normalize(pluginRoot);
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(`${normalizedRoot}${SEPARATOR}`)
  ) {
    throw new Error(
      `hook command ${command} escapes plugin root ${pluginRoot}.`,
    );
  }
  return resolved;
}

async function hookSources(
  pluginRoot: string,
  host: HostKind,
): Promise<unknown[]> {
  const sources: unknown[] = [];
  const hooksPath = join(pluginRoot, "hooks", "hooks.json");
  if (await pathExists(hooksPath)) sources.push(await readJson(hooksPath));
  const manifestPath = candidateManifestPath(host, pluginRoot);
  if (await pathExists(manifestPath)) {
    const manifest = asRecord(await readJson(manifestPath), "plugin manifest");
    if (typeof manifest.hooks === "string") {
      const hooksFile = isAbsolute(manifest.hooks)
        ? manifest.hooks
        : join(pluginRoot, manifest.hooks);
      sources.push(await readJson(hooksFile));
    } else if (manifest.hooks !== undefined) {
      sources.push(manifest.hooks);
    }
  }
  return sources;
}

export async function runHookSmoke(
  opts: HookSmokeOptions,
): Promise<HookSmokeResult> {
  const sources = await hookSources(opts.pluginRoot, opts.host);
  if (sources.length === 0) {
    report(opts.reporter, `${opts.host}: no hooks declared`);
    return { status: "no hooks declared", commands: 0 };
  }
  const commands = sources.flatMap(parseHookCommands);
  report(
    opts.reporter,
    `${opts.host}: validating ${commands.length} hook command(s) from ${sources.length} hook source(s)`,
  );
  const env = {
    ...Deno.env.toObject(),
    HOME: opts.pluginDataDir,
    CODEX_HOME: opts.pluginDataDir,
    PLUGIN_ROOT: opts.pluginRoot,
    PLUGIN_DATA: opts.pluginDataDir,
    FLOWAI_PLUGIN_DATA: opts.pluginDataDir,
    CLAUDE_PLUGIN_ROOT: opts.pluginRoot,
    CLAUDE_PLUGIN_DATA: opts.pluginDataDir,
  };
  const runCommand = opts.runCommand ?? defaultRunCommand;
  for (const hook of commands) {
    const command = resolveCommandHookPath(
      opts.pluginRoot,
      hook.command,
      hook.allowPathExecutable,
    );
    const result = await runEvidenceCommand(runCommand, command, hook.args, {
      env,
      cwd: opts.pluginRoot,
      stdin: JSON.stringify({
        event: "SessionStart",
        source: "flowai-plugin-smoke",
      }) + "\n",
      reporter: opts.reporter,
    });
    if (!result.success) {
      throw new Error(
        `hook command failed (${result.code}): ${command}. ${
          result.stderr.trim() || result.stdout.trim()
        }`,
      );
    }
  }
  report(opts.reporter, `${opts.host}: hook command check passed`);
  return { status: "validated", commands: commands.length };
}

export async function installPluginForHost(
  opts: HostInstallOptions,
): Promise<HostSmokeResult> {
  const runCommand = opts.runCommand ?? defaultRunCommand;
  const makeTempDir = opts.makeTempDir ??
    ((prefix: string) => Deno.makeTempDir({ prefix }));
  const hostHome = await makeTempDir(`flowai-${opts.host}-home-`);
  await Deno.mkdir(hostHome, { recursive: true });
  const env = hostDataEnv(opts.host, hostHome);
  await Deno.mkdir(env.CODEX_HOME, { recursive: true });
  await Deno.mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
  await Deno.mkdir(env.FLOWAI_PLUGIN_DATA, { recursive: true });
  report(opts.reporter, `${opts.host}: isolated HOME=${hostHome}`);
  report(
    opts.reporter,
    `${opts.host}: host state dirs CODEX_HOME=${env.CODEX_HOME} CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR} FLOWAI_PLUGIN_DATA=${env.FLOWAI_PLUGIN_DATA}`,
  );

  let pluginRoot = hostPluginRoot(opts.payloadDir, opts.host);
  if (!opts.skipHostCliInstall) {
    const unavailable = await assertHostCliAvailable(
      opts.host,
      runCommand,
      env,
      opts.allowMissingHostCli,
      opts.reporter,
    );
    if (unavailable) return unavailable;

    const outputs: string[] = [];
    for (const args of installCommands(opts.host, opts.payloadDir)) {
      const output = await runEvidenceCommand(
        runCommand,
        hostCommand(opts.host),
        args,
        { env, reporter: opts.reporter },
      );
      outputs.push(output.stdout, output.stderr);
      if (!output.success) {
        throw new Error(
          `${hostCommand(opts.host)} ${
            args.join(" ")
          } failed (${output.code}): ${
            output.stderr.trim() || output.stdout.trim()
          }`,
        );
      }
    }
    pluginRoot = await discoverInstalledPluginRoot({
      host: opts.host,
      hostHome,
      installOutputs: outputs,
      reporter: opts.reporter,
    });
  } else {
    report(
      opts.reporter,
      `${opts.host}: skipping host CLI install, using payload plugin root ${pluginRoot}`,
    );
  }

  const pluginDataDir = join(hostHome, "plugin-data", opts.host);
  report(opts.reporter, `${opts.host}: plugin data dir ${pluginDataDir}`);
  await probeInstalledMcp({
    host: opts.host,
    pluginRoot,
    pluginDataDir,
    probeMcp: opts.probeMcp,
    reporter: opts.reporter,
  });
  await runHookSmoke({
    host: opts.host,
    pluginRoot,
    pluginDataDir,
    runCommand,
    reporter: opts.reporter,
  });
  report(opts.reporter, `${opts.host}: smoke passed with ${pluginRoot}`);
  return {
    host: opts.host,
    status: "passed",
    hostHome,
    pluginDataDir,
    pluginRoot,
  };
}

export async function runPluginInstallSmoke(
  opts: InstallSmokeOptions,
): Promise<PluginInstallSmokeResult> {
  const makeTempDir = opts.makeTempDir ??
    ((prefix: string) => Deno.makeTempDir({ prefix }));
  const payloadDir = await ensurePayload(opts, makeTempDir);
  const hosts = hostsFromOption(opts.host);
  report(opts.reporter, `hosts under test: ${hosts.join(", ")}`);
  const results: HostSmokeResult[] = [];
  for (const host of hosts) {
    results.push(
      await installPluginForHost({
        host,
        payloadDir,
        allowMissingHostCli: opts.allowMissingHostCli ?? false,
        skipHostCliInstall: opts.skipHostCliInstall ?? false,
        runCommand: opts.runCommand,
        probeMcp: opts.probeMcp,
        makeTempDir,
        reporter: opts.reporter,
      }),
    );
  }
  return { payloadDir, hosts: results };
}

interface ParsedArgs {
  engineRoot: string;
  version?: string;
  payloadDir?: string;
  hosts: HostKind[];
  allowMissingHostCli: boolean;
  skipHostCliInstall: boolean;
}

export function parseInstallSmokeArgs(
  argv: string[],
): ParsedArgs | { help: string } {
  let engineRoot = ".";
  let version: string | undefined;
  let payloadDir: string | undefined;
  let host: HostKind | "all" = "all";
  let allowMissingHostCli = false;
  let skipHostCliInstall = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--":
        break;
      case "--engine-root":
        engineRoot = argv[++i] ?? "";
        break;
      case "--version":
        version = argv[++i] ?? "";
        break;
      case "--payload-dir":
        payloadDir = argv[++i] ?? "";
        break;
      case "--host": {
        const value = argv[++i] ?? "";
        if (value !== "claude" && value !== "codex" && value !== "all") {
          throw new Error("--host must be one of: claude, codex, all.");
        }
        host = value;
        break;
      }
      case "--allow-missing-host-cli":
        allowMissingHostCli = true;
        break;
      case "--skip-host-cli-install":
        skipHostCliInstall = true;
        break;
      case "-h":
      case "--help":
        return {
          help: [
            "Usage: plugin-install-smoke [--payload-dir <dir>] [--engine-root <dir>]",
            "                            [--version <version>] [--host claude|codex|all]",
            "                            [--allow-missing-host-cli] [--skip-host-cli-install]",
          ].join("\n"),
        };
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    engineRoot,
    version,
    payloadDir,
    hosts: hostsFromOption(host),
    allowMissingHostCli,
    skipHostCliInstall,
  };
}

if (import.meta.main) {
  let parsed: ParsedArgs | { help: string };
  try {
    parsed = parseInstallSmokeArgs(Deno.args);
  } catch (error) {
    console.error((error as Error).message);
    Deno.exit(2);
  }
  if ("help" in parsed) {
    console.log(parsed.help);
    Deno.exit(0);
  }
  const result = await runPluginInstallSmoke({
    engineRoot: resolve(parsed.engineRoot),
    version: parsed.version,
    payloadDir: parsed.payloadDir,
    host: parsed.hosts.length === 1 ? parsed.hosts[0] : "all",
    allowMissingHostCli: parsed.allowMissingHostCli,
    skipHostCliInstall: parsed.skipHostCliInstall,
    reporter: console.log,
  });
  for (const host of result.hosts) {
    if (host.status === "skipped") {
      console.log(`${host.host}: skipped (${host.reason})`);
    } else {
      console.log(`${host.host}: passed (${host.pluginRoot})`);
    }
  }
}
