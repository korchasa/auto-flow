/**
 * @module
 * Loop node execution: iterates body nodes sequentially, checks an exit
 * condition after each iteration, and repeats until the condition matches
 * or max_iterations is reached. Condition values are extracted from YAML
 * frontmatter in body node output artifacts.
 * Entry points: {@link runLoop}, {@link extractConditionValue}.
 */

import type {
  ErrorCategory,
  NodeConfig,
  ProcessRegistry,
  ResolvedNodeSettings,
  RunState,
  TemplateContext,
  Verbosity,
  WorkflowConfig,
} from "../types.ts";
import type { RuntimeAdapter } from "@korchasa/ai-ide-cli/runtime/types";
import { buildLoopBodyOrder } from "./dag.ts";
import { runAgent } from "./agent.ts";
import type { AgentResult } from "./agent.ts";
import {
  markNodeCompleted,
  markNodeFailed,
  markNodeStarted,
  workPath,
} from "../state/state.ts";
import { resultExcerpt } from "../state/run-journal.ts";
import type { OutputManager } from "../output.ts";
import { resolveRuntimeConfig } from "@korchasa/ai-ide-cli/runtime";
import { resolveBudget, resolveToolFilter } from "../config/config.ts";

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
  /** Persisted lifecycle hook for iteration start. */
  onIterationStarted?: (
    iteration: number,
    maxIterations: number,
  ) => Promise<void>;
  /** Persisted lifecycle hook for iteration completion. */
  onIterationCompleted?: (iteration: number) => Promise<void>;
  /** Persisted lifecycle hook for iteration failure. */
  onIterationFailed?: (
    iteration: number,
    error: string,
    errorCategory?: ErrorCategory,
  ) => Promise<void>;
  /** Persisted lifecycle hook for body-node runtime attempt start. */
  onAttemptStarted?: (nodeId: string, iteration: number) => Promise<void>;
  /** Persisted lifecycle hook for body-node runtime attempt completion. */
  onAttemptCompleted?: (
    nodeId: string,
    iteration: number,
    result: AgentResult,
  ) => Promise<void>;
  /** OutputManager for verbose diagnostics (forwarded to runAgent). */
  output?: OutputManager;
  /** Verbosity level for terminal output filtering (forwarded to runAgent). */
  verbosity?: Verbosity;
  /** Working directory for subprocesses (worktree path or undefined for CWD). */
  cwd?: string;
  /** Workflow-wide USD cap (FR-E47). When set, enforced after each body node
   * and consulted for the pre-iteration preempt heuristic. */
  budgetUsd?: number;
  /** Caller-supplied process tracker scope (FR-E60). Forwarded to every
   * body-node `runAgent` call so an embedding host's `killAll()` reaches
   * loop-body subprocesses too — without it they registered in the
   * `ai-ide-cli` default singleton and escaped the host's scope. */
  processRegistry?: ProcessRegistry;
  /** Runtime adapter substituted for every body-node invocation (FR-E86).
   * Omit to let `runAgent` resolve the real adapter per node. */
  runtimeAdapter?: RuntimeAdapter;
  /**
   * Route a HITL question raised by a body node (FR-L35).
   *
   * `runAgent` returns `{success: true, hitl_question}` when the observer
   * intercepts `request_human_input`: the artifact is deliberately absent
   * until the human replies. Without this hook the loop treated that as a
   * plain success, moved on, and failed later on a missing condition field —
   * the human was never asked. The engine wires it to `handleAgentHitl`;
   * when it is absent the loop fails the node explicitly rather than
   * continuing on an answer that will never arrive.
   *
   * Return an `AgentResult` when the question was answered and the body node
   * produced its artifact. Return `null` ONLY after recording the failure on
   * the node yourself — the loop then skips its own `nodeFailed` call and
   * reuses the cause you recorded, so one failed transition yields exactly one
   * lifecycle record.
   */
  onHitl?: (
    nodeId: string,
    result: AgentResult,
    iteration: number,
  ) => Promise<AgentResult | null>;
  /** Mark a body node as running and publish optional lifecycle callback. */
  nodeStarted?: (nodeId: string) => Promise<void>;
  /** Mark a body node as completed and publish optional lifecycle callback. */
  nodeCompleted?: (
    nodeId: string,
    costUsd?: number,
    result?: string,
  ) => Promise<void>;
  /** Mark a body node as failed and publish optional lifecycle callback. */
  nodeFailed?: (
    nodeId: string,
    error: string,
    errorCategory?: ErrorCategory,
  ) => Promise<void>;
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
 * True when a body-node result is a paused HITL turn rather than real work.
 *
 * `runAgent` reports `success: true` with `hitl_question` set once the
 * observer intercepts `request_human_input` and aborts the turn — the node's
 * artifact is deliberately absent until the human replies. Taking that at face
 * value let the loop advance to the next body node and fail several steps
 * later on a missing condition field, with the human never asked.
 */
