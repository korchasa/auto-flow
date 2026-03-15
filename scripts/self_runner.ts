/**
 * @module
 * Autonomous pipeline loop runner.
 * Polls GitHub for open issues (excluding "in-progress"), runs the engine
 * pipeline when actionable issues exist, and applies exponential backoff
 * (30 s → 4 h) when the queue is empty. Run via: deno task loop
 */

import { Engine } from "../engine/engine.ts";
import { parseArgs } from "../engine/cli.ts";
import { installSignalHandlers } from "../engine/process-registry.ts";
import { MIN_PAUSE_SEC, nextPause } from "./backoff.ts";

/** Query open issues excluding "in-progress" label via gh CLI. */
async function fetchActionableIssues(): Promise<
  { number: number; title: string }[]
> {
  const cmd = new Deno.Command("gh", {
    args: [
      "issue",
      "list",
      "--state",
      "open",
      "--json",
      "number,title,labels",
      "--limit",
      "100",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stdout, stderr } = await cmd.output();
  if (!success) {
    const err = new TextDecoder().decode(stderr);
    console.error(`gh issue list failed: ${err}`);
    return [];
  }
  const raw = JSON.parse(new TextDecoder().decode(stdout)) as {
    number: number;
    title: string;
    labels: { name: string }[];
  }[];
  // Exclude issues already being worked on
  return raw.filter((i) => !i.labels.some((l) => l.name === "in-progress")).map(
    ({ number, title }) => ({ number, title }),
  );
}

/** Load .env file into options (same logic as cli.ts). */
function loadEnvFile(envOverrides: Record<string, string>): void {
  try {
    const envFile = Deno.readTextFileSync(".env");
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
      if (!(key in envOverrides)) {
        envOverrides[key] = value;
      }
    }
  } catch {
    // .env file is optional
  }
}

/** Run the pipeline via direct Engine import. Returns true on success. */
async function runPipeline(): Promise<boolean> {
  console.log("> Engine.run()");
  try {
    const options = parseArgs(["--config", ".auto-flow/pipeline.yaml"]);
    loadEnvFile(options.env_overrides);
    const engine = new Engine(options);
    const state = await engine.run();
    return state.status === "completed";
  } catch (err) {
    console.error(`Engine error: ${(err as Error).message}`);
    return false;
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

async function sleep(sec: number): Promise<void> {
  await new Promise((r) => setTimeout(r, sec * 1000));
}

export function printUsage(): string {
  return `Pipeline loop runner — check GitHub issues and run pipeline repeatedly

Usage:
  deno task loop

Options:
  --help, -h     Show this help

Examples:
  deno task loop`;
}

export function checkArgs(
  args: string[],
): { text: string; code: number } | null {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      return { text: printUsage(), code: 0 };
    }
    if (arg === "--") break;
    if (arg.startsWith("--")) {
      return {
        text: `Error: Unknown argument: ${arg}. Use --help for usage.`,
        code: 1,
      };
    }
  }
  return null;
}

// --- Main loop ---
if (import.meta.main) {
  installSignalHandlers();

  const argCheck = checkArgs(Deno.args);
  if (argCheck !== null) {
    if (argCheck.code === 0) console.log(argCheck.text);
    else console.error(argCheck.text);
    Deno.exit(argCheck.code);
  }
  console.log("=== auto-flow: self-runner started ===");
  let pause = MIN_PAUSE_SEC;

  while (true) {
    console.log(`\n--- Checking for actionable issues ---`);
    const issues = await fetchActionableIssues();

    if (issues.length === 0) {
      console.log(
        `No actionable issues. Sleeping ${formatDuration(pause)}...`,
      );
      await sleep(pause);
      pause = nextPause(pause);
      continue;
    }

    // Reset backoff on found issues
    pause = MIN_PAUSE_SEC;
    console.log(`Found ${issues.length} actionable issue(s):`);
    for (const i of issues) {
      console.log(`  #${i.number} ${i.title}`);
    }

    const ok = await runPipeline();
    if (ok) {
      console.log("Pipeline completed successfully.");
    } else {
      console.error("Pipeline failed. Will re-check issues on next cycle.");
      // Brief pause before retry on failure
      await sleep(MIN_PAUSE_SEC);
    }
  }
}
