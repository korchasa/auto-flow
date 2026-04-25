/**
 * @module
 * Run-state management: create, persist, load, and update RunState across a
 * workflow execution. Also owns the phase registry (nodeId → phase name) used
 * for computing node output directory paths.
 */

import type {
  ErrorCategory,
  NodeState,
  NodeStatus,
  RunState,
  WorkflowConfig,
} from "./types.ts";

// --- FR-E9: Phase Registry ---

/** Module-scoped phase registry: nodeId → phase name.
 * Populated once per run via setPhaseRegistry(). */
const _phaseRegistry = new Map<string, string>();

/**
 * Build phase registry from workflow config.
 * Config validation (parseConfig) guarantees mutual exclusivity: either a top-level
 * `phases:` block is present OR per-node `phase:` fields are used, never both.
 * Called once at run start, before ensureRunDirs().
 */
export function setPhaseRegistry(config: WorkflowConfig): void {
  _phaseRegistry.clear();
  if (config.phases) {
    // Top-level phases block is the sole mechanism
    for (const [phase, nodeIds] of Object.entries(config.phases)) {
      for (const nodeId of nodeIds) {
        _phaseRegistry.set(nodeId, phase);
      }
    }
  } else {
    // Per-node phase fields are the sole mechanism when no phases block is present
    for (const [nodeId, node] of Object.entries(config.nodes)) {
      if (node.phase) {
        _phaseRegistry.set(nodeId, node.phase);
      }
    }
  }
}

/** Clear the phase registry. Used for test isolation. */
export function clearPhaseRegistry(): void {
  _phaseRegistry.clear();
}

/** Return the phase for a node, or undefined if not registered. */
export function getPhaseForNode(nodeId: string): string | undefined {
  return _phaseRegistry.get(nodeId);
}

/** Generate a run ID from the current timestamp with optional label.
 * Format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSS-<label> when label provided.
 * Label is sanitized: lowercased, non-alphanumeric chars replaced with '-',
 * consecutive dashes collapsed, trimmed to 60 chars. */
export function generateRunId(label?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${
    pad(now.getDate())
  }T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  if (!label) return ts;
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug ? `${ts}-${slug}` : ts;
}

/** Create a fresh RunState for a new workflow execution. */
export function createRunState(
  runId: string,
  configPath: string,
  nodeIds: string[],
  args: Record<string, string>,
  env: Record<string, string>,
): RunState {
  const nodes: Record<string, NodeState> = {};
  for (const id of nodeIds) {
    nodes[id] = { status: "pending" };
  }
  return {
    run_id: runId,
    config_path: configPath,
    started_at: new Date().toISOString(),
    status: "running",
    args,
    env,
    nodes,
  };
}

/** Get the run directory path for a given run ID. */
export function getRunDir(runId: string): string {
  return `.flowai-workflow/runs/${runId}`;
}

/** Get the node output directory path.
 * Returns `<runDir>/<phase>/<nodeId>/` when node has a phase in the registry,
 * otherwise flat `<runDir>/<nodeId>/` (backward-compatible). */
export function getNodeDir(runId: string, nodeId: string): string {
  const phase = getPhaseForNode(nodeId);
  if (phase) {
    return `${getRunDir(runId)}/${phase}/${nodeId}`;
  }
  return `${getRunDir(runId)}/${nodeId}`;
}

/** Get the state.json file path for a run. */
export function getStatePath(runId: string): string {
  return `${getRunDir(runId)}/state.json`;
}

/** Get the logs directory for a run. */
export function getLogsDir(runId: string): string {
  return `${getRunDir(runId)}/logs`;
}

/** Prefix a relative path with workDir. No-op when workDir is ".". */
export function workPath(workDir: string, relativePath: string): string {
  return workDir === "." ? relativePath : `${workDir}/${relativePath}`;
}

/**
 * Build the workDir-relative path bundle for a task's TemplateContext.
 *
 * Returned paths are relative to the agent's cwd (= workDir) so that an
 * agent launched with cwd = workDir resolves them to artifact directories
 * on disk. Engine internal code that reads/writes those artifacts (and
 * whose own cwd may differ from workDir) must wrap the returned paths
 * with `workPath(workDir, …)` before any FS call.
 *
 * @param runId — run ID used to compose `<runDir>/<nodeId>` paths.
 * @param nodeId — current node whose `node_dir` is emitted.
 * @param inputs — predecessor node IDs; each gets a `node_dir` entry under
 *   the returned `input` map.
 */
