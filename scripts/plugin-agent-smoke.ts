#!/usr/bin/env -S deno run -A
/**
 * @module
 * Real-agent smoke for the generated Claude Code and Codex plugin payload.
 *
 * This check is intentionally above `plugin-install-smoke`: it starts the real
 * host agent CLI, asks the agent to use the installed flowai-workflow MCP
 * surface, and verifies both the agent marker and tool-use evidence.
 */

import { fromFileUrl, join, resolve } from "@std/path";
import {
  type HostKind,
  type McpProbe,
  OFFICIAL_MARKETPLACE_NAME,
  runPluginInstallSmoke,
  type SmokeCommandOutput,
  type SmokeReporter,
} from "./plugin-install-smoke.ts";
import {
  type BuildPayloadOptions,
  buildPluginPayload,
  type BuildResult,
} from "./build-plugin-payload.ts";

const DEFAULT_TIMEOUT_MS = 180_000;
const AGENT_PASS_MARKER = "FLOWAI_AGENT_SMOKE_PASS";
const TOOL_EVIDENCE_PATTERN =
  /get_workflow|mcp__flowai[-_]workflow__get_workflow/;
const SMOKE_WORKFLOW = "github-inbox-opencode-test";

type AgentRunCommand = (
  command: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    cwd?: string;
    stdin?: string;
    redactStdin?: boolean;
    timeoutMs?: number;
  },
) => Promise<SmokeCommandOutput>;

interface AgentSmokeOptions {
  engineRoot?: string;
  version?: string;
  payloadDir?: string;
  host?: HostKind | "all";
  runCommand?: AgentRunCommand;
  probeMcp?: McpProbe;
  buildPayload?: (opts: BuildPayloadOptions) => Promise<BuildResult>;
  makeTempDir?: (prefix: string) => Promise<string>;
  reporter?: SmokeReporter;
  timeoutMs?: number;
}

interface HostAgentSmokeResult {
  host: HostKind;
  status: "passed";
  pluginRoot: string;
}

interface PluginAgentSmokeResult {
  payloadDir: string;
  hosts: HostAgentSmokeResult[];
}

