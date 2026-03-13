// scripts/generate-dashboard.ts
// Generates a self-contained HTML dashboard for a pipeline run.
// Reads state.json + per-node logs/<nodeId>.json from a run directory.
import type { ClaudeCliOutput, NodeState, RunState } from "../engine/types.ts";
import { parse as parseYaml } from "@std/yaml";

/** Escape HTML special chars to prevent XSS. */
export function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Read and parse state.json from run directory. Throws on missing/malformed file. */
export async function readRunState(runDir: string): Promise<RunState> {
  const content = await Deno.readTextFile(`${runDir}/state.json`);
  return JSON.parse(content) as RunState;
}

/**
 * Read and parse logs/<nodeId>.json from run directory.
 * Returns null on missing file or malformed JSON.
 */
export async function readNodeLog(
  runDir: string,
  nodeId: string,
): Promise<ClaudeCliOutput | null> {
  try {
    const content = await Deno.readTextFile(`${runDir}/logs/${nodeId}.json`);
    return JSON.parse(content) as ClaudeCliOutput;
  } catch {
    return null;
  }
}

const PREVIEW_LINES = 3;

/**
 * Render an HTML card for a single pipeline node.
 * Multi-line results use <details>/<summary> with first 3 lines in summary.
 * Single-line results render inline without wrapper.
 */
export function renderCard(
  nodeId: string,
  state: NodeState,
  log: ClaudeCliOutput | null,
): string {
  const statusClass = state.status === "completed"
    ? "ok"
    : state.status === "failed"
    ? "fail"
    : state.status === "skipped"
    ? "skip"
    : "other";

  const durationS = state.duration_ms != null
    ? `${(state.duration_ms / 1000).toFixed(1)}s`
    : "\u2014";
  const cost = log?.total_cost_usd != null
    ? `$${log.total_cost_usd.toFixed(4)}`
    : "\u2014";
  const turns = log?.num_turns ?? "\u2014";

  const result = log?.result ?? state.error ?? "";
  const lines = result.split("\n");

  let resultHtml: string;
  if (lines.length <= 1) {
    resultHtml = `<p class="result">${escHtml(result)}</p>`;
  } else {
    const preview = escHtml(lines.slice(0, PREVIEW_LINES).join("\n"));
    const full = escHtml(result);
    resultHtml =
      `<details>\n<summary><pre class="result-preview">${preview}</pre></summary>\n<pre class="result-full">${full}</pre>\n</details>`;
  }

  return `<div class="card ${statusClass}">
<div class="card-header">
  <span class="node-id">${escHtml(nodeId)}</span>
  <span class="badge ${statusClass}">${escHtml(state.status)}</span>
</div>
<div class="card-meta">
  <span>${escHtml(durationS)}</span>
  <span>${escHtml(cost)}</span>
  <span>turns: ${escHtml(String(turns))}</span>
</div>
${resultHtml}
</div>`;
}

/**
 * Render the full self-contained HTML dashboard page.
 *
 * @param state - Parsed run state (provides run_id, timestamps, node statuses)
 * @param logs  - Map of nodeId → ClaudeCliOutput (or null if log unavailable)
 * @param phases - Optional phase grouping from pipeline config
 */