export function buildTaskPaths(
  runId: string,
  nodeId: string,
  inputs: readonly string[] = [],
): {
  node_dir: string;
  run_dir: string;
  input: Record<string, string>;
} {
  const input: Record<string, string> = {};
  for (const id of inputs) input[id] = getNodeDir(runId, id);
  return {
    node_dir: getNodeDir(runId, nodeId),
    run_dir: getRunDir(runId),
    input,
  };
}

/** Save RunState to state.json.
 * @param workDir — base directory prefix for file I/O. Defaults to "." (CWD). */
export async function saveState(
  state: RunState,
  workDir = ".",
): Promise<void> {
  const path = `${workDir}/${getStatePath(state.run_id)}`;
  const dir = `${workDir}/${getRunDir(state.run_id)}`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2) + "\n");
}

/** Load RunState from state.json.
 * @param workDir — base directory prefix for file I/O. Defaults to "." (CWD). */
export async function loadState(
  runId: string,
  workDir = ".",
): Promise<RunState> {
  const path = `${workDir}/${getStatePath(runId)}`;
  const text = await Deno.readTextFile(path);
  return JSON.parse(text) as RunState;
}

/** Update a single node's state and persist. */
export function updateNodeState(
  state: RunState,
  nodeId: string,
  update: Partial<NodeState>,
): void {
  if (!(nodeId in state.nodes)) {
    throw new Error(`Node '${nodeId}' not found in run state`);
  }
  state.nodes[nodeId] = { ...state.nodes[nodeId], ...update };
}

/** Mark a node as started. */
export function markNodeStarted(state: RunState, nodeId: string): void {
  updateNodeState(state, nodeId, {
    status: "running",
    started_at: new Date().toISOString(),
  });
}

/** Recompute state.total_cost_usd by summing all nodes' cost_usd fields. */
export function updateRunCost(state: RunState): void {
  state.total_cost_usd = Object.values(state.nodes).reduce(
    (sum, node) => sum + (node.cost_usd ?? 0),
    0,
  );
}

/** Mark a node as completed. Optionally records per-node cost and result excerpt. */
export function markNodeCompleted(
  state: RunState,
  nodeId: string,
  costUsd?: number,
  result?: string,
): void {
  const node = state.nodes[nodeId];
  const startedAt = node.started_at
    ? new Date(node.started_at).getTime()
    : Date.now();
  updateNodeState(state, nodeId, {
    status: "completed",
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  });
  if (costUsd !== undefined) {
    state.nodes[nodeId].cost_usd = costUsd;
    updateRunCost(state);
  }
  if (result !== undefined) {
    state.nodes[nodeId].result = result;
  }
}

/** Mark a node as failed. */
export function markNodeFailed(
  state: RunState,
  nodeId: string,
  error: string,
  error_category?: ErrorCategory,
): void {
  const node = state.nodes[nodeId];
  const startedAt = node.started_at
    ? new Date(node.started_at).getTime()
    : Date.now();
  updateNodeState(state, nodeId, {
    status: "failed",
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    error,
    error_category,
  });
}

/** Mark a node as waiting for human input (HITL). */
export function markNodeWaiting(
  state: RunState,
  nodeId: string,
  sessionId: string,
  questionJson: string,
): void {
  updateNodeState(state, nodeId, {
    status: "waiting",
    session_id: sessionId,
    question_json: questionJson,
  });
}

/** Mark a node as skipped. */
export function markNodeSkipped(state: RunState, nodeId: string): void {
  updateNodeState(state, nodeId, { status: "skipped" });
}

/** Mark the overall run as completed. */
export function markRunCompleted(state: RunState): void {
  state.status = "completed";
  state.completed_at = new Date().toISOString();
}

/** Mark the overall run as failed. */
export function markRunFailed(state: RunState): void {
  state.status = "failed";
  state.completed_at = new Date().toISOString();
}

/** Mark the overall run as aborted. */
export function markRunAborted(state: RunState): void {
  state.status = "aborted";
  state.completed_at = new Date().toISOString();
}

/** Get all node IDs with a specific status. */
export function getNodesByStatus(
  state: RunState,
  status: NodeStatus,
): string[] {
  return Object.entries(state.nodes)
    .filter(([_, node]) => node.status === status)
    .map(([id]) => id);
}

/** Check if a node is completed (for resume logic). */
export function isNodeCompleted(state: RunState, nodeId: string): boolean {
  return state.nodes[nodeId]?.status === "completed";
}

/** Get nodes that need to be (re-)executed on resume. */
export function getResumableNodes(state: RunState): string[] {
  return Object.entries(state.nodes)
    .filter(([_, node]) =>
      node.status !== "completed" && node.status !== "skipped"
    )
    .map(([id]) => id);
}