export function carriesHitlQuestion(result: AgentResult): boolean {
  return result.hitl_question !== undefined && result.output !== undefined;
}

/**
 * Turn an unanswered HITL turn into an explicit body-node failure.
 *
 * @param reason `"unrouted"` — no router wired, so nobody can ever deliver the
 * answer; `"routing"` — the router ran and gave up.
 * @param recordedError the cause the router already wrote onto the node. Used
 * verbatim for `"routing"` so the loop-level error names the real problem
 * ("defaults.hitl not configured", an ask-script failure, a poll timeout)
 * instead of a generic restatement. Falls back to a generic message when the
 * router recorded nothing.
 */
export function hitlFailure(
  nodeId: string,
  result: AgentResult,
  reason: "unrouted" | "routing",
  recordedError?: string,
): AgentResult {
  return {
    ...result,
    success: false,
    error: reason === "unrouted"
      ? `Body node '${nodeId}' requested human input but the loop has no HITL router configured`
      : recordedError ?? `HITL handling failed for body node '${nodeId}'`,
    error_category: "unknown",
  };
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
    await opts.onIterationStarted?.(iteration, maxIterations);
    let iterCost = 0;

    // Run each body node in order (from inline nodes sub-object)
    for (const bodyNodeId of bodyOrder) {
      const bodyNode = loopNode.nodes![bodyNodeId];
      const settings = bodyNode.settings as ResolvedNodeSettings;
      const ctx = opts.buildCtx(bodyNodeId, iteration);
      const runtimeConfig = resolveRuntimeConfig({
        defaults: config.defaults,
        node: bodyNode,
        parent: loopNode,
      });

      state.nodes[bodyNodeId].iteration = iteration;
      opts.onNodeStart?.(bodyNodeId, iteration);
      if (opts.nodeStarted) {
        await opts.nodeStarted(bodyNodeId);
      } else {
        markNodeStarted(state, bodyNodeId);
      }
      await opts.onAttemptStarted?.(bodyNodeId, iteration);

      const streamLogPath = `${workPath(ctx.workDir, ctx.node_dir)}/stream.log`;

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

      let result = await runAgent({
        node: bodyNode,
        ctx,
        settings,
        runtime: runtimeConfig.runtime,
        runtimeArgs: runtimeConfig.args,
        permissionMode: runtimeConfig.permissionMode,
        model: runtimeConfig.model,
        reasoningEffort: runtimeConfig.reasoningEffort,
        allowedTools: toolFilter.allowedTools,
        disallowedTools: toolFilter.disallowedTools,
        hitlConfig: config.defaults?.hitl,
        runtimeAdapter: opts.runtimeAdapter,
        output: opts.output,
        nodeId: bodyNodeId,
        streamLogPath,
        verbosity: opts.verbosity,
        cwd: opts.cwd,
        maxTurns: resolvedBudget?.max_turns,
        processRegistry: opts.processRegistry,
      });

      // The agent asked a human something. Its artifact does not exist yet,
      // so treating this as success would corrupt the iteration.
      let routerOwnsFailure = false;
      if (carriesHitlQuestion(result)) {
        if (!opts.onHitl) {
          result = hitlFailure(bodyNodeId, result, "unrouted");
        } else {
          const routed = await opts.onHitl(bodyNodeId, result, iteration);
          if (routed) {
            result = routed;
          } else {
            // Null means the router already recorded the specific cause on the
            // node. Failing it again below would append a second `node_failed`
            // record for one transition and overwrite that cause with a
            // generic message, so carry the recorded cause forward instead.
            result = hitlFailure(
              bodyNodeId,
              result,
              "routing",
              state.nodes[bodyNodeId]?.error,
            );
            routerOwnsFailure = true;
          }
        }
      }

      bodyResults.push(result);
      await opts.onAttemptCompleted?.(bodyNodeId, iteration, result);

      if (result.success) {
        const excerpt = result.output
          ? resultExcerpt(result.output.result ?? "")
          : undefined;
        if (opts.nodeCompleted) {
          await opts.nodeCompleted(
            bodyNodeId,
            result.output?.total_cost_usd,
            excerpt,
          );
        } else {
          markNodeCompleted(
            state,
            bodyNodeId,
            result.output?.total_cost_usd,
            excerpt,
          );
        }

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
          if (opts.nodeFailed) {
            await opts.nodeFailed(bodyNodeId, msg, "aborted");
          } else {
            markNodeFailed(state, bodyNodeId, msg, "aborted");
          }
          opts.onNodeComplete?.(bodyNodeId, iteration, {
            ...result,
            success: false,
            error: msg,
            error_category: "aborted",
          });
          await opts.onIterationFailed?.(iteration, msg, "aborted");
          return {
            success: false,
            iterations: iteration,
            error: msg,
            error_category: "aborted",
            lastConditionValue,
            bodyResults,
          };
        }
      } else if (!routerOwnsFailure) {
        if (opts.nodeFailed) {
          await opts.nodeFailed(
            bodyNodeId,
            result.error ?? "Unknown error",
            result.error_category ?? "unknown",
          );
        } else {
          markNodeFailed(
            state,
            bodyNodeId,
            result.error ?? "Unknown error",
            result.error_category ?? "unknown",
          );
        }
      }

      opts.onNodeComplete?.(bodyNodeId, iteration, result);
      if (!result.success) {
        await opts.onIterationFailed?.(
          iteration,
          `Body node '${bodyNodeId}' failed on iteration ${iteration}: ${result.error}`,
          result.error_category ?? "unknown",
        );
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
      await opts.onIterationFailed?.(
        iteration,
        e instanceof Error ? e.message : String(e),
      );
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
      await opts.onIterationCompleted?.(iteration);
      return {
        success: true,
        iterations: iteration,
        lastConditionValue,
        bodyResults,
        exit_reason: "exit_value",
      };
    }
    await opts.onIterationCompleted?.(iteration);
  }

  await opts.onIterationFailed?.(
    maxIterations,
    `Loop '${loopNodeId}' reached max iterations (${maxIterations}) without exit condition. Last ${conditionField}=${lastConditionValue}, expected ${exitValue}`,
    "continuations_exhausted",
  );
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
  // in the node's output directory. ctx.node_dir is workDir-relative —
  // reconstruct cwd-correct path for FS access.
  const nodeDir = workPath(ctx.workDir, ctx.node_dir);

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

/**
 * Extract a scalar field from frontmatter (between --- delimiters).
 *
 * Returns `undefined` when the frontmatter block is missing or the field is
 * absent. Throws when the target field appears more than once, because a loop
 * condition must be unambiguous. This intentionally avoids parsing the whole
 * frontmatter as YAML: SDLC PDRs contain human-authored scalar fields such as
 * `source: pdr-pickup: documents/...` that are accepted by the validator's
 * field-specific parser but invalid as full YAML.
 */
export function extractFrontmatterField(
  content: string,
  field: string,
): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return undefined;

  const fieldPattern = new RegExp(`^${escapeRegex(field)}:\\s*(.*)$`, "gm");
  const matches = [...match[1].matchAll(fieldPattern)];
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new Error(`Duplicate frontmatter field '${field}'`);
  }

  return unquoteScalar(matches[0][1].trim());
}

function unquoteScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
