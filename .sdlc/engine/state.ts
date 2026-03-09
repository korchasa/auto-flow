import type { NodeState, NodeStatus, RunState } from "./types.ts";

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

/** Create a fresh RunState for a new pipeline execution. */
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
  return `.sdlc/runs/${runId}`;
}

/** Get the node output directory path. */
export function getNodeDir(runId: string, nodeId: string): string {
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

/** Save RunState to state.json. */
export async function saveState(state: RunState): Promise<void> {
  const path = getStatePath(state.run_id);
  const dir = getRunDir(state.run_id);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2) + "\n");
}

/** Load RunState from state.json. */
export async function loadState(runId: string): Promise<RunState> {
  const path = getStatePath(runId);
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

/** Mark a node as completed. */
export function markNodeCompleted(state: RunState, nodeId: string): void {
  const node = state.nodes[nodeId];
  const startedAt = node.started_at
    ? new Date(node.started_at).getTime()
    : Date.now();
  updateNodeState(state, nodeId, {
    status: "completed",
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  });
}

/** Mark a node as failed. */
export function markNodeFailed(
  state: RunState,
  nodeId: string,
  error: string,
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
