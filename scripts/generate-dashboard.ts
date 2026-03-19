/**
 * @module
 * HTML dashboard generator for a pipeline run.
 * Reads state.json + per-node logs/<nodeId>.json from a run directory and
 * produces a self-contained index.html with node cards, Gantt timeline, and
 * cost chart. Entry point: {@link renderHtml}.
 * CLI: deno task dashboard --run-dir <path>
 */
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

/**
 * Read stream.log from path with head+tail truncation.
 * Returns empty string if the file is missing.
 * If line count ≤ maxHead+maxTail: returns full content unchanged.
 * Otherwise: returns first maxHead lines + "\n--- truncated ---\n" + last maxTail lines.
 */
export async function readStreamLog(
  path: string,
  maxHead = 200,
  maxTail = 50,
): Promise<string> {
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch {
    return "";
  }
  if (content === "") return "";
  const lines = content.split("\n");
  if (lines.length <= maxHead + maxTail) return content;
  const head = lines.slice(0, maxHead).join("\n");
  const tail = lines.slice(lines.length - maxTail).join("\n");
  return `${head}\n--- truncated ---\n${tail}`;
}

/**
 * Group node IDs by declared phases.
 * Returns Array<{label, ids}> preserving phase ordering by construction.
 * When phases absent/empty: single group with all nodeIds and empty label.
 * Nodes not listed in any phase are collected into an "other" group.
 * Empty nodeIds always returns [].
 */
export function groupNodesByPhase(
  nodeIds: string[],
  phases?: Record<string, string[]>,
): Array<{ label: string; ids: string[] }> {
  if (nodeIds.length === 0) return [];
  if (!phases || Object.keys(phases).length === 0) {
    return [{ label: "", ids: nodeIds }];
  }
  const assigned = new Set<string>();
  const groups: Array<{ label: string; ids: string[] }> = [];
  for (const [phase, members] of Object.entries(phases)) {
    const present = members.filter((id) => nodeIds.includes(id));
    if (present.length > 0) {
      groups.push({ label: phase, ids: present });
      for (const id of present) assigned.add(id);
    }
  }
  const ungrouped = nodeIds.filter((id) => !assigned.has(id));
  if (ungrouped.length > 0) groups.push({ label: "other", ids: ungrouped });
  return groups;
}

/**
 * Compute aggregate status for a phase group, separating core nodes from
 * run_on:always nodes. Core status: all completed → "completed", any failed →
 * "failed", otherwise "running". Always-node status is computed independently
 * and omitted when the group contains no always-nodes.
 */
export function computePhaseStatus(
  nodeIds: string[],
  nodeStates: Record<string, NodeState>,
  alwaysNodes: Set<string>,
): { coreStatus: string; alwaysStatus?: string } {
  const coreIds = nodeIds.filter((id) => !alwaysNodes.has(id));
  const alwaysIds = nodeIds.filter((id) => alwaysNodes.has(id));

  const computeStatus = (ids: string[]): string => {
    if (ids.length === 0) return "completed";
    const statuses = ids.map((id) => nodeStates[id]?.status ?? "pending");
    if (statuses.every((s: string) => s === "completed")) return "completed";
    if (statuses.some((s: string) => s === "failed")) return "failed";
    return "running";
  };

  const coreStatus = computeStatus(coreIds);
  const alwaysStatus = alwaysIds.length > 0
    ? computeStatus(alwaysIds)
    : undefined;
  return { coreStatus, alwaysStatus };
}

const PREVIEW_LINES = 3;

/**
 * Render an HTML card for a single pipeline node.
 * Multi-line results use <details>/<summary> with first 3 lines in summary.
 * Single-line results render inline without wrapper.
 * When streamLogHref is provided, renders a link to the stream log after card-meta.
 * When logContent is provided and non-empty, renders an inline collapsible log viewer
 * after the stream log link.
 */
export function renderCard(
  nodeId: string,
  state: NodeState,
  log: ClaudeCliOutput | null,
  streamLogHref?: string,
  logContent?: string,
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

  const logLinkHtml = streamLogHref
    ? `\n<a class="log-link" href="${escHtml(streamLogHref)}">stream log</a>`
    : "";

  const inlineLogHtml = logContent
    ? `\n<details><summary>stream log</summary><pre class="log-content">${
      escHtml(logContent)
    }</pre></details>`
    : "";

  return `<div class="card ${statusClass}">
<div class="card-header">
  <span class="node-id">${escHtml(nodeId)}</span>
  <span class="badge ${statusClass}">${escHtml(state.status)}</span>
</div>
<div class="card-meta">
  <span>${escHtml(durationS)}</span>
  <span>${escHtml(cost)}</span>
  <span>turns: ${escHtml(String(turns))}</span>
</div>${logLinkHtml}${inlineLogHtml}
${resultHtml}
</div>`;
}

