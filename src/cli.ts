#!/usr/bin/env -S deno run -A
/**
 * @module
 * CLI entry point for the workflow engine.
 * Parses arguments and delegates to the appropriate subcommand:
 *
 * - `flowai-workflow run [<workflow>] [options]` → DAG workflow engine
 * - `flowai-workflow init [options]` → project scaffolder
 * - `flowai-workflow answer [--workflow <path>] <run-id> --node <id> "<text>"`
 *   → deliver a local HITL reply (FR-E75)
 * - `flowai-workflow mcp [<workflow>]` → embedded MCP server (FR-E73)
 *
 * Every subcommand that accepts an optional workflow positional shares
 * the same resolution rule (FR-E78): explicit positional → `FLOWAI_WORKFLOW`
 * env → `<cwd>/.flowai-workflow/<single-or-default>`. `mcp` additionally
 * falls through to no-workflow mode so the plugin handshake always
 * completes.
 *
 * Run usage (FR-E53 + FR-E78):
 *   flowai-workflow run [<workflow>] [options]
 *
 * Positional:
 *   [<workflow>]          Path to workflow folder containing workflow.yaml.
 *                         Optional — falls back to the FR-E78 resolver
 *                         (FLOWAI_WORKFLOW or `<cwd>/.flowai-workflow/`).
 *
 * Options:
 *   --prompt <text>       Additional context for PM agent (sets args.prompt)
 *   --resume <run-id>     Resume a previous run from its state
 *   --run-id <id>         Start a fresh run pinned to this id (FR-E84)
 *   --dry-run             Print execution plan without running
 *   -v, --verbose         Show full streaming output
 *   -s, --semi-verbose    Show text output only (suppress tool calls)
 *   -q, --quiet           Show errors only
 *   --env <KEY=VAL>       Set environment variable (repeatable)
 *   --skip <node-ids>     Comma-separated node IDs to skip
 *   --only <node-ids>     Comma-separated node IDs to run exclusively
 *   --cycles <N>          Run the whole workflow N times sequentially (default 1)
 *   --skip-update-check   Do not check JSR for a newer version on startup
 *   --version / -V        Print version and exit
 */

import { dirname, join } from "@std/path";
import type { EngineOptions, Verbosity } from "./types.ts";
import { Engine } from "./engine/engine.ts";
import { deliverHumanAnswer, resumeRun } from "./mcp/commands.ts";
import { getRunDir } from "./state/state.ts";
import { verifyJournalChain } from "./state/run-journal.ts";
import {
  INTERNAL_HITL_MCP_ARG,
  runFlowaiHitlMcpServer,
} from "./hitl/hitl-mcp-server.ts";
import { installSignalHandlers } from "./process-registry.ts";
import { checkForUpdate, VERSION } from "./version.ts";
import { runMcpServer } from "./mcp/mcp-server.ts";

/** Re-exported for back-compat: VERSION lives in `version.ts` (leaf module)
 * so the library graph never imports this CLI entry point. */
export { VERSION };

/** Result of {@link extractCliFlags}: CLI-only flags plus the remaining args. */
export interface CliFlags {
  /** True when user passed `--skip-update-check`. */
  skipUpdateCheck: boolean;
  /**
   * Number of times to run the whole workflow sequentially (`--cycles N`).
   * Defaults to 1. Each cycle is an independent `Engine.run()` with its
   * own auto-generated run-id; on the first non-completed cycle the
   * launcher stops (fail-fast).
   */
  cycles: number;
  /** Remaining args with CLI-only flags stripped; passed to {@link parseArgs}. */
  remaining: string[];
}

/**
 * Extract CLI-only flags (things that never belong on {@link EngineOptions}
 * because they are not domain concerns of the engine). Handles
 * `--skip-update-check` and `--cycles <N>`. Returns both the parsed flags
 * and the remaining args so the caller can forward the rest to
 * {@link parseArgs}.
 */
export function extractCliFlags(args: string[]): CliFlags {
  let skipUpdateCheck = false;
  let cycles = 1;
  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--skip-update-check") {
      skipUpdateCheck = true;
      continue;
    }
    if (a === "--cycles") {
      const raw = args[++i];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
          `Invalid --cycles value: ${raw}. Expected positive integer.`,
        );
      }
      cycles = parsed;
      continue;
    }
    remaining.push(a);
  }
  return { skipUpdateCheck, cycles, remaining };
}

