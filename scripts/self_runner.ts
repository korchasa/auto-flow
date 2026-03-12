// scripts/self_runner.ts
// Autonomous loop: check GitHub issues → run pipeline → repeat.
// Exponential backoff (30s → 4h) when no actionable tickets found.

const MIN_PAUSE_SEC = 30;
const MAX_PAUSE_SEC = 4 * 60 * 60; // 4 hours
const BACKOFF_FACTOR = 2;

/** Compute next pause with exponential backoff capped at MAX. */
export function nextPause(current: number): number {
  return Math.min(current * BACKOFF_FACTOR, MAX_PAUSE_SEC);
}

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

/** Run the pipeline via deno task run. Returns true on success. */
async function runPipeline(): Promise<boolean> {
  console.log("> deno task run");
  const cmd = new Deno.Command("deno", {
    args: ["task", "run"],
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await cmd.output();
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

// --- Main loop ---
if (import.meta.main) {
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
