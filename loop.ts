/**
 * @module
 * Loop node execution: iterates body nodes sequentially, checks an exit
 * condition after each iteration, and repeats until the condition matches
 * or max_iterations is reached. Condition values are extracted from YAML
 * frontmatter in body node output artifacts.
 * Entry points: {@link runLoop}, {@link extractConditionValue}.
 */

import { parse as parseYaml } from "@std/yaml";
import type {
  ErrorCategory,
  NodeConfig,
  NodeSettings,
  RunState,
  TemplateContext,
  Verbosity,
  WorkflowConfig,
} from "./types.ts";
import { buildLoopBodyOrder } from "./dag.ts";
import { runAgent } from "./agent.ts";
import type { AgentResult } from "./agent.ts";
import { markNodeCompleted, markNodeFailed, markNodeStarted } from "./state.ts";
import type { OutputManager } from "./output.ts";
import { resolveRuntimeConfig } from "@korchasa/ai-ide-cli/runtime";
import { resolveBudget, resolveToolFilter } from "./config.ts";

/** Reason a loop exited. Undefined on failure. */
export type LoopExitReason =
  | "exit_value"
  | "max_iterations"
  | "budget_preempt";

/** Result of a loop execution. */
export interface LoopResult {
  /** Whether the loop exited via its exit condition (true) or failed/exhausted (false). */
  success: boolean;
  /** Number of completed iterations. */
  iterations: number;
  /** Error description when the loop did not succeed. */
  error?: string;
  /** Categorized error type for observability and resume logic. */
  error_category?: ErrorCategory;
  /** Last observed value of the condition field before exit or exhaustion. */
  lastConditionValue?: string;
  /** Per-iteration AgentResult entries for log extraction by the engine. */
  bodyResults: AgentResult[];
  /** Why the loop exited; set on clean exits (FR-E47 adds `budget_preempt`). */
  exit_reason?: LoopExitReason;
}

/** Options for running a loop node. */
export interface LoopRunOptions {
  /** ID of the loop node in the workflow DAG. */
  loopNodeId: string;
  /** Full workflow configuration (nodes, defaults, env). */
  config: WorkflowConfig;
  /** Mutable run state shared with the engine. */
  state: RunState;
  /** Factory that builds a TemplateContext for a body node at a given iteration. */
  buildCtx: (nodeId: string, iteration: number) => TemplateContext;
  /** Called when a body node begins execution within an iteration. */
  onNodeStart?: (nodeId: string, iteration: number) => void;
  /** Called after a body node finishes (success or failure). */
  onNodeComplete?: (
    nodeId: string,
    iteration: number,
    result: AgentResult,
  ) => void;
  /** Called at the start of each loop iteration. */
  onIteration?: (iteration: number, maxIterations: number) => void;
  /** OutputManager for verbose diagnostics (forwarded to runAgent). */
  output?: OutputManager;
  /** Verbosity level for terminal output filtering (forwarded to runAgent). */
  verbosity?: Verbosity;
  /** Persist run state to disk after node completion. */
  saveState?: () => Promise<void>;
  /** Working directory for subprocesses (worktree path or undefined for CWD). */
  cwd?: string;
  /** Workflow-wide USD cap (FR-E47). When set, enforced after each body node
   * and consulted for the pre-iteration preempt heuristic. */
  budgetUsd?: number;
  /** Extra environment variables forwarded to body node agent invocations (FR-E49). */
  env?: Record<string, string>;
}

/**
 * FR-E47 pre-iteration budget preempt heuristic.
 * Returns true when the running-average iteration cost exceeds the remaining
 * budget — signalling the loop to exit cleanly with `budget_preempt`.
 * Advisory: uses the mean of completed iterations, so variance can produce
 * false positives (preempting a loop whose next iteration would have fit) or
 * false negatives. Must NOT be called with `completedIterations === 0`.
 */
export function shouldPreemptLoop(
  budgetUsd: number | undefined,
  totalRunCost: number,
  totalLoopCost: number,
  completedIterations: number,
): boolean {
  if (budgetUsd === undefined || completedIterations === 0) return false;
  const remaining = budgetUsd - totalRunCost;
  const avgIterCost = totalLoopCost / completedIterations;
  return avgIterCost > remaining;
}