export function renderHtml(
  state: RunState,
  logs: Record<string, ClaudeCliOutput | null>,
  phases?: Record<string, string[]>,
): string {
  const nodeIds = Object.keys(state.nodes);

  let bodySections: string;
  if (phases && Object.keys(phases).length > 0) {
    const phaseAssigned = new Set<string>();
    const groups: Array<{ label: string; ids: string[] }> = [];

    for (const [phase, members] of Object.entries(phases)) {
      const present = members.filter((id) => state.nodes[id]);
      if (present.length > 0) {
        groups.push({ label: phase, ids: present });
        for (const id of present) phaseAssigned.add(id);
      }
    }

    const ungrouped = nodeIds.filter((id) => !phaseAssigned.has(id));
    if (ungrouped.length > 0) groups.push({ label: "other", ids: ungrouped });

    bodySections = groups.map(({ label, ids }) => {
      const cards = ids
        .map((id) => renderCard(id, state.nodes[id], logs[id] ?? null))
        .join("\n");
      return `<section>\n<h2 class="phase-label">${
        escHtml(label)
      }</h2>\n<div class="card-grid">\n${cards}\n</div>\n</section>`;
    }).join("\n");
  } else {
    const cards = nodeIds
      .map((id) => renderCard(id, state.nodes[id], logs[id] ?? null))
      .join("\n");
    bodySections =
      `<section>\n<div class="card-grid">\n${cards}\n</div>\n</section>`;
  }

  const completedAt = state.completed_at ?? "\u2014";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pipeline Run: ${escHtml(state.run_id)}</title>
<style>
${CSS}
</style>
</head>
<body>
<header>
  <h1>Pipeline Run: <code>${escHtml(state.run_id)}</code></h1>
  <p>Status: <strong class="${escHtml(state.status)}">${
    escHtml(state.status)
  }</strong></p>
  <p>Started: ${escHtml(state.started_at)} | Completed: ${
    escHtml(completedAt)
  }</p>
</header>
<main>
${bodySections}
</main>
</body>
</html>`;
}

const CSS = `
body{font-family:system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:1rem;background:#f5f5f5}
header{background:#fff;border-radius:8px;padding:1rem 1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{margin:0 0 .5rem;font-size:1.4rem}
h2.phase-label{color:#555;font-size:.85rem;margin:1.5rem 0 .75rem;letter-spacing:.08em;text-transform:uppercase}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem}
.card{background:#fff;border-radius:8px;padding:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1);border-left:4px solid #ccc}
.card.ok{border-left-color:#22c55e}
.card.fail{border-left-color:#ef4444}
.card.skip{border-left-color:#94a3b8}
.card.other{border-left-color:#f59e0b}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}
.node-id{font-weight:600;font-family:monospace}
.badge{font-size:.75rem;padding:.2em .6em;border-radius:999px;font-weight:600}
.badge.ok{background:#dcfce7;color:#166534}
.badge.fail{background:#fee2e2;color:#991b1b}
.badge.skip{background:#f1f5f9;color:#475569}
.badge.other{background:#fef9c3;color:#854d0e}
.card-meta{display:flex;gap:1rem;font-size:.8rem;color:#666;margin-bottom:.5rem}
.result{font-size:.85rem;color:#333;margin:0;white-space:pre-wrap;word-break:break-word}
pre.result-preview,pre.result-full{font-size:.8rem;color:#333;white-space:pre-wrap;word-break:break-word;margin:0}
details summary{cursor:pointer;font-size:.8rem;color:#555}
details[open] summary{margin-bottom:.5rem}
strong.completed,strong.running{color:#166534}
strong.failed{color:#991b1b}
strong.aborted{color:#854d0e}
`.trim();

// --- CLI entry ---

if (import.meta.main) {
  const args = Deno.args;
  const runDirIdx = args.indexOf("--run-dir");
  if (runDirIdx === -1 || !args[runDirIdx + 1]) {
    console.error("Usage: generate-dashboard.ts --run-dir <path>");
    Deno.exit(1);
  }
  const runDir = args[runDirIdx + 1];

  const state = await readRunState(runDir);

  // Load phases from pipeline config (best-effort)
  let phases: Record<string, string[]> | undefined;
  try {
    const configContent = await Deno.readTextFile(state.config_path);
    // deno-lint-ignore no-explicit-any
    const config = parseYaml(configContent) as Record<string, any>;
    if (config.phases && typeof config.phases === "object") {
      phases = config.phases as Record<string, string[]>;
    }
  } catch {
    // Config unreadable — proceed without phase grouping
  }

  // Read all node logs
  const logs: Record<string, ClaudeCliOutput | null> = {};
  for (const nodeId of Object.keys(state.nodes)) {
    logs[nodeId] = await readNodeLog(runDir, nodeId);
  }

  const html = renderHtml(state, logs, phases);
  const outPath = `${runDir}/index.html`;
  await Deno.writeTextFile(outPath, html);
  console.log(`Dashboard written to: ${outPath}`);
}