/** Returns the formatted version string for `--version` output. */
export function getVersionString(): string {
  return `flowai-workflow v${VERSION}`;
}

/** Normalise a workflow folder positional argument: strip trailing slashes.
 * Shared between `run` (workflow.yaml path resolution) and `mcp`
 * (workflowDir argument for `runMcpServer`). FR-E73. */
export function normalizeWorkflowDir(arg: string): string {
  return arg.replace(/\/+$/, "");
}

/** Resolve the active workflow folder from env and cwd (FR-E78).
 *
 * Shared across every subcommand that accepts an optional workflow
 * positional (`run`, `answer`, `mcp`). Pure rule, no per-command
 * special cases:
 *
 *  1. `env.FLOWAI_WORKFLOW` — explicit user override, returned as-is.
 *  2. `<cwd>/.flowai-workflow/<dir>` with `workflow.yaml`, when
 *     exactly one such subdir exists.
 *  3. `<cwd>/.flowai-workflow/github-inbox/` if present
 *     (ambiguity fallback).
 *  4. `null` — caller decides what "no active workflow" means (error
 *     out for `run` / `answer`; no-workflow mode for `mcp` so the
 *     MCP handshake still completes with a structured diagnostic).
 *
 * The engine is host-agnostic: the plugin's `.mcp.json` is responsible
 * for spawning the server with `cwd = <project root>` (Codex inherits
 * it for free; Claude Code uses `"cwd": "${CLAUDE_PROJECT_DIR}"`).
 * `Deno.cwd()` is therefore the only host-touched signal, and `cwd`
 * is only overridable for tests.
 */
