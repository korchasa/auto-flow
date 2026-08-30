/**
 * @module
 * DAG construction and topological sorting for workflow execution ordering.
 * Builds execution levels from node dependencies: each level is a set of
 * node IDs that can run in parallel. Loop body nodes are excluded from the
 * main DAG — managed by the loop executor internally.
 * Entry points: {@link buildDependencies}, {@link buildLevels},
 * {@link buildLoopBodyOrder}.
 */

import type { WorkflowConfig } from "../types.ts";
import { resolveBranchMembership } from "../config/config.ts";

/** Nodes grouped into parallel execution levels. */
export type ExecutionLevels = string[][];

/**
 * Build the dependency map the whole engine reads: node → nodes it waits for.
 *
 * Edges come from `inputs`, plus one source `inputs` cannot express: a `join`
 * node waits for every terminal node of every branch of its group (FR-E95). A
 * join carries no `inputs` of its own, so without this edge it would sort to
 * level 0 and the `--dry-run` plan would disagree with what actually runs.
 *
 * Cycle detection lives here rather than in the scheduler: a cyclic graph must
 * fail at load with the cycle named, not stall a ready set that can never fill.
 */
export function buildDependencies(
  config: WorkflowConfig,
): Map<string, Set<string>> {
  const loopBodyNodes = collectLoopBodyNodes(config);
  const nodeIds = Object.keys(config.nodes).filter(
    (id) => !loopBodyNodes.has(id),
  );

  const deps = new Map<string, Set<string>>();
  for (const id of nodeIds) {
    const node = config.nodes[id];
    const inputs = (node.inputs ?? []).filter((inp) => !loopBodyNodes.has(inp));
    deps.set(id, new Set(inputs));
  }

  for (const [group, terminals] of branchTerminals(config, loopBodyNodes)) {
    for (const id of nodeIds) {
      if (config.nodes[id].join !== group) continue;
      const own = deps.get(id) ?? new Set<string>();
      for (const terminal of terminals) own.add(terminal);
      deps.set(id, own);
    }
  }

  detectCycles(deps);
  return deps;
}

/**
 * For every fork group, the last node of each of its branches.
 *
 * A branch is several nodes chained by `inputs`; the join waits for the end of
 * each chain, not for the node that opened it. A node of a branch that no
 * sibling of the same branch takes as input is such an end.
 */
export function branchTerminals(
  config: WorkflowConfig,
  loopBodyNodes: Set<string>,
): Map<string, string[]> {
  const membership = resolveBranchMembership(config);
  const consumed = new Set<string>();
  for (const [id, node] of Object.entries(config.nodes)) {
    if (loopBodyNodes.has(id)) continue;
    const own = membership.get(id);
    if (!own) continue;
    for (const input of node.inputs ?? []) {
      const upstream = membership.get(input);
      if (
        upstream && upstream.group === own.group &&
        upstream.branch === own.branch
      ) {
        consumed.add(input);
      }
    }
  }

  const terminals = new Map<string, string[]>();
  for (const [id, own] of membership) {
    if (loopBodyNodes.has(id) || consumed.has(id)) continue;
    const list = terminals.get(own.group) ?? [];
    list.push(id);
    terminals.set(own.group, list);
  }
  for (const list of terminals.values()) list.sort();
  return terminals;
}

/**
 * Group nodes into parallel execution levels.
 *
 * A projection of {@link buildDependencies}, not a traversal of its own — the
 * plan a reader sees and the order the scheduler follows must come from one
 * source. The executor schedules by readiness instead; this shape is what
 * `--dry-run`, the bootstrap journal and drift detection read.
 */
export function buildLevels(config: WorkflowConfig): ExecutionLevels {
  return topoSort(buildDependencies(config));
}

/** Collect all node IDs defined inline in any loop's `nodes` sub-object. */
function collectLoopBodyNodes(config: WorkflowConfig): Set<string> {
  const bodyNodes = new Set<string>();
  for (const node of Object.values(config.nodes)) {
    if (node.type === "loop" && node.nodes) {
      for (const bodyId of Object.keys(node.nodes)) {
        bodyNodes.add(bodyId);
      }
    }
  }
  return bodyNodes;
}

/** Detect cycles using DFS. Throws on cycle detection. */
function detectCycles(deps: Map<string, Set<string>>): void {
  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;

  const state = new Map<string, number>();
  for (const id of deps.keys()) {
    state.set(id, UNVISITED);
  }

  const path: string[] = [];

  function dfs(node: string): void {
    state.set(node, IN_PROGRESS);
    path.push(node);

    for (const dep of deps.get(node) ?? []) {
      const s = state.get(dep);
      if (s === IN_PROGRESS) {
        const cycleStart = path.indexOf(dep);
        const cycle = path.slice(cycleStart).concat(dep);
        throw new Error(
          `Cycle detected in workflow DAG: ${cycle.join(" → ")}`,
        );
      }
      if (s === UNVISITED) {
        dfs(dep);
      }
    }

    path.pop();
    state.set(node, DONE);
  }

  for (const id of deps.keys()) {
    if (state.get(id) === UNVISITED) {
      dfs(id);
    }
  }
}

/**
 * Topological sort into levels (Kahn's algorithm variant).
 * Level 0: nodes with no dependencies.
 * Level N: nodes whose dependencies are all in levels < N.
 */
export function topoSort(deps: Map<string, Set<string>>): ExecutionLevels {
  const levels: ExecutionLevels = [];
  const remaining = new Map<string, Set<string>>();

  for (const [id, d] of deps) {
    remaining.set(id, new Set(d));
  }

  while (remaining.size > 0) {
    // Find nodes with no remaining dependencies
    const level: string[] = [];
    for (const [id, d] of remaining) {
      if (d.size === 0) {
        level.push(id);
      }
    }

    if (level.length === 0) {
      // Should not happen after cycle detection, but defensive
      throw new Error(
        `Cannot resolve dependencies for nodes: ${
          [...remaining.keys()].join(", ")
        }`,
      );
    }

    // Sort within level for deterministic ordering
    level.sort();
    levels.push(level);

    // Remove resolved nodes from remaining and from other nodes' deps
    const resolved = new Set(level);
    for (const id of level) {
      remaining.delete(id);
    }
    for (const d of remaining.values()) {
      for (const r of resolved) {
        d.delete(r);
      }
    }
  }

  return levels;
}

/** Get the order of body nodes for a loop, resolving internal dependencies.
 * Reads from the loop's inline `nodes` sub-object, topo-sorts by `inputs`. */
export function buildLoopBodyOrder(
  config: WorkflowConfig,
  loopNodeId: string,
): string[] {
  const loopNode = config.nodes[loopNodeId];
  if (loopNode.type !== "loop" || !loopNode.nodes) {
    throw new Error(`Node '${loopNodeId}' is not a loop node`);
  }

  const bodyNodeIds = Object.keys(loopNode.nodes);
  const bodySet = new Set(bodyNodeIds);
  const deps = new Map<string, Set<string>>();

  for (const id of bodyNodeIds) {
    const node = loopNode.nodes[id];
    // Only consider inputs that are within the loop body for ordering
    const internalInputs = (node.inputs ?? []).filter((inp) =>
      bodySet.has(inp)
    );
    deps.set(id, new Set(internalInputs));
  }

  // Use the same topo sort, but flatten into a single ordered list
  const levels = topoSort(deps);
  return levels.flat();
}
