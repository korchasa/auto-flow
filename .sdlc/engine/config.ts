import { parse as parseYaml } from "jsr:@std/yaml";
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
    if (!node.body || !Array.isArray(node.body) || node.body.length === 0) {
      throw new Error(`Loop node '${id}' requires a non-empty 'body' array`);
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
    // body nodes must be in allNodeIds
    for (const bodyId of node.body as string[]) {
      if (!allNodeIds.includes(bodyId)) {
        throw new Error(
          `Loop node '${id}' body references unknown node '${bodyId}'`,
        );
      }
    }
    if (!node.body.includes(node.condition_node)) {
      throw new Error(
        `Loop node '${id}' condition_node '${node.condition_node}' must be in body`,
      );
    }
  }

  if (type === "human") {
    if (typeof node.question !== "string" || !node.question) {
      throw new Error(
        `Human node '${id}' requires a non-empty 'question' field`,
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

  const mergedNodes: Record<string, NodeConfig> = {};
  for (const [id, node] of Object.entries(config.nodes)) {
    mergedNodes[id] = {
      ...node,
      settings: {
        ...DEFAULT_SETTINGS,
        ...extractNodeSettings(pipelineDefaults),
        ...node.settings,
      },
    };
  }

  return {
    ...config,
    defaults: pipelineDefaults,
    nodes: mergedNodes,
  };
}

/** Extract NodeSettings fields from PipelineDefaults (exclude max_parallel). */
function extractNodeSettings(defaults: PipelineDefaults): NodeSettings {
  const { max_parallel: _, ...settings } = defaults;
  return settings;
}