export async function resolveActiveWorkflow(opts: {
  env: Record<string, string | undefined>;
  cwd?: string;
}): Promise<string | null> {
  if (opts.env.FLOWAI_WORKFLOW) return opts.env.FLOWAI_WORKFLOW;
  const projectRoot = opts.cwd ?? Deno.cwd();
  const bundleDir = join(projectRoot, ".flowai-workflow");
  const candidates: string[] = [];
  try {
    for await (const entry of Deno.readDir(bundleDir)) {
      if (!entry.isDirectory) continue;
      const child = join(bundleDir, entry.name);
      try {
        const stat = await Deno.stat(join(child, "workflow.yaml"));
        if (stat.isFile) candidates.push(child);
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
  if (candidates.length === 1) return candidates[0];
  const gh = join(bundleDir, "github-inbox");
  if (candidates.includes(gh)) return gh;
  return null;
}

/** Parsed positional/flag arguments for the `answer` subcommand (FR-E75). */
export interface AnswerArgs {
  /** Workflow folder (trailing slashes stripped). `undefined` when the
   * user did not pass `--workflow <path>`; the caller falls back to the
   * shared `resolveActiveWorkflow` resolver (FR-E78). */
  workflowDir: string | undefined;
  /** Target run id. */
  runId: string;
  /** Target waiting node id (from `--node`/`--node=`). */
  nodeId: string;
  /** Reply text (remaining positionals joined with a space). */
  text: string;
}

/**
 * Parse `answer [--workflow <path>] <run-id> --node <id> "<text>"` (FR-E75).
 * Workflow is optional: when `--workflow <path>` is omitted the caller
 * falls back to `resolveActiveWorkflow` (FR-E78). Remaining positionals
 * are joined as text so unquoted multi-word replies still work.
 * `--node <id>` and `--node=<id>` are both accepted.
 */
export function parseAnswerArgs(args: string[]): AnswerArgs {
  let nodeId: string | undefined;
  let workflow: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--node") {
      nodeId = args[++i];
      continue;
    }
    if (a.startsWith("--node=")) {
      nodeId = a.slice("--node=".length);
      continue;
    }
    if (a === "--workflow") {
      workflow = args[++i];
      continue;
    }
    if (a.startsWith("--workflow=")) {
      workflow = a.slice("--workflow=".length);
      continue;
    }
    positionals.push(a);
  }
  const [runId, ...rest] = positionals;
  const text = rest.join(" ");
  if (!runId) {
    throw new Error(
      "answer: missing <run-id>. " +
        "Usage: flowai-workflow answer [--workflow <path>] <run-id> " +
        '--node <id> "<text>"',
    );
  }
  if (!nodeId) {
    throw new Error(
      "answer: missing --node <id> (the waiting node to answer).",
    );
  }
  if (!text.trim()) {
    throw new Error("answer: missing answer text.");
  }
  return {
    workflowDir: workflow ? normalizeWorkflowDir(workflow) : undefined,
    runId,
    nodeId,
    text,
  };
}

/**
 * Parse CLI arguments into EngineOptions.
 *
 * The first non-flag positional argument is the workflow folder path
 * (FR-E53; mandatory at runtime). Flags may appear before or after the
 * positional. `config_path` is left empty when no positional is supplied
 * — {@link runEngine} enforces presence at the run boundary so unit tests
 * can call `parseArgs([])` to inspect defaults.
 */
export function parseArgs(args: string[]): EngineOptions {
  let configPath = "";
  let runId: string | undefined;
  let resume = false;
  let dryRun = false;
  let verbosity: Verbosity = "normal";
  const cliArgs: Record<string, string> = {};
  const envOverrides: Record<string, string> = {};
  let skipNodes: string[] | undefined;
  let onlyNodes: string[] | undefined;
  let budgetUsd: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--config":
        throw new Error(
          "Unknown flag: --config (removed in FR-E53). " +
            "Pass the workflow folder as a positional argument: " +
            "`flowai-workflow run <workflow> [options]`.",
        );
      case "--workflow":
        throw new Error(
          "Unknown flag: --workflow (removed in FR-E53). " +
            "Pass the workflow folder as a positional argument: " +
            "`flowai-workflow run <workflow> [options]`.",
        );
      case "--prompt":
        cliArgs.prompt = args[++i];
        break;
      case "--resume":
        resume = true;
        runId = args[++i];
        break;
      case "--run-id":
        // FR-E84: pin a FRESH run to an explicit id (no resume). Lets a
        // caller (MCP `start_run` background launch) allocate the id and
        // return it before the run completes. Engine honours
        // `options.run_id` on the fresh path (engine.ts).
        runId = args[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "-v":
      case "--verbose":
        verbosity = "verbose";
        break;
      case "-s":
      case "--semi-verbose":
        verbosity = "semi-verbose";
        break;
      case "-q":
      case "--quiet":
        verbosity = "quiet";
        break;
      case "--env": {
        const val = args[++i];
        const eqIdx = val.indexOf("=");
        if (eqIdx === -1) {
          throw new Error(`Invalid --env format: ${val}. Expected KEY=VALUE`);
        }
        envOverrides[val.substring(0, eqIdx)] = val.substring(eqIdx + 1);
        break;
      }
      case "--skip":
        skipNodes = args[++i].split(",").map((s) => s.trim());
        break;
      case "--only":
        onlyNodes = args[++i].split(",").map((s) => s.trim());
        break;
      case "--budget": {
        const raw = args[++i];
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(
            `Invalid --budget value: ${raw}. Expected positive number of USD.`,
          );
        }
        budgetUsd = parsed;
        break;
      }
      case "--version":
      case "-V":
        handleVersion();
        break;
      case "--help":
      case "-h":
        printUsage();
        Deno.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          // Generic workflow-argument passthrough, attached form ONLY:
          // `--key=value` sets `args.key`.
          //
          // The detached form (`--key value`) used to be accepted too, which
          // made every mistyped engine flag silent: `--dryrun` was read as a
          // workflow argument and swallowed the next token, and `--validate`
          // (a flag that never existed) started a real run. Requiring `=`
          // makes author intent explicit and lets anything else fail fast.
          const eqIdx = arg.indexOf("=");
          if (eqIdx === -1) {
            throw new Error(
              `Unknown flag: ${arg}. Run \`flowai-workflow run --help\` for the ` +
                `supported options, or pass a workflow argument as ` +
                `\`${arg}=<value>\` to expose it as {{args.${
                  arg.substring(2)
                }}}.`,
            );
          }
          const key = arg.substring(2, eqIdx);
          if (!key) {
            throw new Error(`Invalid argument: ${arg}. Expected --key=value.`);
          }
          cliArgs[key] = arg.substring(eqIdx + 1);
        } else if (configPath === "") {
          // First positional → workflow folder path.
          configPath = `${normalizeWorkflowDir(arg)}/workflow.yaml`;
        } else {
          throw new Error(
            `Unexpected positional argument: ${arg}. ` +
              `Only one workflow folder is accepted.`,
          );
        }
    }
  }

  return {
    config_path: configPath,
    run_id: runId,
    resume,
    dry_run: dryRun,
    verbosity,
    args: cliArgs,
    env_overrides: envOverrides,
    skip_nodes: skipNodes,
    only_nodes: onlyNodes,
    budget_usd: budgetUsd,
  };
}

