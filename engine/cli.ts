#!/usr/bin/env -S deno run -A
/**
 * @module
 * CLI entry point for the workflow engine.
 * Parses arguments and delegates to the appropriate subcommand:
 *
 * - `flowai-workflow` (no args) → interactive REPL with bundled management skills
 * - `flowai-workflow run [options]` → DAG workflow engine
 *
 * Run options:
 *   --config <path>       Workflow config file (default: .flowai-workflow/workflow.yaml)
 *   --prompt <text>       Additional context for PM agent (sets args.prompt)
 *   --resume <run-id>     Resume a previous run from its state
 *   --dry-run             Print execution plan without running
 *   -v, --verbose         Show full streaming output
 *   -s, --semi-verbose    Show text output only (suppress tool calls)
 *   -q, --quiet           Show errors only
 *   --env <KEY=VAL>       Set environment variable (repeatable)
 *   --skip <node-ids>     Comma-separated node IDs to skip
 *   --only <node-ids>     Comma-separated node IDs to run exclusively
 *   --skip-update-check   Do not check JSR for a newer version on startup
 *   --version / -V        Print version and exit
 */

import type { EngineOptions, Verbosity } from "./types.ts";
import { Engine } from "./engine.ts";
import {
  INTERNAL_OPENCODE_HITL_MCP_ARG,
  runOpenCodeHitlMcpServer,
} from "@korchasa/ai-ide-cli/opencode/hitl-mcp";
import { installSignalHandlers } from "./process-registry.ts";
import { checkForUpdate } from "./version.ts";

/** Version string embedded at compile time via VERSION env var. Defaults to "dev". */
export const VERSION: string = Deno.env.get("VERSION") ?? "dev";

/** Result of {@link extractCliFlags}: CLI-only flags plus the remaining args. */
export interface CliFlags {
  /** True when user passed `--skip-update-check`. */
  skipUpdateCheck: boolean;
  /** Remaining args with CLI-only flags stripped; passed to {@link parseArgs}. */
  remaining: string[];
}

/**
 * Extract CLI-only flags (things that never belong on {@link EngineOptions}
 * because they are not domain concerns of the engine). Currently handles
 * `--skip-update-check`. Returns both the parsed flags and the remaining
 * args so the caller can forward the rest to {@link parseArgs}.
 */
export function extractCliFlags(args: string[]): CliFlags {
  let skipUpdateCheck = false;
  const remaining = args.filter((a) => {
    if (a === "--skip-update-check") {
      skipUpdateCheck = true;
      return false;
    }
    return true;
  });
  return { skipUpdateCheck, remaining };
}

/** Returns the formatted version string for `--version` output. */
export function getVersionString(): string {
  return `flowai-workflow v${VERSION}`;
}

/**
 * Parse CLI arguments into EngineOptions.
 * Known flags (--config, --resume, --dry-run, verbosity, --env, --skip, --only)
 * set dedicated fields. Generic `--key value` pairs populate `args`.
 */
export function parseArgs(args: string[]): EngineOptions {
  let configPath = ".flowai-workflow/workflow.yaml";
  let runId: string | undefined;
  let resume = false;
  let dryRun = false;
  let verbosity: Verbosity = "normal";
  const cliArgs: Record<string, string> = {};
  const envOverrides: Record<string, string> = {};
  let skipNodes: string[] | undefined;
  let onlyNodes: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--config":
        configPath = args[++i];
        break;
      case "--prompt":
        cliArgs.prompt = args[++i];
        break;
      case "--resume":
        resume = true;
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
          // Treat as a generic arg: --key value
          const key = arg.substring(2);
          cliArgs[key] = args[++i] ?? "";
        } else {
          throw new Error(`Unknown argument: ${arg}`);
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
  flowai-workflow                Launch interactive REPL with bundled management skills
  flowai-workflow run [options]  Execute DAG workflow

Subcommands:
  (default)             Interactive AI-assisted REPL (asks runtime on first use)
  run                   Execute DAG workflow engine

Run options:
  --config <path>       Workflow config file (default: .flowai-workflow/workflow.yaml)
  --prompt <text>       Additional context for PM agent (optional)
  --resume <run-id>     Resume a previous run
  --dry-run             Print execution plan without running
  -v, --verbose         Show full streaming output from agents
  -s, --semi-verbose    Show text output only (suppress tool calls)
  -q, --quiet           Show errors only
  --env <KEY=VAL>       Set environment variable (repeatable)
  --skip <node-ids>     Comma-separated node IDs to skip
  --only <node-ids>     Comma-separated node IDs to run exclusively
  --skip-update-check   Do not check JSR for a newer version on startup

Global options:
  -V, --version         Print version and exit
  -h, --help            Show this help

Examples:
  flowai-workflow
  flowai-workflow run --prompt "Focus on the login bug"
  flowai-workflow run --config custom.yaml -v
  flowai-workflow run --resume 20260308T143022
  flowai-workflow run --dry-run
`);
}

// --- Main ---

/**
 * Run the DAG workflow engine with the given args (after `run` is stripped).
 * Shared between the `run` subcommand and the backward-compat shim.
 */
async function runEngine(args: string[]): Promise<never> {
  installSignalHandlers();

  try {
    const { skipUpdateCheck, remaining } = extractCliFlags(args);
    const options = parseArgs(remaining);

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

    const engine = new Engine(options);
    const state = await engine.run();

    Deno.exit(state.status === "completed" ? 0 : 1);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    Deno.exit(2);
  }
}

if (import.meta.main) {
  // Internal dispatch: OpenCode HITL MCP server
  if (Deno.args[0] === INTERNAL_OPENCODE_HITL_MCP_ARG) {
    await runOpenCodeHitlMcpServer();
    Deno.exit(0);
  }

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

  // Backward-compat shim: bare `--` flags without `run` prefix.
  // Treat as `run <args>` with a deprecation warning. Remove after 2 minor releases.
  if (subcommand && subcommand.startsWith("--")) {
    console.error(
      "[DEPRECATED] Running engine with bare flags is deprecated. " +
        "Use `flowai-workflow run [options]` instead.\n",
    );
    await runEngine(Deno.args);
  }

  // Default (no args or unknown subcommand): launch REPL.
  // Dynamic import keeps REPL code out of the engine module graph.
  const { launchRepl } = await import("./repl/mod.ts");
  const exitCode = await launchRepl({ engineVersion: VERSION });
  Deno.exit(exitCode);
}
