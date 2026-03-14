import type { NodeConfig, RunState } from "./types.ts";
import type { OutputManager } from "./output.ts";
import { topoSort } from "./dag.ts";
import { isNodeCompleted, markNodeSkipped, saveState } from "./state.ts";

/**
 * Collect node IDs with `run_on` set from pipeline config.
 * These nodes execute in a final post-pipeline step after all DAG levels complete.
 */
export function collectPostPipelineNodes(
  nodes: Record<string, NodeConfig>,
): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => node.run_on !== undefined)
    .map(([id]) => id);
}

/**
 * Sort post-pipeline nodes topologically using their `inputs` field.
 * Only considers dependencies within the post-pipeline subset.
 * Guarantees e.g. post-B (inputs: [post-A]) runs after post-A.
 */
export function sortPostPipelineNodes(
  postPipelineIds: string[],
  nodes: Record<string, NodeConfig>,
): string[] {
  const subset = new Set(postPipelineIds);
  const deps = new Map<string, Set<string>>();
  for (const id of postPipelineIds) {
    const node = nodes[id];
    const internalInputs = (node.inputs ?? []).filter((inp) => subset.has(inp));
    deps.set(id, new Set(internalInputs));
  }
  const levels = topoSort(deps);
  return levels.flat();
}

/**
 * Execute the on_failure_script hook (domain-agnostic).
 * Swallows errors — failure hook must not crash the engine.
 */
export async function runFailureHook(
  script: string | undefined,
  output: OutputManager,
): Promise<void> {
  if (!script) return;
  try {
    const cmd = new Deno.Command(script, {
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();
    if (stdout) output.status("engine", `Hook stdout: ${stdout}`);
    if (stderr) output.warn(`Hook stderr: ${stderr}`);
    if (!result.success) {
      output.warn(`Failure hook exited with code ${result.code}`);
    } else {
      output.status("engine", "Failure hook completed");
    }
  } catch (err) {
    output.warn(`Failure hook error: ${(err as Error).message}`);
  }
}

/** Options for executePostPipeline. */
export interface PostPipelineOptions {
  nodeIds: string[];
  nodes: Record<string, NodeConfig>;
  state: RunState;
  pipelineSuccess: boolean;
  failureScript?: string;
  output: OutputManager;
  /** Execute a single node by ID. Errors are swallowed by executePostPipeline. */
  executeNode: (nodeId: string) => Promise<boolean>;
}

/**
 * Execute post-pipeline nodes (those with `run_on` set).
 * Runs failure hook if pipeline failed, then executes each node filtered by run_on condition.
 * Node errors are swallowed — post-pipeline failures must not block finalization.
 */
export async function executePostPipeline(
  opts: PostPipelineOptions,
): Promise<void> {
  const {
    nodeIds,
    nodes,
    state,
    pipelineSuccess,
    failureScript,
    output,
    executeNode,
  } = opts;

  if (nodeIds.length === 0) return;

  if (!pipelineSuccess) {
    await runFailureHook(failureScript, output);
  }

  for (const nodeId of nodeIds) {
    if (isNodeCompleted(state, nodeId)) continue;

    const nodeRunOn = nodes[nodeId].run_on;
    if (nodeRunOn === "success" && !pipelineSuccess) {
      markNodeSkipped(state, nodeId);
      output.nodeSkipped(nodeId, "skipped: run_on=success but pipeline failed");
      await saveState(state);
      continue;
    }
    if (nodeRunOn === "failure" && pipelineSuccess) {
      markNodeSkipped(state, nodeId);
      output.nodeSkipped(
        nodeId,
        "skipped: run_on=failure but pipeline succeeded",
      );
      await saveState(state);
      continue;
    }

    try {
      await executeNode(nodeId);
    } catch (err) {
      output.warn(
        `Post-pipeline node ${nodeId} failed: ${(err as Error).message}`,
      );
    }
  }
}