function handleVersion(): never {
  console.log(getVersionString());
  Deno.exit(0);
}

function printUsage(): void {
  console.log(`
Workflow Engine — Configurable multi-agent workflow runner

Usage:
  flowai-workflow run [<workflow>] [options] Execute DAG workflow
  flowai-workflow init [options]             Scaffold .flowai-workflow/ directory
  flowai-workflow answer [--workflow <path>] <run-id> --node <id> "<text>"
                                             Deliver a local HITL reply (FR-E75)
  flowai-workflow verify [--workflow <path>] <run-id>
                                             Check the run journal's hash chain (FR-E92)
  flowai-workflow mcp [<workflow>]           Start embedded MCP server (FR-E73)

Subcommands:
  run                   Execute DAG workflow engine
  init                  Scaffold .flowai-workflow/ directory (run init --help for details)
  answer                Deliver a human reply to a waiting HITL node via the run's
                        local inbox file (transport-independent). Prints
                        {inboxPath, live}; when live is false, resume the run to
                        consume the queued answer.
  verify                Verify the run journal's hash chain and report the FIRST
                        divergent record. Exit 0 = intact, 1 = broken or unreadable.
  mcp                   Start embedded MCP server exposing 9 engine-control tools over stdio.

Workflow resolution (run / answer / verify / mcp; FR-E78):
  Every subcommand that accepts a workflow shares one rule when the
  positional / --workflow is omitted:
    1. $FLOWAI_WORKFLOW env override.
    2. Single subdir of <cwd>/.flowai-workflow/ containing workflow.yaml.
    3. <cwd>/.flowai-workflow/github-inbox/ if present (ambiguity fallback).
  The mcp subcommand additionally falls through to no-workflow mode so
  the MCP handshake completes; run / answer / verify error out instead.

Run positional:
  [<workflow>]          Path to workflow folder containing workflow.yaml
                        (optional; falls back to the workflow-resolution
                        rule above).

Run options:
  --prompt <text>       Additional context for PM agent (optional)
  --resume <run-id>     Resume a previous run
  --run-id <id>         Start a fresh run pinned to this id (FR-E84)
  --dry-run             Print execution plan without running
  -v, --verbose         Show full streaming output from agents
  -s, --semi-verbose    Show text output only (suppress tool calls)
  -q, --quiet           Show errors only
  --env <KEY=VAL>       Set environment variable (repeatable)
  --skip <node-ids>     Comma-separated node IDs to skip
  --only <node-ids>     Comma-separated node IDs to run exclusively
  --budget <USD>        Workflow-wide cost cap (positive USD; strict >)
  --cycles <N>          Run the whole workflow N times sequentially (default 1;
                        stops on the first non-completed cycle; not compatible
                        with --resume)
  --skip-update-check   Do not check JSR for a newer version on startup

Global options:
  -V, --version         Print version and exit
  -h, --help            Show this help

Examples:
  flowai-workflow run .flowai-workflow/github-inbox
  flowai-workflow run .flowai-workflow/github-inbox --prompt "Focus on the login bug"
  flowai-workflow run .flowai-workflow/github-inbox --resume 20260308T143022 -v
  flowai-workflow run .flowai-workflow/github-inbox --dry-run
  flowai-workflow answer 20260529T094727 --node specification "monetization"
  flowai-workflow answer --workflow .flowai-workflow/autonomous-sdlc 20260529T094727 --node specification "monetization"
  flowai-workflow mcp .flowai-workflow/github-inbox
`);
}

// --- Main ---

/**
 * Run the DAG workflow engine with the given args (after `run` is stripped).
 * Shared between the `run` subcommand and the backward-compat shim.
 */