/**
 * Execute a loop node: run body nodes sequentially, check condition,
 * repeat until exit_value or max_iterations.
 */
export async function runLoop(opts: LoopRunOptions): Promise<LoopResult> {
  const { loopNodeId, config, state } = opts;
  const loopNode = config.nodes[loopNodeId];

  if (loopNode.type !== "loop") {
    throw new Error(`Node '${loopNodeId}' is not a loop node`);
  }

  const maxIterations = loopNode.max_iterations ?? 3;
  const conditionNode = loopNode.condition_node!;
  const conditionField = loopNode.condition_field!;
  const exitValue = loopNode.exit_value!;

  // Get ordered body nodes
  const bodyOrder = buildLoopBodyOrder(config, loopNodeId);

  let lastConditionValue: string | undefined;
  const bodyResults: AgentResult[] = [];
  let totalLoopCost = 0;
  let completedIterations = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // FR-E47 pre-check: skip on iteration 1 (no cost data).
    if (
      iteration > 1 && shouldPreemptLoop(
        opts.budgetUsd,
        state.total_cost_usd ?? 0,
        totalLoopCost,
        completedIterations,
      )
    ) {
      opts.output?.status(
        loopNodeId,
        `BUDGET_PREEMPT iter=${iteration} avg=$${
          (totalLoopCost / completedIterations).toFixed(4)
        } remaining=$${
          (opts.budgetUsd! - (state.total_cost_usd ?? 0)).toFixed(4)
        }`,
      );
      return {
        success: true,
        iterations: completedIterations,
        lastConditionValue,
        bodyResults,
        exit_reason: "budget_preempt",
      };
    }

    opts.onIteration?.(iteration, maxIterations);
    let iterCost = 0;

    // Run each body node in order (from inline nodes sub-object)
    for (const bodyNodeId of bodyOrder) {
      const bodyNode = loopNode.nodes![bodyNodeId];
      const settings = bodyNode.settings as Required<NodeSettings>;
      const ctx = opts.buildCtx(bodyNodeId, iteration);
      const runtimeConfig = resolveRuntimeConfig({
        defaults: config.defaults,
        node: bodyNode,
        parent: loopNode,
      });

      opts.onNodeStart?.(bodyNodeId, iteration);
      markNodeStarted(state, bodyNodeId);

      const streamLogPath = `${ctx.node_dir}/stream.log`;

      const resolvedBudget = resolveBudget(
        bodyNode,
        config.defaults,
        loopNode,
      );
      const toolFilter = resolveToolFilter(
        bodyNode,
        config.defaults,
        loopNode,
      );

      const result = await runAgent({
        node: bodyNode,
        ctx,
        settings,
        runtime: runtimeConfig.runtime,
        runtimeArgs: runtimeConfig.args,
        permissionMode: runtimeConfig.permissionMode,
        model: runtimeConfig.model,
        allowedTools: toolFilter.allowedTools,
        disallowedTools: toolFilter.disallowedTools,
        hitlConfig: config.defaults?.hitl,
        output: opts.output,
        nodeId: bodyNodeId,
        streamLogPath,
        verbosity: opts.verbosity,
        cwd: opts.cwd,
        maxTurns: resolvedBudget?.max_turns,
        env: opts.env,
      });

      bodyResults.push(result);

      if (result.success) {
        markNodeCompleted(state, bodyNodeId, result.output?.total_cost_usd);

        // FR-E47 per-node check: body node cost is per-iteration
        const iterNodeCost = state.nodes[bodyNodeId].cost_usd ?? 0;
        iterCost += iterNodeCost;
        if (
          resolvedBudget?.max_usd !== undefined &&
          iterNodeCost > resolvedBudget.max_usd
        ) {
          const msg = `Node budget exceeded (iter ${iteration}): $${
            iterNodeCost.toFixed(4)
          } > $${resolvedBudget.max_usd.toFixed(4)}`;
          markNodeFailed(state, bodyNodeId, msg, "aborted");
          opts.onNodeComplete?.(bodyNodeId, iteration, {
            ...result,
            success: false,
            error: msg,
            error_category: "aborted",
          });
          await opts.saveState?.();
          return {
            success: false,
            iterations: iteration,
            error: msg,
            error_category: "aborted",
            lastConditionValue,
            bodyResults,
          };
        }
      } else {
        markNodeFailed(
          state,
          bodyNodeId,
          result.error ?? "Unknown error",
          result.error_category ?? "unknown",
        );
      }

      opts.onNodeComplete?.(bodyNodeId, iteration, result);
      await opts.saveState?.();

      if (!result.success) {
        return {
          success: false,
          iterations: iteration,
          error:
            `Body node '${bodyNodeId}' failed on iteration ${iteration}: ${result.error}`,
          error_category: result.error_category ?? "unknown",
          lastConditionValue,
          bodyResults,
        };
      }

      // FR-E47 workflow-wide check after each body node completion.
      // Propagate via exception → executeNode marks the loop node failed.
      if (opts.budgetUsd !== undefined) {
        const total = state.total_cost_usd ?? 0;
        if (total > opts.budgetUsd) {
          throw new Error(
            `Budget exceeded: $${total.toFixed(4)} > $${
              opts.budgetUsd.toFixed(4)
            }`,
          );
        }
      }
    }

    totalLoopCost += iterCost;
    completedIterations = iteration;

    // Check exit condition (condition node is in inline nodes sub-object).
    // extractConditionValue throws (FR-E36) if field is missing — treat as loop failure.
    let conditionValue: string;
    try {
      conditionValue = await extractConditionValue(
        opts.buildCtx(conditionNode, iteration),
        loopNode.nodes![conditionNode],
        conditionField,
        loopNodeId,
        conditionNode,
      );
    } catch (e) {
      return {
        success: false,
        iterations: iteration,
        error: e instanceof Error ? e.message : String(e),
        lastConditionValue,
        bodyResults,
      };
    }
    lastConditionValue = conditionValue;

    if (conditionValue === exitValue) {
      return {
        success: true,
        iterations: iteration,
        lastConditionValue,
        bodyResults,
        exit_reason: "exit_value",
      };
    }
  }

  return {
    success: false,
    iterations: maxIterations,
    error:
      `Loop '${loopNodeId}' reached max iterations (${maxIterations}) without exit condition. Last ${conditionField}=${lastConditionValue}, expected ${exitValue}`,
    error_category: "continuations_exhausted",
    lastConditionValue,
    bodyResults,
  };
}

