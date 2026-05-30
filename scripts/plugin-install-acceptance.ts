#!/usr/bin/env -S deno run -A
/**
 * @module
 * Install acceptance for Claude Code and Codex plugin payloads.
 *
 * The runner keeps all host state under temporary homes, installs the official
 * marketplace name, probes the installed MCP and hook payloads, starts the real
 * host agent, and verifies that the agent used the installed get_workflow tool.
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
const DEFAULT_TIMEOUT_MS = 180_000;
const AGENT_PASS_MARKER = "FLOWAI_INSTALL_ACCEPTANCE_PASS";
const TOOL_EVIDENCE_PATTERN =
  /^(?:mcp__flowai[-_]workflow__get_workflow|mcp__plugin_flowai-workflow_flowai-workflow__get_workflow)$/;
const ACCEPTANCE_WORKFLOW = "github-inbox-opencode-test";
const CLAUDE_GET_WORKFLOW_TOOL_NAME =
  "mcp__plugin_flowai-workflow_flowai-workflow__get_workflow";

export type CodexProvider = "openai" | "openrouter";

export interface InstallCommandOutput {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export type InstallRunCommand = (
  command: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    cwd?: string;
    stdin?: string;
    redactStdin?: boolean;
    timeoutMs?: number;
  },
) => Promise<InstallCommandOutput>;

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

export type InstallReporter = (message: string) => void;

export interface HostInstallResult {
  host: HostKind;
  status: "passed";
  hostHome: string;
  pluginDataDir: string;
  pluginRoot: string;
}

export interface PluginInstallAcceptanceResult {
  payloadDir: string;
  hosts: HostInstallResult[];
}

export interface InstallAcceptanceOptions {
  engineRoot?: string;
  version?: string;
  payloadDir?: string;
  host?: HostKind | "all";
  codexProvider?: CodexProvider;
  timeoutMs?: number;
  runCommand?: InstallRunCommand;
  probeMcp?: McpProbe;
  buildPayload?: (opts: BuildPayloadOptions) => Promise<BuildResult>;
  makeTempDir?: (prefix: string) => Promise<string>;
  reporter?: InstallReporter;
}

interface HostInstallOptions {
  host: HostKind;
  payloadDir: string;
  runCommand?: InstallRunCommand;
  probeMcp?: McpProbe;
  makeTempDir?: (prefix: string) => Promise<string>;
  reporter?: InstallReporter;
}

interface DiscoverInstalledRootOptions {
  host: HostKind;
  hostHome: string;
  installOutputs: string[];
  reporter?: InstallReporter;
}

interface HookCommand {
  command: string;
  args: string[];
  allowPathExecutable: boolean;
}

interface HookAcceptanceOptions {
  host: HostKind;
  pluginRoot: string;
  pluginDataDir: string;
  runCommand?: InstallRunCommand;
  reporter?: InstallReporter;
}

interface HookAcceptanceResult {
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
    redactStdin?: boolean;
    timeoutMs?: number;
  },
): Promise<InstallCommandOutput> {
  const child = new Deno.Command(command, {
    args,
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch {
      // Process may already have exited.
    }
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    if (opts.stdin !== undefined) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(opts.stdin));
      await writer.close();
    }
    const output = await child.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (timedOut) {
      return {
        success: false,
        code: 124,
        stdout,
        stderr: stderr.trim()
          ? `${stderr}\ncommand timed out after ${opts.timeoutMs}ms`
          : `command timed out after ${opts.timeoutMs}ms`,
      };
    }
    return { success: output.success, code: output.code, stdout, stderr };
  } finally {
    clearTimeout(timeoutId);
  }
}

function report(reporter: InstallReporter | undefined, message: string): void {
  reporter?.(`[plugin-install-acceptance] ${message}`);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function reportOutput(
  reporter: InstallReporter | undefined,
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
  runCommand: InstallRunCommand,
  command: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    cwd?: string;
    stdin?: string;
    redactStdin?: boolean;
    timeoutMs?: number;
    reporter?: InstallReporter;
  },
): Promise<InstallCommandOutput> {
  const cwd = opts.cwd ? ` (cwd=${opts.cwd})` : "";
  report(opts.reporter, `$ ${formatCommand(command, args)}${cwd}`);
  if (opts.stdin !== undefined) {
    report(
      opts.reporter,
      `stdin: ${opts.redactStdin ? "<redacted>" : opts.stdin.trim()}`,
    );
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
  opts: InstallAcceptanceOptions,
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
  const outDir = await makeTempDir("flowai-install-acceptance-payload-");
  report(
    opts.reporter,
    `payload: building ${version} from ${engineRoot} into ${outDir}`,
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
  runCommand: InstallRunCommand,
  env: Record<string, string>,
  reporter?: InstallReporter,
): Promise<void> {
  try {
    report(reporter, `${host}: checking required host CLI`);
    const result = await runEvidenceCommand(
      runCommand,
      hostCommand(host),
      ["--version"],
      { env, reporter },
    );
    if (result.success) return;
    throw new Error(
      `required host CLI \`${hostCommand(host)}\` version probe failed: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      const reason = `required host CLI \`${hostCommand(host)}\` was not found`;
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
    name: "flowai-plugin-acceptance",
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
  reporter?: InstallReporter;
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

export async function runHookAcceptance(
  opts: HookAcceptanceOptions,
): Promise<HookAcceptanceResult> {
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
        source: "flowai-plugin-acceptance",
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
): Promise<HostInstallResult> {
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

  await assertHostCliAvailable(
    opts.host,
    runCommand,
    env,
    opts.reporter,
  );

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
        `${hostCommand(opts.host)} ${args.join(" ")} failed (${output.code}): ${
          output.stderr.trim() || output.stdout.trim()
        }`,
      );
    }
  }
  const pluginRoot = await discoverInstalledPluginRoot({
    host: opts.host,
    hostHome,
    installOutputs: outputs,
    reporter: opts.reporter,
  });

  const pluginDataDir = join(hostHome, "plugin-data", opts.host);
  report(opts.reporter, `${opts.host}: plugin data dir ${pluginDataDir}`);
  await probeInstalledMcp({
    host: opts.host,
    pluginRoot,
    pluginDataDir,
    probeMcp: opts.probeMcp,
    reporter: opts.reporter,
  });
  await runHookAcceptance({
    host: opts.host,
    pluginRoot,
    pluginDataDir,
    runCommand,
    reporter: opts.reporter,
  });
  report(
    opts.reporter,
    `${opts.host}: install probe passed with ${pluginRoot}`,
  );
  return {
    host: opts.host,
    status: "passed",
    hostHome,
    pluginDataDir,
    pluginRoot,
  };
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name} for install acceptance.`,
    );
  }
  return value;
}

function requireCodexProvider(
  provider: CodexProvider | undefined,
): CodexProvider {
  if (provider === "openai" || provider === "openrouter") return provider;
  throw new Error(
    "Codex install acceptance requires --codex-provider openai|openrouter.",
  );
}

function hostAgentEnv(
  host: HostKind,
  hostHome: string,
  pluginRoot: string,
): Record<string, string> {
  const dataRoot = join(hostHome, "plugin-data", host);
  const workflowDir = join(
    pluginRoot,
    ".flowai-workflow",
    ACCEPTANCE_WORKFLOW,
  );
  return {
    ...Deno.env.toObject(),
    HOME: hostHome,
    CODEX_HOME: join(hostHome, ".codex"),
    CLAUDE_CONFIG_DIR: join(hostHome, ".claude"),
    PLUGIN_ROOT: pluginRoot,
    PLUGIN_DATA: dataRoot,
    FLOWAI_PLUGIN_DATA: dataRoot,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PLUGIN_DATA: dataRoot,
    FLOWAI_WORKFLOW: workflowDir,
    FLOWAI_SUPPRESS_DEPRECATION: "1",
  };
}

function agentPrompt(host: HostKind): string {
  return [
    "This is a CI acceptance test for the installed flowai-workflow plugin.",
    "Call the installed MCP server flowai-workflow tool get_workflow exactly once.",
    "This must be an MCP tool call, not a shell command or resource-list call.",
    "Do not use shell commands and do not edit files.",
    `After the tool returns, reply with exactly: ${AGENT_PASS_MARKER} host=${host}`,
  ].join(" ");
}

function claudeArgs(pluginRoot: string, prompt: string): string[] {
  const args = [
    "--plugin-dir",
    pluginRoot,
    "--permission-mode",
    "bypassPermissions",
    "--allowedTools",
    CLAUDE_GET_WORKFLOW_TOOL_NAME,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    Deno.env.get("CLAUDE_INSTALL_ACCEPTANCE_MAX_BUDGET_USD") ?? "0.25",
  ];
  const model = Deno.env.get("CLAUDE_INSTALL_ACCEPTANCE_MODEL");
  if (model && model.trim() !== "") args.push("--model", model);
  args.push("-p", prompt);
  return args;
}

function codexArgs(
  prompt: string,
  projectDir: string,
  provider: CodexProvider,
): string[] {
  const args = ["--dangerously-bypass-approvals-and-sandbox"];
  if (provider === "openrouter") {
    const model = requireEnv("CODEX_INSTALL_ACCEPTANCE_MODEL");
    args.push(
      "-c",
      'model_provider="openrouter"',
      "-c",
      `model="${model}"`,
      "-c",
      'model_providers.openrouter.name="OpenRouter"',
      "-c",
      'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"',
      "-c",
      'model_providers.openrouter.env_key="OPENROUTER_API_KEY"',
      "-c",
      'model_providers.openrouter.wire_api="responses"',
    );
  } else {
    const model = Deno.env.get("CODEX_INSTALL_ACCEPTANCE_MODEL");
    if (model && model.trim() !== "") args.push("--model", model);
  }
  args.push(
    "exec",
    "--json",
    "--cd",
    projectDir,
    "--skip-git-repo-check",
    prompt,
  );
  return args;
}

function hasInstalledPluginToolEvidence(output: string): boolean {
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (
      record.type === "tool_use" &&
      typeof record.name === "string" &&
      TOOL_EVIDENCE_PATTERN.test(record.name)
    ) {
      return true;
    }
    if (record.type === "assistant") {
      const message = record.message;
      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;
        if (
          Array.isArray(content) &&
          content.some((entry) =>
            entry &&
            typeof entry === "object" &&
            (entry as Record<string, unknown>).type === "tool_use" &&
            typeof (entry as Record<string, unknown>).name === "string" &&
            TOOL_EVIDENCE_PATTERN.test(
              (entry as Record<string, unknown>).name as string,
            )
          )
        ) {
          return true;
        }
      }
    }
    const item = record.item;
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    if (
      record.type === "item.completed" &&
      itemRecord.type === "mcp_tool_call" &&
      itemRecord.server === "flowai-workflow" &&
      itemRecord.tool === "get_workflow" &&
      itemRecord.error === null &&
      itemRecord.status === "completed"
    ) {
      return true;
    }
  }
  return false;
}

function assertAgentEvidence(
  host: HostKind,
  output: InstallCommandOutput,
): void {
  const combined = `${output.stdout}\n${output.stderr}`;
  if (!output.success) {
    throw new Error(
      `${host} install acceptance failed (${output.code}): ${combined.trim()}`,
    );
  }
  if (!combined.includes(AGENT_PASS_MARKER)) {
    throw new Error(
      `${host} install acceptance did not emit ${AGENT_PASS_MARKER}.`,
    );
  }
  if (!hasInstalledPluginToolEvidence(combined)) {
    throw new Error(
      `${host} install acceptance did not show get_workflow tool evidence.`,
    );
  }
}

async function runHostInstallAcceptance(opts: {
  host: HostKind;
  payloadDir: string;
  codexProvider?: CodexProvider;
  makeTempDir: (prefix: string) => Promise<string>;
  runCommand: InstallRunCommand;
  probeMcp?: McpProbe;
  reporter?: InstallReporter;
  timeoutMs: number;
}): Promise<HostInstallResult> {
  if (opts.host === "claude") requireEnv("CLAUDE_CODE_OAUTH_TOKEN");
  const codexProvider = opts.host === "codex"
    ? requireCodexProvider(opts.codexProvider)
    : undefined;
  if (codexProvider === "openai") requireEnv("OPENAI_API_KEY");
  if (codexProvider === "openrouter") requireEnv("OPENROUTER_API_KEY");

  const installed = await installPluginForHost({
    host: opts.host,
    payloadDir: opts.payloadDir,
    makeTempDir: opts.makeTempDir,
    runCommand: opts.runCommand,
    probeMcp: opts.probeMcp,
    reporter: opts.reporter,
  });

  const env = hostAgentEnv(opts.host, installed.hostHome, installed.pluginRoot);
  report(
    opts.reporter,
    `${opts.host}: real agent FLOWAI_WORKFLOW=${env.FLOWAI_WORKFLOW}`,
  );
  const prompt = agentPrompt(opts.host);
  report(opts.reporter, `${opts.host}: real agent prompt: ${prompt}`);

  let output: InstallCommandOutput;
  if (opts.host === "claude") {
    output = await runEvidenceCommand(
      opts.runCommand,
      "claude",
      claudeArgs(installed.pluginRoot, prompt),
      { env, reporter: opts.reporter, timeoutMs: opts.timeoutMs },
    );
  } else {
    if (!codexProvider) {
      throw new Error("Codex install acceptance provider was not resolved.");
    }
    const projectDir = await opts.makeTempDir("flowai-codex-agent-project-");
    if (codexProvider === "openai") {
      const apiKey = requireEnv("OPENAI_API_KEY");
      const login = await runEvidenceCommand(
        opts.runCommand,
        "codex",
        ["login", "--with-api-key"],
        {
          env,
          stdin: `${apiKey}\n`,
          redactStdin: true,
          reporter: opts.reporter,
          timeoutMs: opts.timeoutMs,
        },
      );
      if (!login.success) {
        throw new Error(
          `codex login --with-api-key failed (${login.code}): ${
            login.stderr.trim() || login.stdout.trim()
          }`,
        );
      }
    }
    output = await runEvidenceCommand(
      opts.runCommand,
      "codex",
      codexArgs(prompt, projectDir, codexProvider),
      {
        env,
        cwd: projectDir,
        reporter: opts.reporter,
        timeoutMs: opts.timeoutMs,
      },
    );
  }

  assertAgentEvidence(opts.host, output);
  report(opts.reporter, `${opts.host}: install acceptance passed`);
  return installed;
}

export async function runPluginInstallAcceptance(
  opts: InstallAcceptanceOptions,
): Promise<PluginInstallAcceptanceResult> {
  const makeTempDir = opts.makeTempDir ??
    ((prefix: string) => Deno.makeTempDir({ prefix }));
  const runCommand = opts.runCommand ?? defaultRunCommand;
  const payloadDir = await ensurePayload(opts, makeTempDir);
  const hosts = hostsFromOption(opts.host);
  report(opts.reporter, `acceptance hosts under test: ${hosts.join(", ")}`);
  const results: HostInstallResult[] = [];
  for (const host of hosts) {
    results.push(
      await runHostInstallAcceptance({
        host,
        payloadDir,
        codexProvider: opts.codexProvider,
        makeTempDir,
        runCommand,
        probeMcp: opts.probeMcp,
        reporter: opts.reporter,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
  timeoutMs: number;
  codexProvider?: CodexProvider;
}

export function parseInstallAcceptanceArgs(
  argv: string[],
): ParsedArgs | { help: string } {
  let engineRoot = ".";
  let version: string | undefined;
  let payloadDir: string | undefined;
  let host: HostKind | "all" = "all";
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let codexProvider: CodexProvider | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
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
      case "--timeout-ms": {
        timeoutMs = Number(argv[++i] ?? "");
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
          throw new Error("--timeout-ms must be a positive integer.");
        }
        break;
      }
      case "--codex-provider": {
        const value = argv[++i] ?? "";
        if (value !== "openai" && value !== "openrouter") {
          throw new Error(
            "--codex-provider must be one of: openai, openrouter.",
          );
        }
        codexProvider = value;
        break;
      }
      case "-h":
      case "--help":
        return {
          help: [
            "Usage: plugin-install-acceptance [--payload-dir <dir>] [--engine-root <dir>]",
            "                                  [--version <version>] [--host claude|codex|all]",
            "                                  [--codex-provider openai|openrouter]",
            "                                  [--timeout-ms <ms>]",
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
    timeoutMs,
    codexProvider,
  };
}

if (import.meta.main) {
  let parsed: ParsedArgs | { help: string };
  try {
    parsed = parseInstallAcceptanceArgs(Deno.args);
  } catch (error) {
    console.error((error as Error).message);
    Deno.exit(2);
  }
  if ("help" in parsed) {
    console.log(parsed.help);
    Deno.exit(0);
  }
  const result = await runPluginInstallAcceptance({
    engineRoot: resolve(parsed.engineRoot),
    version: parsed.version,
    payloadDir: parsed.payloadDir,
    host: parsed.hosts.length === 1 ? parsed.hosts[0] : "all",
    codexProvider: parsed.codexProvider,
    timeoutMs: parsed.timeoutMs,
    reporter: console.log,
  });
  for (const host of result.hosts) {
    console.log(`${host.host}: install acceptance passed (${host.pluginRoot})`);
  }
}