async function runEngine(args: string[]): Promise<never> {
  // Signal handlers are installed once at the top of `if (import.meta.main)`
  // so every subcommand shares the same routing (FR-E61: engine never
  // installs handlers — CLI is the sole owner).
  try {
    const { skipUpdateCheck, cycles, remaining } = extractCliFlags(args);
    const options = parseArgs(remaining);

    // FR-E78: when the positional is omitted, fall back to the shared
    // active-workflow resolver (FLOWAI_WORKFLOW → single or
    // `github-inbox` default under `<cwd>/.flowai-workflow/`).
    if (!options.config_path) {
      const resolved = await resolveActiveWorkflow({
        env: Deno.env.toObject(),
      });
      if (resolved === null) {
        throw new Error(
          "Could not resolve active workflow. Pass it as a positional " +
            "(`flowai-workflow run <workflow>`), set FLOWAI_WORKFLOW, or " +
            "place a workflow under `<cwd>/.flowai-workflow/`.",
        );
      }
      options.config_path = `${normalizeWorkflowDir(resolved)}/workflow.yaml`;
    }

    // `--cycles N` repeats the whole workflow; resuming a specific run
    // is incompatible with that semantics.
    if (cycles > 1 && options.resume) {
      throw new Error(
        "--cycles cannot be combined with --resume: resume targets a " +
          "single run-id, while --cycles starts fresh runs.",
      );
    }

    // FR-E84: an explicit fresh `--run-id` pins ONE id; --cycles starts
    // multiple fresh runs that would collide on it.
    if (cycles > 1 && options.run_id && !options.resume) {
      throw new Error(
        "--cycles cannot be combined with --run-id: an explicit run-id " +
          "would collide across fresh cycles.",
      );
    }

    // Notify the user if a newer version is on JSR. Fail-open: any network
    // or parse error returns null and we silently continue. Skipped when
    // the binary was built without a real VERSION (local `deno run`) or
    // when the user explicitly opted out.
    if (!skipUpdateCheck && VERSION !== "dev") {
      const update = await checkForUpdate(VERSION);
      if (update?.updateAvailable) {
        console.error(
          `Update available: ${update.currentVersion} → ${update.latestVersion}\n` +
            `Run: ${update.updateCommand}\n`,
        );
      }
    }

    // Load .env file if it exists
    try {
      const envFile = await Deno.readTextFile(".env");
      for (const line of envFile.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim().replace(
          /^['"]|['"]$/g,
          "",
        );
        // Don't override explicit --env values
        if (!(key in options.env_overrides)) {
          options.env_overrides[key] = value;
        }
      }
    } catch {
      // .env file is optional
    }

    // Resume delegates to the shared command core (FR-E75) so MCP
    // `resume_node` and CLI `run --resume` use ONE Engine-resume
    // construction. `--cycles` is already rejected with `--resume`, so a
    // resume run is always single. (Resume replays args/env from the
    // journal — engine.ts:209-214 — so the empty args/env in resumeRun is
    // behaviour-preserving vs. the former inline `new Engine(options)`.)
    if (options.resume) {
      if (!options.run_id) {
        throw new Error("--resume requires a run-id: --resume <run-id>");
      }
      const result = await resumeRun({
        workflowDir: dirname(options.config_path),
        runId: options.run_id,
        verbosity: options.verbosity,
      });
      Deno.exit(result.status === "completed" ? 0 : 1);
    }

    for (let cycle = 1; cycle <= cycles; cycle++) {
      if (cycles > 1 && options.verbosity !== "quiet") {
        console.error(`\n=== Cycle ${cycle}/${cycles} ===\n`);
      }
      const engine = new Engine(options);
      const state = await engine.run();
      if (state.status !== "completed") {
        Deno.exit(1);
      }
    }
    Deno.exit(0);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    Deno.exit(2);
  }
}

/**
 * Run the `answer` subcommand (FR-E75): deliver a local HITL reply to a
 * waiting run via `commands.deliverHumanAnswer` (the same core the MCP
 * `provide_human_input` tool calls). Write-only — prints `{inboxPath,
 * live}`; when the engine is not currently running this run (`live:
 * false`), hints to resume it so the queued answer is consumed.
 */
async function runAnswer(args: string[]): Promise<never> {
  try {
    const parsed = parseAnswerArgs(args);
    let workflowDir = parsed.workflowDir;
    if (!workflowDir) {
      const resolved = await resolveActiveWorkflow({
        env: Deno.env.toObject(),
      });
      if (resolved === null) {
        throw new Error(
          "Could not resolve active workflow. Pass it via " +
            "`--workflow <path>`, set FLOWAI_WORKFLOW, or place a " +
            "workflow under `<cwd>/.flowai-workflow/`.",
        );
      }
      workflowDir = normalizeWorkflowDir(resolved);
    }
    const result = await deliverHumanAnswer({
      workflowDir,
      runId: parsed.runId,
      nodeId: parsed.nodeId,
      text: parsed.text,
    });
    const { runId } = parsed;
    console.log(JSON.stringify(result, null, 2));
    if (!result.live) {
      console.error(
        `\nEngine is not currently running ${runId}. The answer is queued ` +
          `at ${result.inboxPath}; resume the run to consume it:\n` +
          `  flowai-workflow run ${workflowDir} --resume ${runId}`,
      );
    }
    Deno.exit(0);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    Deno.exit(1);
  }
}

/**
 * Subcommand `verify <run-id>` (FR-E92): check a run journal's hash chain.
 *
 * Exit 0 when the chain holds, 1 when it does not — so the check is usable
 * from CI and from a supervising agent, not just by eye.
 */
async function runVerify(args: string[]): Promise<never> {
  try {
    const { workflowDir, runId } = await parseVerifyArgs(args);
    const runDir = getRunDir(runId, workflowDir);
    const result = await verifyJournalChain(runDir);

    console.log(JSON.stringify(result, null, 2));
    if (result.ok) {
      console.error(
        `\nJournal chain intact: ${result.verified} records verified` +
          (result.unchained > 0
            ? `, ${result.unchained} written before hashing existed`
            : "") +
          ".",
      );
      Deno.exit(0);
    }
    console.error(
      `\nJournal chain broken at seq ${result.broken?.seq} ` +
        `(${result.broken?.kind}, ${result.broken?.event_id}): ` +
        `${result.broken?.reason}. ` +
        `The first ${result.verified} records verified; everything from this ` +
        `record on is unverifiable.`,
    );
    Deno.exit(1);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    Deno.exit(1);
  }
}

/** Parse `verify [--workflow <path>] <run-id>`, resolving the workflow. */
async function parseVerifyArgs(
  args: string[],
): Promise<{ workflowDir: string; runId: string }> {
  let workflow: string | undefined;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--workflow") {
      workflow = args[++i];
      continue;
    }
    if (a.startsWith("--workflow=")) {
      workflow = a.slice("--workflow=".length);
      continue;
    }
    positionals.push(a);
  }
  const runId = positionals[0];
  if (!runId) {
    throw new Error(
      "verify: missing <run-id>. " +
        "Usage: flowai-workflow verify [--workflow <path>] <run-id>",
    );
  }
  if (workflow) return { workflowDir: normalizeWorkflowDir(workflow), runId };

  const resolved = await resolveActiveWorkflow({ env: Deno.env.toObject() });
  if (resolved === null) {
    throw new Error(
      "Could not resolve active workflow. Pass it via `--workflow <path>`, " +
        "set FLOWAI_WORKFLOW, or place a workflow under " +
        "`<cwd>/.flowai-workflow/`.",
    );
  }
  return { workflowDir: normalizeWorkflowDir(resolved), runId };
}

