// scripts/loop_in_claude.ts
// Autonomous loop: check GitHub issues → run pipeline via claude CLI → repeat.
// Streams claude output as JSON and displays in readable format.
// Exponential backoff (30s → 4h) when no actionable tickets found.

import { processStream } from "./claude_stream_formatter.ts";
import {
  installSignalHandlers,
  register,
  unregister,
} from "../engine/process-registry.ts";
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

/** Grace period (ms) after result event before killing a hanging process. */
const KILL_GRACE_MS = 30_000;

/** Run the pipeline via claude CLI with stream-json output. Returns true on success. */
async function runPipelineViaClaude(): Promise<boolean> {
  const prompt = Deno.args.join(" ") ||
    "Run the application using `deno task run`. Monitor the output and report the result.";
  console.log(`> claude -p "${prompt}" --output-format stream-json`);
  const cmd = new Deno.Command("claude", {
    args: [
      "--dangerously-skip-permissions",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "inherit",
    env: { CLAUDECODE: "" },
  });
  const child = cmd.spawn();
  register(child);
  const streamResult = await processStream(child.stdout);

  // Workaround: claude CLI may hang after emitting result event (issue #25629).
  // If stream completed, give process a grace period then kill.
  if (streamResult.completed) {
    let graceTimeout: ReturnType<typeof setTimeout> | undefined;
    const raced = await Promise.race([
      child.status,
      new Promise<null>((r) => {
        graceTimeout = setTimeout(() => r(null), KILL_GRACE_MS);
      }),
    ]);
    clearTimeout(graceTimeout);
    if (raced === null) {
      console.error(
        `claude process did not exit within ${
          KILL_GRACE_MS / 1000
        }s after result, killing.`,
      );
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
    }
    unregister(child);
    return streamResult.success;
  }

  // Stream ended without result event — rely on exit code
  const { success } = await child.status;
  unregister(child);
  return success;
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
  return `Pipeline loop runner (via claude CLI) — check GitHub issues and run pipeline via claude

Usage:
  deno task loop-in-claude [claude-args...]

Arguments:
  [claude-args...]   Arguments passed through to the claude CLI

Note: All arguments (except --help/-h) are forwarded directly to claude.

Examples:
  deno task loop-in-claude
  deno task loop-in-claude --verbose
  deno task loop-in-claude --model claude-opus-4-6`;
}

export function checkArgs(
  args: string[],
): { text: string; code: number } | null {
  if (args.includes("--help") || args.includes("-h")) {
    return { text: printUsage(), code: 0 };
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
  console.log("=== auto-flow: loop-in-claude started ===");
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

    const ok = await runPipelineViaClaude();
    if (ok) {
      console.log("Pipeline (via claude) completed successfully.");
    } else {
      console.error(
        "Pipeline (via claude) failed. Will re-check issues on next cycle.",
      );
      // Brief pause before retry on failure
      await sleep(MIN_PAUSE_SEC);
    }
  }
}
