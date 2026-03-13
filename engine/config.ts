import { parse as parseYaml } from "@std/yaml";
import type {
  NodeConfig,
  NodeSettings,
  PipelineConfig,
  PipelineDefaults,
} from "./types.ts";

/** Default node settings applied when not specified. */
export const DEFAULT_SETTINGS: Required<NodeSettings> = {
  max_continuations: 3,
  timeout_seconds: 1800,
  on_error: "fail",
  max_retries: 3,
  retry_delay_seconds: 5,
};

/** Default pipeline-level settings. */
export const DEFAULT_PIPELINE_DEFAULTS: Required<PipelineDefaults> = {
  ...DEFAULT_SETTINGS,
  max_parallel: 0,
  claude_args: [],
};

/** Parse YAML string into PipelineConfig, validate schema, merge defaults. */
export function parseConfig(yaml: string): PipelineConfig {
  const raw = parseYaml(yaml);
  if (!raw || typeof raw !== "object") {
    throw new Error("Pipeline config must be a YAML object");
  }
  const config = raw as Record<string, unknown>;
  validateSchema(config);
  return mergeDefaults(config as unknown as PipelineConfig);
}

/** Load and parse pipeline config from a file path. */
export async function loadConfig(path: string): Promise<PipelineConfig> {
  const yaml = await Deno.readTextFile(path);
  return parseConfig(yaml);
}

/** Validate required fields and node type constraints. */
function validateSchema(config: Record<string, unknown>): void {
  if (typeof config.name !== "string" || !config.name) {
    throw new Error("Pipeline config requires a non-empty 'name' field");
  }
  if (config.version !== "1") {
    throw new Error(
      `Unsupported pipeline config version: ${config.version}. Expected "1"`,
    );
  }
  if (
    !config.nodes || typeof config.nodes !== "object" ||
    Array.isArray(config.nodes)
  ) {
    throw new Error("Pipeline config requires a 'nodes' object");
  }

  const nodes = config.nodes as Record<string, unknown>;
  const nodeIds = Object.keys(nodes);

  if (nodeIds.length === 0) {
    throw new Error("Pipeline config must have at least one node");
  }

  for (const [id, rawNode] of Object.entries(nodes)) {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      throw new Error(`Node '${id}' must be an object`);
    }
    const node = rawNode as Record<string, unknown>;
    validateNode(id, node, nodeIds);
  }

  // Validate phases if present
  if (config.phases) {
    if (typeof config.phases !== "object" || Array.isArray(config.phases)) {
      throw new Error(
        "'phases' must be an object mapping phase names to node arrays",
      );
    }
    const phases = config.phases as Record<string, unknown>;
    const seenNodes = new Map<string, string>(); // nodeId → phaseName
    for (const [phaseName, phaseNodes] of Object.entries(phases)) {
      if (!Array.isArray(phaseNodes)) {
        throw new Error(`Phase '${phaseName}' must be an array of node IDs`);
      }
      for (const nodeId of phaseNodes) {
        if (!nodeIds.includes(nodeId as string)) {
          throw new Error(
            `Phase '${phaseName}' references unknown node '${nodeId}'`,
          );
        }
        const existing = seenNodes.get(nodeId as string);
        if (existing) {
          throw new Error(
            `Node '${nodeId}' appears in multiple phases: '${existing}' and '${phaseName}'`,
          );
        }
        seenNodes.set(nodeId as string, phaseName);
      }
    }
  }
}

