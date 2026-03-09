import { parse as parseYaml } from "@std/yaml";
import type {
  NodeConfig,
  NodeSettings,
  PipelineConfig,
  RunState,
  TemplateContext,
} from "./types.ts";
import { buildLoopBodyOrder } from "./dag.ts";
import { runAgent } from "./agent.ts";
import type { AgentResult } from "./agent.ts";
import { markNodeCompleted, markNodeFailed, markNodeStarted } from "./state.ts";

/** Result of a loop execution. */
export interface LoopResult {
  success: boolean;
  iterations: number;
  error?: string;
  lastConditionValue?: string;
}

/** Options for running a loop node. */
export interface LoopRunOptions {
  loopNodeId: string;
  config: PipelineConfig;
  state: RunState;
  buildCtx: (nodeId: string, iteration: number) => TemplateContext;
  onNodeStart?: (nodeId: string, iteration: number) => void;
  onNodeComplete?: (
    nodeId: string,
    iteration: number,
    result: AgentResult,
  ) => void;
  onIteration?: (iteration: number, maxIterations: number) => void;
  onOutput?: (nodeId: string, line: string) => void;
  saveState?: () => Promise<void>;
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

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    opts.onIteration?.(iteration, maxIterations);

    // Run each body node in order
    for (const bodyNodeId of bodyOrder) {
      const bodyNode = config.nodes[bodyNodeId];
      const settings = bodyNode.settings as Required<NodeSettings>;
      const ctx = opts.buildCtx(bodyNodeId, iteration);

      opts.onNodeStart?.(bodyNodeId, iteration);
      markNodeStarted(state, bodyNodeId);

      const result = await runAgent({
        node: bodyNode,
        ctx,
        settings,
        claudeArgs: config.defaults?.claude_args,
        onOutput: opts.onOutput
          ? (line: string) => opts.onOutput!(bodyNodeId, line)
          : undefined,
      });

      if (result.success) {
        markNodeCompleted(state, bodyNodeId);
      } else {
        markNodeFailed(state, bodyNodeId, result.error ?? "Unknown error");
      }

      opts.onNodeComplete?.(bodyNodeId, iteration, result);
      await opts.saveState?.();

      if (!result.success) {
        return {
          success: false,
          iterations: iteration,
          error:
            `Body node '${bodyNodeId}' failed on iteration ${iteration}: ${result.error}`,
          lastConditionValue,
        };
      }
    }

    // Check exit condition
    const conditionValue = await extractConditionValue(
      opts.buildCtx(conditionNode, iteration),
      config.nodes[conditionNode],
      conditionField,
    );
    lastConditionValue = conditionValue;

    if (conditionValue === exitValue) {
      return {
        success: true,
        iterations: iteration,
        lastConditionValue,
      };
    }
  }

  return {
    success: false,
    iterations: maxIterations,
    error:
      `Loop '${loopNodeId}' reached max iterations (${maxIterations}) without exit condition. Last ${conditionField}=${lastConditionValue}, expected ${exitValue}`,
    lastConditionValue,
  };
}

/**
 * Extract a condition value from a node's output artifact.
 * Looks for YAML frontmatter in the first file matching a pattern,
 * or reads a dedicated condition file.
 */
async function extractConditionValue(
  ctx: TemplateContext,
  _node: NodeConfig,
  field: string,
): Promise<string | undefined> {
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
    // Directory may not exist or be empty
  }

  // Also check for a condition.json or condition.yaml file
  try {
    const jsonContent = await Deno.readTextFile(`${nodeDir}/condition.json`);
    const data = JSON.parse(jsonContent);
    if (field in data) return String(data[field]);
  } catch {
    // Not found
  }

  return undefined;
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