/** A single bar entry for the Gantt-style timeline. */
export interface TimelineBar {
  nodeId: string;
  /** Bar left offset as percentage of total run duration. */
  offsetPct: number;
  /** Bar width as percentage of total run duration. */
  widthPct: number;
  durationMs: number;
  /** True when this node has the longest duration_ms in the run. */
  isBottleneck: boolean;
}

/**
 * Compute timeline bars from run state.
 * Nodes missing started_at or duration_ms are omitted.
 * Percentages are relative to run start and total duration.
 */
export function computeTimeline(state: RunState): TimelineBar[] {
  const entries: Array<
    { nodeId: string; startMs: number; durationMs: number }
  > = [];

  for (const [nodeId, node] of Object.entries(state.nodes)) {
    if (!node.started_at || node.duration_ms == null) continue;
    const startMs = new Date(node.started_at).getTime();
    entries.push({ nodeId, startMs, durationMs: node.duration_ms });
  }

  if (entries.length === 0) return [];

  const runStartMs = new Date(state.started_at).getTime();
  const endMs = Math.max(...entries.map((e) => e.startMs + e.durationMs));
  const totalDuration = endMs - runStartMs;

  if (totalDuration <= 0) return [];

  const maxDuration = Math.max(...entries.map((e) => e.durationMs));

  return entries.map(({ nodeId, startMs, durationMs }) => ({
    nodeId,
    offsetPct: ((startMs - runStartMs) / totalDuration) * 100,
    widthPct: (durationMs / totalDuration) * 100,
    durationMs,
    isBottleneck: durationMs === maxDuration,
  }));
}

/**
 * Render a Gantt-style HTML timeline section.
 * Bars are sorted by offsetPct. Bottleneck bar uses timeline-bottleneck class.
 * Labels are XSS-safe via escHtml(). Empty bars array produces an empty state message.
 */
export function renderTimeline(bars: TimelineBar[]): string {
  if (bars.length === 0) {
    return `<section class="timeline">\n<h2>Timeline</h2>\n<p class="timeline-empty">No timing data available.</p>\n</section>`;
  }

  const sorted = [...bars].sort((a, b) => a.offsetPct - b.offsetPct);
  const rows = sorted
    .map(({ nodeId, offsetPct, widthPct, durationMs, isBottleneck }) => {
      const cls = isBottleneck
        ? "timeline-bar timeline-bottleneck"
        : "timeline-bar";
      const label = escHtml(nodeId);
      const titleText = `${label}: ${(durationMs / 1000).toFixed(1)}s`;
      return `<div class="timeline-row"><div class="${cls}" style="left:${
        offsetPct.toFixed(2)
      }%;width:${
        widthPct.toFixed(2)
      }%" title="${titleText}"><span class="timeline-label">${label}</span></div></div>`;
    })
    .join("\n");

  return `<section class="timeline">\n<h2>Timeline</h2>\n<div class="timeline-container">\n${rows}\n</div>\n</section>`;
}

/** A single bar entry for the cost chart. */
export interface CostBar {
  nodeId: string;
  /** Actual cost in USD. */
  costUsd: number;
  /** Bar width as percentage of max node cost (max node = 100%). */
  widthPct: number;
}

/**
 * Compute cost bars from run state.
 * Nodes with cost_usd <= 0 or undefined are omitted.
 * widthPct is relative to the node with the highest cost (= 100%).
 */
export function computeCostBars(state: RunState): CostBar[] {
  const entries: Array<{ nodeId: string; costUsd: number }> = [];

  for (const [nodeId, node] of Object.entries(state.nodes)) {
    if (node.cost_usd != null && node.cost_usd > 0) {
      entries.push({ nodeId, costUsd: node.cost_usd });
    }
  }

  if (entries.length === 0) return [];

  const maxCost = Math.max(...entries.map((e) => e.costUsd));

  return entries.map(({ nodeId, costUsd }) => ({
    nodeId,
    costUsd,
    widthPct: (costUsd / maxCost) * 100,
  }));
}

const COST_ROW_HEIGHT = 32;
const COST_BAR_HEIGHT = 24;

/**
 * Render an inline SVG horizontal bar chart for node costs.
 * Each bar: <rect> with proportional width, <text> label (XSS-safe via escHtml()).
 * Total cost shown in header. Empty bars → "No cost data" message.
 */