function validateNode(
  id: string,
  node: Record<string, unknown>,
  allNodeIds: string[],
): void {
  const validTypes = ["agent", "merge", "loop", "human"];
  if (!validTypes.includes(node.type as string)) {
    throw new Error(
      `Node '${id}' has invalid type '${node.type}'. Must be one of: ${
        validTypes.join(", ")
      }`,
    );
  }

  if (typeof node.label !== "string" || !node.label) {
    throw new Error(`Node '${id}' requires a non-empty 'label' field`);
  }

  // Validate inputs reference existing nodes
  if (node.inputs) {
    if (!Array.isArray(node.inputs)) {
      throw new Error(`Node '${id}' inputs must be an array`);
    }
    for (const inputId of node.inputs) {
      if (typeof inputId !== "string") {
        throw new Error(`Node '${id}' inputs must be strings`);
      }
      if (!allNodeIds.includes(inputId)) {
        throw new Error(
          `Node '${id}' references unknown input node '${inputId}'`,
        );
      }
      if (inputId === id) {
        throw new Error(`Node '${id}' cannot reference itself as input`);
      }
    }
  }

  // Type-specific validation
  const type = node.type as string;

  if (type === "agent") {
    if (!node.prompt && !node.task_template) {
      throw new Error(
        `Agent node '${id}' requires at least 'prompt' or 'task_template'`,
      );
    }
  }

  if (type === "loop") {
    if (
      !node.nodes || typeof node.nodes !== "object" ||
      Array.isArray(node.nodes) || Object.keys(node.nodes).length === 0
    ) {
      throw new Error(
        `Loop node '${id}' requires a non-empty 'nodes' sub-object`,
      );
    }
    if (typeof node.condition_node !== "string") {
      throw new Error(`Loop node '${id}' requires 'condition_node'`);
    }
    if (typeof node.condition_field !== "string") {
      throw new Error(`Loop node '${id}' requires 'condition_field'`);
    }
    if (typeof node.exit_value !== "string") {
      throw new Error(`Loop node '${id}' requires 'exit_value'`);
    }

    const bodyNodes = node.nodes as Record<string, unknown>;
    const bodyNodeIds = Object.keys(bodyNodes);

    // condition_node must reference a key in nodes
    if (!bodyNodeIds.includes(node.condition_node as string)) {
      throw new Error(
        `Loop node '${id}' condition_node '${node.condition_node}' must be a key in 'nodes'`,
      );
    }

    // Validate body nodes: if >1 entry, at least one must declare inputs referencing another body node
    if (bodyNodeIds.length > 1) {
      let hasInternalInput = false;
      for (const bodyId of bodyNodeIds) {
        const bodyNode = bodyNodes[bodyId] as Record<string, unknown>;
        if (Array.isArray(bodyNode.inputs)) {
          for (const inp of bodyNode.inputs) {
            if (bodyNodeIds.includes(inp as string)) {
              hasInternalInput = true;
            }
          }
        }
      }
      if (!hasInternalInput) {
        throw new Error(
          `Loop node '${id}' has >1 body node: at least one body node must declare 'inputs' referencing another body node for ordering`,
        );
      }
    }

    // Validate each body node (using combined top-level + body node IDs for input resolution)
    const validInputIds = [...allNodeIds, ...bodyNodeIds];
    for (const [bodyId, rawBody] of Object.entries(bodyNodes)) {
      if (
        !rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)
      ) {
        throw new Error(
          `Loop node '${id}' body node '${bodyId}' must be an object`,
        );
      }
      const bodyNode = rawBody as Record<string, unknown>;
      validateNode(bodyId, bodyNode, validInputIds);
    }
  }

  if (type === "human") {
    if (typeof node.question !== "string" || !node.question) {
      throw new Error(
        `Human node '${id}' requires a non-empty 'question' field`,
      );
    }
  }

  // Validate run_on enum if present
  if (node.run_on !== undefined) {
    const validRunOn = ["always", "success", "failure"];
    if (!validRunOn.includes(node.run_on as string)) {
      throw new Error(
        `Node '${id}' has invalid run_on value '${node.run_on}'. Must be one of: always, success, failure`,
      );
    }
  }

  // Validate settings if present
  if (node.settings) {
    validateSettings(id, node.settings as Record<string, unknown>);
  }

  // Validate validation rules if present
  if (node.validate) {
    if (!Array.isArray(node.validate)) {
      throw new Error(`Node '${id}' validate must be an array`);
    }
    for (const rule of node.validate) {
      validateValidationRule(id, rule as Record<string, unknown>);
    }
  }
}

function validateSettings(
  nodeId: string,
  settings: Record<string, unknown>,
): void {
  const validKeys = [
    "max_continuations",
    "timeout_seconds",
    "on_error",
    "max_retries",
    "retry_delay_seconds",
  ];
  for (const key of Object.keys(settings)) {
    if (!validKeys.includes(key)) {
      throw new Error(
        `Node '${nodeId}' settings has unknown key '${key}'`,
      );
    }
  }
  if (
    settings.on_error !== undefined &&
    settings.on_error !== "fail" &&
    settings.on_error !== "continue"
  ) {
    throw new Error(
      `Node '${nodeId}' settings.on_error must be "fail" or "continue"`,
    );
  }
}