/**
 * Extract a condition value from a node's output artifact.
 * Looks for YAML frontmatter in the first file matching a pattern,
 * or reads a dedicated condition file.
 *
 * Throws (FR-E36) if the field is not found — fail fast rather than
 * allowing the loop to continue with an undefined condition value.
 */
export async function extractConditionValue(
  ctx: TemplateContext,
  _node: NodeConfig,
  field: string,
  loopId: string,
  condNodeId: string,
): Promise<string> {
  // Strategy: look for the field in YAML frontmatter of any .md file
  // in the node's output directory
  const nodeDir = ctx.node_dir;

  try {
    for await (const entry of Deno.readDir(nodeDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;

      const content = await Deno.readTextFile(`${nodeDir}/${entry.name}`);
      const value = extractFrontmatterField(content, field);
      if (value !== undefined) return value;
    }
  } catch {
    // Directory may not exist or be empty — fall through to throw below
  }

  // Also check for a condition.json or condition.yaml file
  try {
    const jsonContent = await Deno.readTextFile(`${nodeDir}/condition.json`);
    const data = JSON.parse(jsonContent);
    if (field in data) return String(data[field]);
  } catch {
    // Not found
  }

  throw new Error(
    `Loop '${loopId}': condition_field '${field}' not found in condition node '${condNodeId}' output at '${nodeDir}'`,
  );
}

/** Extract a field from YAML frontmatter (between --- delimiters). */
export function extractFrontmatterField(
  content: string,
  field: string,
): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return undefined;

  try {
    const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
    if (field in frontmatter) {
      return String(frontmatter[field]);
    }
  } catch {
    // Invalid YAML frontmatter
  }

  return undefined;
}
