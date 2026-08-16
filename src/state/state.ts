/**
 * @module
 * Run-state management: create and update in-memory RunState across a
 * workflow execution. Durable recovery is owned by `journal.jsonl`
 * replay. Also defines {@link PhaseRegistry}, the per-run
 * `nodeId → phase` mapping used for computing node output directory paths.
 */

import { isAbsolute } from "@std/path";
import type {
  ErrorCategory,
  NodeState,
  NodeStatus,
  RunState,
  WorkflowConfig,
} from "../types.ts";

// --- FR-E9 / FR-E59: Phase Registry ---

/**
 * Per-run mapping `nodeId → phase name`. Each `Engine.run()` instantiates a
 * fresh registry from the workflow config and threads it through
 * {@link getNodeDir} / {@link buildTaskPaths}. No module-level state — two
 * back-to-back runs in the same Deno process keep their phase mappings
 * isolated, which is required for library-embedding hosts that drive a
 * sequential queue of `Engine.run()` calls.
 */
export class PhaseRegistry {
  readonly #map: Map<string, string>;

  private constructor(map: Map<string, string>) {
    this.#map = map;
  }

  /**
   * Build a registry from a workflow config. Config validation (parseConfig)
   * guarantees mutual exclusivity between the top-level `phases:` block and
   * per-node `phase:` fields, so this honors whichever mechanism is present.
   */
  static fromConfig(config: WorkflowConfig): PhaseRegistry {
    const map = new Map<string, string>();
    if (config.phases) {
      for (const [phase, nodeIds] of Object.entries(config.phases)) {
        for (const nodeId of nodeIds) map.set(nodeId, phase);
      }
    } else {
      for (const [nodeId, node] of Object.entries(config.nodes)) {
        if (node.phase) map.set(nodeId, node.phase);
      }
    }
    return new PhaseRegistry(map);
  }

  /** Return an empty registry — used by callers that have no phase mapping
   * (legacy back-compat in path helpers, dry-run summaries, tests). */
  static empty(): PhaseRegistry {
    return new PhaseRegistry(new Map());
  }

  /** Return the phase for a node, or undefined if not registered. */
  get(nodeId: string): string | undefined {
    return this.#map.get(nodeId);
  }
}

// --- Path-safety guards for externally supplied identifiers ---

/**
 * Reject a run-id / node-id that is not a single, inert path segment.
 *
 * `getRunDir` / `getNodeDir` build paths by string concatenation, so an id
 * carrying `/`, `\` or `..` escapes the `runs/` subtree entirely. Every
 * boundary that accepts these ids from outside the engine (MCP tool
 * arguments, CLI positionals) MUST call this first — the path helpers stay
 * dumb concatenators by design.
 *
 * @param value — the untrusted identifier.
 * @param label — field name used in the error message (e.g. `run_id`).
 */
export function assertSafeSegment(value: string, label: string): void {
  if (value === "") {
    throw new Error(`${label} must not be empty`);
  }
  if (value === "." || value === "..") {
    throw new Error(`${label} must not be '.' or '..' (got '${value}')`);
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new Error(
      `${label} must be a single path segment without '/' or '\\' (got '${value}')`,
    );
  }
  if (value.includes("\0")) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
}

/**
 * Reject a relative artifact path that escapes its node directory.
 *
 * Unlike {@link assertSafeSegment} this permits nested directories (agents do
 * write `logs/foo.json`), but forbids absolute paths and any `..` segment, so
 * the resolved path can never leave the node directory it is joined onto.
 *
 * @param value — the untrusted relative path.
 * @param label — field name used in the error message (e.g. `filename`).
 */