/**
 * Print a one-line deprecation banner for users who installed the engine
 * via JSR or a prebuilt binary (FR-E70 plugin-first distribution). The
 * banner is suppressed when:
 *
 *  - `FLOWAI_SUPPRESS_DEPRECATION=1` is set (CI, plugin launcher,
 *    long-running embeddings),
 *  - the engine is invoked as the HITL MCP server (internal subprocess,
 *    `INTERNAL_HITL_MCP_ARG`),
 *  - or `VERSION === "dev"` (local `deno run` against source — no JSR
 *    install to migrate from).
 *
 * The plugin launcher skills (`run/SKILL.md`, `init/SKILL.md`) export
 * `FLOWAI_SUPPRESS_DEPRECATION=1` before invoking the bundled engine so
 * plugin-installed users do not see it — only standalone JSR/binary
 * users do, telling them to migrate.
 */
function maybePrintDeprecationBanner(): void {
  if (Deno.env.get("FLOWAI_SUPPRESS_DEPRECATION") === "1") return;
  if (VERSION === "dev") return;
  console.error(
    "[DEPRECATION] Standalone JSR / binary distribution of flowai-workflow " +
      "is being retired. Migrate to the Claude Code / Codex plugin: " +
      "see https://github.com/korchasa/flowai-workflow#install. " +
      "Set FLOWAI_SUPPRESS_DEPRECATION=1 to silence this notice.",
  );
}