export function renderCostChart(bars: CostBar[], totalCost: number): string {
  if (bars.length === 0) {
    return `<section class="cost-chart">\n<h2>Cost by Node</h2>\n<p class="cost-chart-empty">No cost data available.</p>\n</section>`;
  }

  const totalHeight = bars.length * COST_ROW_HEIGHT;
  const totalLabel = escHtml(`Total: $${totalCost.toFixed(4)}`);

  const barSvgs = bars
    .map(({ nodeId, costUsd, widthPct }, i) => {
      const y = i * COST_ROW_HEIGHT;
      const label = escHtml(nodeId);
      const costLabel = `$${costUsd.toFixed(4)}`;
      return `<g class="cost-bar-group"><rect x="0" y="${y}" width="${
        widthPct.toFixed(2)
      }%" height="${COST_BAR_HEIGHT}" class="cost-bar-rect"/><text x="4" y="${
        y + COST_BAR_HEIGHT - 6
      }" class="cost-bar-label">${label}: ${costLabel}</text></g>`;
    })
    .join("\n");

  return `<section class="cost-chart">\n<h2>Cost by Node</h2>\n<p class="cost-chart-total">${totalLabel}</p>\n<svg width="100%" height="${totalHeight}" class="cost-chart-svg">\n${barSvgs}\n</svg>\n</section>`;
}

/**
 * Render the full self-contained HTML dashboard page.
 * Delegates phase-grouping to groupNodesByPhase(); no inline grouping logic.
 * Per-phase status badges computed via computePhaseStatus() using alwaysNodes set.
 *
 * @param state - Parsed run state (provides run_id, timestamps, node statuses)
 * @param logs  - Map of nodeId → ClaudeCliOutput (or null if log unavailable)
 * @param phases - Optional phase grouping from pipeline config
 * @param streamLogHrefs - Optional map of nodeId → relative href to stream.log
 * @param streamLogContents - Optional map of nodeId → truncated stream.log text
 * @param alwaysNodes - Optional set of nodeIds with run_on:always for phase badge separation
 */