function validateValidationRule(
  nodeId: string,
  rule: Record<string, unknown>,
): void {
  const validTypes = [
    "file_exists",
    "file_not_empty",
    "contains_section",
    "custom_script",
    "frontmatter_field",
  ];
  if (!validTypes.includes(rule.type as string)) {
    throw new Error(
      `Node '${nodeId}' validation rule has invalid type '${rule.type}'`,
    );
  }
  if (typeof rule.path !== "string" || !rule.path) {
    throw new Error(
      `Node '${nodeId}' validation rule requires a non-empty 'path'`,
    );
  }
}

/** Merge pipeline defaults into each node's settings. */
function mergeDefaults(config: PipelineConfig): PipelineConfig {
  const pipelineDefaults: PipelineDefaults = {
    ...DEFAULT_PIPELINE_DEFAULTS,
    ...config.defaults,
  };

  const nodeDefaults = extractNodeSettings(pipelineDefaults);

  const mergedNodes: Record<string, NodeConfig> = {};
  for (const [id, node] of Object.entries(config.nodes)) {
    const merged: NodeConfig = {
      ...node,
      settings: {
        ...DEFAULT_SETTINGS,
        ...nodeDefaults,
        ...node.settings,
      },
    };

    // Also merge defaults into inline loop body nodes
    if (node.type === "loop" && node.nodes) {
      const mergedBodyNodes: Record<string, NodeConfig> = {};
      for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
        mergedBodyNodes[bodyId] = {
          ...bodyNode,
          settings: {
            ...DEFAULT_SETTINGS,
            ...nodeDefaults,
            ...bodyNode.settings,
          },
        };
      }
      merged.nodes = mergedBodyNodes;
    }

    // Normalize run_always → run_on
    if (merged.run_always !== undefined && merged.run_on === undefined) {
      if (merged.run_always === true) {
        merged.run_on = "always";
      }
    }
    // run_on wins when both present; delete legacy field
    delete merged.run_always;

    mergedNodes[id] = merged;
  }

  const result: PipelineConfig = {
    ...config,
    defaults: pipelineDefaults,
    nodes: mergedNodes,
  };
  validatePromptPaths(result);
  return result;
}

/**
 * Validate all non-template prompt paths exist on the filesystem.
 * Accumulates all missing paths and throws a single error listing them all.
 * Paths containing `{{` are template variables — skipped (unresolvable at load time).
 */
export function validatePromptPaths(config: PipelineConfig): void {
  const missing: string[] = [];

  for (const node of Object.values(config.nodes)) {
    if (node.prompt && !node.prompt.includes("{{")) {
      try {
        Deno.statSync(node.prompt);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          missing.push(node.prompt);
        }
      }
    }
    // Recurse into loop body nodes
    if (node.type === "loop" && node.nodes) {
      for (const bodyNode of Object.values(node.nodes)) {
        if (bodyNode.prompt && !bodyNode.prompt.includes("{{")) {
          try {
            Deno.statSync(bodyNode.prompt);
          } catch (e) {
            if (e instanceof Deno.errors.NotFound) {
              missing.push(bodyNode.prompt);
            }
          }
        }
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing prompt files:\n  - ${missing.join("\n  - ")}`);
  }
}

/** Collect all prompt file paths from a parsed pipeline config (including loop body nodes). */
export function collectPromptPaths(config: PipelineConfig): string[] {
  const paths: string[] = [];
  for (const node of Object.values(config.nodes)) {
    if (node.prompt) paths.push(node.prompt);
    if (node.type === "loop" && node.nodes) {
      for (const bodyNode of Object.values(node.nodes)) {
        if (bodyNode.prompt) paths.push(bodyNode.prompt);
      }
    }
  }
  return paths;
}

/** Extract NodeSettings fields from PipelineDefaults (exclude pipeline-only fields). */
function extractNodeSettings(defaults: PipelineDefaults): NodeSettings {
  const { max_parallel: _, claude_args: _ca, hitl: _hitl, ...settings } =
    defaults;
  return settings;
}