if (import.meta.main) {
  // Internal dispatch: engine-owned HITL MCP server. Every MCP-capable
  // runtime adapter (Claude / OpenCode / Codex) spawns the engine binary
  // with this flag via the `mcpServers` invoke option (FR-L35; hitl-via-engine-mcp).
  if (Deno.args[0] === INTERNAL_HITL_MCP_ARG) {
    await runFlowaiHitlMcpServer();
    Deno.exit(0);
  }

  maybePrintDeprecationBanner();

  // Single signal-handler install for the whole process (FR-E61). All
  // subcommands inherit the same routing; the engine never installs its own.
  installSignalHandlers();

  const subcommand = Deno.args[0];

  // Global flags handled before subcommand dispatch
  if (subcommand === "--version" || subcommand === "-V") {
    handleVersion();
  }
  if (subcommand === "--help" || subcommand === "-h") {
    printUsage();
    Deno.exit(0);
  }

  // Subcommand: `run` → DAG workflow engine
  if (subcommand === "run") {
    await runEngine(Deno.args.slice(1));
  }

  // Subcommand: `answer <workflow> <run-id> --node <id> "<text>"` (FR-E75)
  // → deliver a local HITL reply through the shared command core.
  if (subcommand === "answer") {
    await runAnswer(Deno.args.slice(1));
  }

  // Subcommand: `verify <run-id>` (FR-E92) → journal hash-chain check.
  if (subcommand === "verify") {
    await runVerify(Deno.args.slice(1));
  }

  // Subcommand: `init` → verbatim copy of a bundled workflow folder.
  if (subcommand === "init") {
    const { runInit } = await import("./init/mod.ts");
    const exitCode = await runInit(Deno.args.slice(1), {
      engineVersion: VERSION,
    });
    Deno.exit(exitCode);
  }

  // Subcommand: `mcp [<workflow>] | --no-workflow` (FR-E73, FR-E78).
  // `runMcpServer` is imported statically: a dynamic `await import()` here
  // deadlocks in Deno 2.8 when the static graph (Engine → ai-ide-cli) already
  // pulled @modelcontextprotocol/sdk + zod, leaving the MCP handshake stuck
  // and Claude Code reporting the server as "connecting".
  if (subcommand === "mcp") {
    const rest = Deno.args.slice(1);
    if (rest.includes("--no-workflow")) {
      // Caller explicitly opted out of workflow resolution (FR-E78
      // tests, dev smoke). The server still completes the MCP
      // handshake; tool calls return a structured missing-workflow
      // error.
      await runMcpServer(undefined, { noWorkflow: true });
      Deno.exit(0);
    }
    const positional = rest[0];
    if (positional) {
      await runMcpServer(normalizeWorkflowDir(positional));
      Deno.exit(0);
    }
    // FR-E78: the plugin manifest invokes `flowai-workflow mcp` bare —
    // workflow resolution moved from the deleted launcher into the
    // engine itself. Fall back to the shared resolver; absent any
    // bundle, start in no-workflow mode so the handshake still
    // completes and Claude/Codex surface the structured diagnostic.
    const resolved = await resolveActiveWorkflow({
      env: Deno.env.toObject(),
    });
    if (resolved !== null) {
      await runMcpServer(normalizeWorkflowDir(resolved));
    } else {
      await runMcpServer(undefined, { noWorkflow: true });
    }
    Deno.exit(0);
  }

  // Backward-compat shim: bare `--` flags without `run` prefix.
  // Treat as `run <args>` with a deprecation warning. Remove after 2 minor releases.
  if (subcommand && subcommand.startsWith("--")) {
    console.error(
      "[DEPRECATED] Running engine with bare flags is deprecated. " +
        "Use `flowai-workflow run <workflow> [options]` instead.\n",
    );
    await runEngine(Deno.args);
  }

  // Default (no args or unknown subcommand): print usage and exit non-zero.
  if (!subcommand) {
    printUsage();
    Deno.exit(1);
  }
  console.error(`Error: unknown subcommand: ${subcommand}`);
  printUsage();
  Deno.exit(1);
}