export function assertSafeRelativePath(value: string, label: string): void {
  if (value === "") {
    throw new Error(`${label} must not be empty`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  if (value.startsWith("/") || /^[A-Za-z]:[/\\]/.test(value)) {
    throw new Error(`${label} must be a relative path (got '${value}')`);
  }
  const segments = value.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(
      `${label} must not contain '..' path segments (got '${value}')`,
    );
  }
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

/** Default workflow directory used when no explicit one is supplied.
 * Preserves backward compatibility for legacy callers / tests that predate
 * FR-E53 (workflow folder = `.flowai-workflow/<name>/`). Production callers
 * (Engine, CLI) always pass an explicit `workflowDir`. */
export const DEFAULT_WORKFLOW_DIR = ".flowai-workflow";

/** Get the run directory path for a given run ID.
 * @param workflowDir — base workflow folder; defaults to `.flowai-workflow` for
 *   legacy callers. FR-E9: Engine threads `path.dirname(configPath)` here so
 *   runs land under `<workflowDir>/runs/<run-id>` regardless of layout. */
export function getRunDir(
  runId: string,
  workflowDir: string = DEFAULT_WORKFLOW_DIR,
): string {
  return `${workflowDir}/runs/${runId}`;
}

/** Get the node output directory path.
 * Returns `<runDir>/<phase>/<nodeId>/` when the supplied registry maps the
 * node to a phase, otherwise flat `<runDir>/<nodeId>/`. When `phaseRegistry`
 * is omitted, behaves as if the registry were empty (back-compat for callers
 * that predate phase support, e.g. dry-run summaries and unit tests). */
export function getNodeDir(
  runId: string,
  nodeId: string,
  workflowDir: string = DEFAULT_WORKFLOW_DIR,
  phaseRegistry?: PhaseRegistry,
): string {
  const phase = phaseRegistry?.get(nodeId);
  if (phase) {
    return `${getRunDir(runId, workflowDir)}/${phase}/${nodeId}`;
  }
  return `${getRunDir(runId, workflowDir)}/${nodeId}`;
}

/** Get the local HITL answer inbox file path for a waiting node (FR-E75).
 *
 * Anchored at the run directory — NOT the phased node-dir — so the live
 * poll-loop reader ({@link runHitlLoop}, which holds the absolute `runDir`)
 * and the external writer (`commands.ts`, which computes
 * `getRunDir(runId, workflowDir)`) resolve the identical path with zero
 * {@link PhaseRegistry}/worktree coupling. The file content is the reply
 * text verbatim (mirrors the `check_script` stdout contract). Lives under
 * the gitignored `runs/**` tree.
 *
 * @param runDir — the run's root directory (e.g. `getRunDir(runId, workflowDir)`).
 * @param nodeId — the waiting node whose inbox file is addressed.
 */
export function getHitlInboxPath(runDir: string, nodeId: string): string {
  return `${runDir}/.hitl-inbox/${nodeId}.txt`;
}

/** Get the logs directory for a run. */
export function getLogsDir(
  runId: string,
  workflowDir: string = DEFAULT_WORKFLOW_DIR,
): string {
  return `${getRunDir(runId, workflowDir)}/logs`;
}

/**
 * Prefix a relative path with workDir. No-op when workDir is ".".
 *
 * An already-absolute path is returned untouched: it is not workDir-relative,
 * so joining it to a working directory would produce a path that exists
 * nowhere. FR-E91 relies on this — a node running in a worktree of its own
 * carries absolute artifact paths anchored at the run's shared tree, and every
 * existing `workPath` call site must leave them alone.
 */
export function workPath(workDir: string, relativePath: string): string {
  if (workDir === "." || isAbsolute(relativePath)) return relativePath;
  return `${workDir}/${relativePath}`;
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
  workflowDir: string = DEFAULT_WORKFLOW_DIR,
  phaseRegistry?: PhaseRegistry,
): {
  node_dir: string;
  run_dir: string;
  input: Record<string, string>;
} {
  const input: Record<string, string> = {};
  for (const id of inputs) {
    input[id] = getNodeDir(runId, id, workflowDir, phaseRegistry);
  }
  return {
    node_dir: getNodeDir(runId, nodeId, workflowDir, phaseRegistry),
    run_dir: getRunDir(runId, workflowDir),
    input,
  };
}

/** Update a single node's in-memory state. */
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