function report(reporter: SmokeReporter | undefined, message: string): void {
  reporter?.(`[plugin-agent-smoke] ${message}`);
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
): Promise<SmokeCommandOutput> {
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

async function runEvidenceCommand(
  runCommand: AgentRunCommand,
  command: string,
  args: string[],
  opts: {
    env: Record<string, string>;
    cwd?: string;
    stdin?: string;
    redactStdin?: boolean;
    timeoutMs?: number;
    reporter?: SmokeReporter;
  },
): Promise<SmokeCommandOutput> {
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

function scriptEngineRoot(): string {
  return fromFileUrl(new URL("..", import.meta.url));
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

async function ensurePayload(
  opts: AgentSmokeOptions,
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
  const outDir = await makeTempDir("flowai-agent-payload-");
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

function hostsFromOption(host: HostKind | "all" | undefined): HostKind[] {
  if (host === "claude") return ["claude"];
  if (host === "codex") return ["codex"];
  return ["claude", "codex"];
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name} for real agent smoke.`,
    );
  }
  return value;
}

function hostEnv(
  host: HostKind,
  hostHome: string,
  pluginRoot: string,
): Record<string, string> {
  const dataRoot = join(hostHome, "plugin-data", host);
  const workflowDir = join(pluginRoot, ".flowai-workflow", SMOKE_WORKFLOW);
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
    "This is a CI smoke test for the installed flowai-workflow plugin.",
    "Use the flowai-workflow MCP tool get_workflow exactly once.",
    "Do not use shell commands and do not edit files.",
    `After the tool returns, reply with exactly: ${AGENT_PASS_MARKER} host=${host}`,
  ].join(" ");
}

function claudeArgs(pluginRoot: string, prompt: string): string[] {
  const args = [
    "--bare",
    "--plugin-dir",
    pluginRoot,
    "--permission-mode",
    "bypassPermissions",
    "--allowedTools",
    "mcp__flowai-workflow__get_workflow",
    "--output-format",
    "stream-json",
    "--max-budget-usd",
    Deno.env.get("CLAUDE_AGENT_SMOKE_MAX_BUDGET_USD") ?? "0.25",
  ];
  const model = Deno.env.get("CLAUDE_AGENT_SMOKE_MODEL");
  if (model && model.trim() !== "") args.push("--model", model);
  args.push("-p", prompt);
  return args;
}

function codexArgs(prompt: string, projectDir: string): string[] {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "--cd",
    projectDir,
  ];
  const model = Deno.env.get("CODEX_AGENT_SMOKE_MODEL");
  if (model && model.trim() !== "") args.push("--model", model);
  args.push(prompt);
  return args;
}

function assertAgentEvidence(host: HostKind, output: SmokeCommandOutput): void {
  const combined = `${output.stdout}\n${output.stderr}`;
  if (!output.success) {
    throw new Error(
      `${host} real agent smoke failed (${output.code}): ${combined.trim()}`,
    );
  }
  if (!combined.includes(AGENT_PASS_MARKER)) {
    throw new Error(
      `${host} real agent smoke did not emit ${AGENT_PASS_MARKER}.`,
    );
  }
  if (!TOOL_EVIDENCE_PATTERN.test(combined)) {
    throw new Error(
      `${host} real agent smoke did not show get_workflow tool evidence.`,
    );
  }
}

async function runHostAgentSmoke(opts: {
  host: HostKind;
  payloadDir: string;
  makeTempDir: (prefix: string) => Promise<string>;
  runCommand: AgentRunCommand;
  probeMcp?: McpProbe;
  reporter?: SmokeReporter;
  timeoutMs: number;
}): Promise<HostAgentSmokeResult> {
  if (opts.host === "claude") requireEnv("ANTHROPIC_API_KEY");
  if (opts.host === "codex") requireEnv("OPENAI_API_KEY");

  const install = await runPluginInstallSmoke({
    payloadDir: opts.payloadDir,
    host: opts.host,
    makeTempDir: opts.makeTempDir,
    runCommand: opts.runCommand,
    probeMcp: opts.probeMcp,
    reporter: opts.reporter,
  });
  const installed = install.hosts[0];
  if (
    installed.status !== "passed" || !installed.hostHome ||
    !installed.pluginRoot
  ) {
    throw new Error(
      `${opts.host} plugin install did not return an installed root.`,
    );
  }

  const env = hostEnv(opts.host, installed.hostHome, installed.pluginRoot);
  report(
    opts.reporter,
    `${opts.host}: real agent FLOWAI_WORKFLOW=${env.FLOWAI_WORKFLOW}`,
  );
  const prompt = agentPrompt(opts.host);
  report(opts.reporter, `${opts.host}: real agent prompt: ${prompt}`);

  let output: SmokeCommandOutput;
  if (opts.host === "claude") {
    output = await runEvidenceCommand(
      opts.runCommand,
      "claude",
      claudeArgs(installed.pluginRoot, prompt),
      { env, reporter: opts.reporter, timeoutMs: opts.timeoutMs },
    );
  } else {
    const projectDir = await opts.makeTempDir("flowai-codex-agent-project-");
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
    output = await runEvidenceCommand(
      opts.runCommand,
      "codex",
      codexArgs(prompt, projectDir),
      {
        env,
        cwd: projectDir,
        reporter: opts.reporter,
        timeoutMs: opts.timeoutMs,
      },
    );
  }

  assertAgentEvidence(opts.host, output);
  report(opts.reporter, `${opts.host}: real agent smoke passed`);
  return {
    host: opts.host,
    status: "passed",
    pluginRoot: installed.pluginRoot,
  };
}

export async function runPluginAgentSmoke(
  opts: AgentSmokeOptions,
): Promise<PluginAgentSmokeResult> {
  const makeTempDir = opts.makeTempDir ??
    ((prefix: string) => Deno.makeTempDir({ prefix }));
  const runCommand = opts.runCommand ?? defaultRunCommand;
  const payloadDir = await ensurePayload(opts, makeTempDir);
  const hosts = hostsFromOption(opts.host);
  report(opts.reporter, `real agent hosts under test: ${hosts.join(", ")}`);
  const results: HostAgentSmokeResult[] = [];
  for (const host of hosts) {
    results.push(
      await runHostAgentSmoke({
        host,
        payloadDir,
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
}

export function parseAgentSmokeArgs(
  argv: string[],
): ParsedArgs | { help: string } {
  let engineRoot = ".";
  let version: string | undefined;
  let payloadDir: string | undefined;
  let host: HostKind | "all" = "all";
  let timeoutMs = DEFAULT_TIMEOUT_MS;
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
      case "-h":
      case "--help":
        return {
          help: [
            "Usage: plugin-agent-smoke [--payload-dir <dir>] [--engine-root <dir>]",
            "                          [--version <version>] [--host claude|codex|all]",
            "                          [--timeout-ms <ms>]",
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
  };
}

if (import.meta.main) {
  let parsed: ParsedArgs | { help: string };
  try {
    parsed = parseAgentSmokeArgs(Deno.args);
  } catch (error) {
    console.error((error as Error).message);
    Deno.exit(2);
  }
  if ("help" in parsed) {
    console.log(parsed.help);
    Deno.exit(0);
  }
  const result = await runPluginAgentSmoke({
    engineRoot: resolve(parsed.engineRoot),
    version: parsed.version,
    payloadDir: parsed.payloadDir,
    host: parsed.hosts.length === 1 ? parsed.hosts[0] : "all",
    timeoutMs: parsed.timeoutMs,
    reporter: console.log,
  });
  for (const host of result.hosts) {
    console.log(`${host.host}: real agent passed (${host.pluginRoot})`);
  }
}
