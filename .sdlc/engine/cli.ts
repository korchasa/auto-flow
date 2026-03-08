#!/usr/bin/env -S deno run -A
/**
 * CLI entry point for the pipeline engine.
 * Usage: deno task run [options]
 *
 * Options:
 *   --config <path>       Pipeline config file (default: .sdlc/pipeline.yaml)
 *   --issue <number>      Issue number (passed as args.issue)
 *   --resume <run-id>     Resume a previous run from its state
 *   --dry-run             Print execution plan without running
 *   -v, --verbose         Show full streaming output
 *   -q, --quiet           Show errors only
 *   --env <KEY=VAL>       Set environment variable (repeatable)
 *   --skip <node-ids>     Comma-separated node IDs to skip
 *   --only <node-ids>     Comma-separated node IDs to run exclusively
 */

import type { EngineOptions, Verbosity } from "./types.ts";
import { Engine } from "./engine.ts";

function parseArgs(args: string[]): EngineOptions {
  let configPath = ".sdlc/pipeline.yaml";
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
      case "--issue":
        cliArgs.issue = args[++i];
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

function printUsage(): void {
  console.log(`
Pipeline Engine — Configurable multi-agent pipeline runner

Usage:
  deno task run [options]

Options:
  --config <path>       Pipeline config file (default: .sdlc/pipeline.yaml)
  --issue <number>      Issue number (passed as args.issue)
  --resume <run-id>     Resume a previous run
  --dry-run             Print execution plan without running
  -v, --verbose         Show full streaming output from agents
  -q, --quiet           Show errors only
  --env <KEY=VAL>       Set environment variable (repeatable)
  --skip <node-ids>     Comma-separated node IDs to skip
  --only <node-ids>     Comma-separated node IDs to run exclusively
  -h, --help            Show this help

Examples:
  deno task run --issue 42
  deno task run --config custom.yaml --issue 42 -v
  deno task run --resume 20260308T143022
  deno task run --dry-run --issue 1
  deno task run --issue 42 --skip meta-agent --env DEBUG=true
`);
}

// --- Main ---

if (import.meta.main) {
  try {
    const options = parseArgs(Deno.args);

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

    // Exit with appropriate code
    Deno.exit(state.status === "completed" ? 0 : 1);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    Deno.exit(2);
  }
}