export function renderHtml(
  state: RunState,
  logs: Record<string, ClaudeCliOutput | null>,
  phases?: Record<string, string[]>,
  streamLogHrefs?: Record<string, string>,
  streamLogContents?: Record<string, string>,
  alwaysNodes?: Set<string>,
): string {
  const nodeIds = Object.keys(state.nodes);
  const effectiveAlwaysNodes = alwaysNodes ?? new Set<string>();

  const groups = groupNodesByPhase(nodeIds, phases);
  const bodySections = groups.map(({ label, ids }) => {
    const cards = ids
      .map((id) =>
        renderCard(
          id,
          state.nodes[id],
          logs[id] ?? null,
          streamLogHrefs?.[id],
          streamLogContents?.[id],
        )
      )
      .join("\n");
    let heading = "";
    if (label) {
      const { coreStatus, alwaysStatus } = computePhaseStatus(
        ids,
        state.nodes,
        effectiveAlwaysNodes,
      );
      const alwaysBadge = alwaysStatus !== undefined
        ? ` <span class="phase-badge phase-badge-always ${
          escHtml(alwaysStatus)
        }">${escHtml(alwaysStatus)} (always)</span>`
        : "";
      heading = `\n<h2 class="phase-label">${
        escHtml(label)
      } <span class="phase-badge ${escHtml(coreStatus)}">${
        escHtml(coreStatus)
      }</span>${alwaysBadge}</h2>`;
    }
    return `<section>${heading}\n<div class="card-grid">\n${cards}\n</div>\n</section>`;
  }).join("\n");

  const completedAt = state.completed_at ?? "\u2014";
  const bars = computeTimeline(state);
  const timelineHtml = renderTimeline(bars);
  const costBars = computeCostBars(state);
  const costChartHtml = renderCostChart(costBars, state.total_cost_usd ?? 0);

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
${timelineHtml}
${costChartHtml}
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
strong.completed{color:#166534}
strong.running{color:#2563eb}
strong.failed{color:#991b1b}
strong.aborted{color:#854d0e}
.phase-badge{font-size:.7rem;padding:.15em .5em;border-radius:999px;font-weight:600;margin-left:.3rem;vertical-align:middle}
.phase-badge.completed{background:#dcfce7;color:#166534}
.phase-badge.running{background:#dbeafe;color:#1d4ed8}
.phase-badge.failed{background:#fee2e2;color:#991b1b}
.phase-badge.aborted{background:#fef9c3;color:#854d0e}
.phase-badge-always{opacity:.8}
.timeline{background:#fff;border-radius:8px;padding:1rem 1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.timeline h2{font-size:1rem;margin:0 0 .75rem;color:#333}
.timeline-empty{color:#999;font-size:.85rem;margin:0}
.timeline-container{position:relative}
.timeline-row{position:relative;height:1.8rem;margin-bottom:.25rem}
.timeline-bar{position:absolute;top:0;height:100%;background:#60a5fa;border-radius:4px;display:flex;align-items:center;overflow:hidden;min-width:2px;box-sizing:border-box}
.timeline-bar.timeline-bottleneck{background:#f87171}
.timeline-label{font-size:.7rem;color:#fff;padding:0 .3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cost-chart{background:#fff;border-radius:8px;padding:1rem 1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.cost-chart h2{font-size:1rem;margin:0 0 .5rem;color:#333}
.cost-chart-total{font-size:.85rem;color:#555;margin:0 0 .75rem}
.cost-chart-empty{color:#999;font-size:.85rem;margin:0}
.cost-chart-svg{display:block;overflow:visible}
.cost-bar-rect{fill:#a78bfa}
.cost-bar-label{font-size:.7rem;fill:#fff}
.log-link{font-family:monospace;font-size:.75rem;color:#6b7280;display:inline-block;margin-bottom:.5rem}
.log-content{font-family:monospace;font-size:.75rem;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:scroll;margin:0}`
  .trim();

export function printUsage(): string {
  return `HTML dashboard generator — produces a self-contained dashboard for a pipeline run

Usage:
  deno task dashboard --run-dir <path>

Options:
  --run-dir <path>   Path to the pipeline run directory (required)
  --help, -h         Show this help

Example:
  deno task dashboard --run-dir .auto-flow/runs/20260101T120000`;
}

export function checkArgs(
  args: string[],
): { text: string; code: number } | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      return { text: printUsage(), code: 0 };
    }
    if (arg === "--run-dir") {
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      return {
        text: `Error: Unknown argument: ${arg}. Use --help for usage.`,
        code: 1,
      };
    }
  }
  return null;
}

// --- CLI entry ---

if (import.meta.main) {
  const args = Deno.args;
  const argCheck = checkArgs(args);
  if (argCheck !== null) {
    if (argCheck.code === 0) console.log(argCheck.text);
    else console.error(argCheck.text);
    Deno.exit(argCheck.code);
  }
  const runDirIdx = args.indexOf("--run-dir");
  if (runDirIdx === -1 || !args[runDirIdx + 1]) {
    console.error("Usage: generate-dashboard.ts --run-dir <path>");
    Deno.exit(1);
  }
  const runDir = args[runDirIdx + 1];

  const state = await readRunState(runDir);

  // Load phases and node configs from pipeline config (best-effort)
  let phases: Record<string, string[]> | undefined;
  const alwaysNodes = new Set<string>();
  try {
    const configContent = await Deno.readTextFile(state.config_path);
    // deno-lint-ignore no-explicit-any
    const config = parseYaml(configContent) as Record<string, any>;
    if (config.phases && typeof config.phases === "object") {
      phases = config.phases as Record<string, string[]>;
    }
    if (config.nodes && typeof config.nodes === "object") {
      // deno-lint-ignore no-explicit-any
      const configNodes = config.nodes as Record<string, any>;
      for (const [nodeId, nodeConfig] of Object.entries(configNodes)) {
        if (nodeConfig?.run_on === "always") {
          alwaysNodes.add(nodeId);
        }
      }
    }
  } catch {
    // Config unreadable — proceed without phase grouping or always-nodes
  }

  // Build reverse phase map: nodeId → phase
  const nodePhaseMap: Record<string, string> = {};
  if (phases) {
    for (const [phase, members] of Object.entries(phases)) {
      for (const nodeId of members) {
        nodePhaseMap[nodeId] = phase;
      }
    }
  }

  // Read stream.log content (with truncation) for each node; build href map
  const streamLogHrefs: Record<string, string> = {};
  const streamLogContents: Record<string, string> = {};
  for (const nodeId of Object.keys(state.nodes)) {
    const phase = nodePhaseMap[nodeId];
    const nodeDir = phase
      ? `${runDir}/${phase}/${nodeId}`
      : `${runDir}/${nodeId}`;
    const logPath = `${nodeDir}/stream.log`;
    const content = await readStreamLog(logPath);
    if (content.length > 0) {
      streamLogContents[nodeId] = content;
      streamLogHrefs[nodeId] = phase
        ? `${phase}/${nodeId}/stream.log`
        : `${nodeId}/stream.log`;
    }
  }

  // Read all node logs
  const logs: Record<string, ClaudeCliOutput | null> = {};
  for (const nodeId of Object.keys(state.nodes)) {
    logs[nodeId] = await readNodeLog(runDir, nodeId);
  }

  const html = renderHtml(
    state,
    logs,
    phases,
    streamLogHrefs,
    streamLogContents,
    alwaysNodes,
  );
  const outPath = `${runDir}/index.html`;
  await Deno.writeTextFile(outPath, html);
  console.log(`Dashboard written to: ${outPath}`);
}
