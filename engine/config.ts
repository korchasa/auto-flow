/**
 * @module
 * Pipeline config loading, schema validation, and default merging.
 * Entry points: {@link loadConfig} (file → PipelineConfig) and
 * {@link parseConfig} (YAML string → PipelineConfig).
 * Defaults are applied in a 3-tier cascade: hardcoded → pipeline-level → node-level.
 */

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
  model: "",
  hitl: {
    ask_script: "",
    check_script: "",
    poll_interval: 60,
    timeout: 7200,
  },
  on_failure_script: "",
  prepare_command: "",
};

/**
 * Extract only the `pre_run` field from YAML without full config parsing.
 * Used for two-phase loading: read pre_run → execute → re-read full config.
 */
export function extractPreRun(yaml: string): string | undefined {
  const raw = parseYaml(yaml);
  if (!raw || typeof raw !== "object") return undefined;
  const config = raw as Record<string, unknown>;
  const preRun = config.pre_run;
  return typeof preRun === "string" ? preRun : undefined;
}

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

  // Validate mutual exclusivity: phases block and per-node phase field cannot coexist
  if (config.phases) {
    const nodesWithPhaseField: string[] = [];
    for (const [nid, rawNode] of Object.entries(nodes)) {
      if ((rawNode as Record<string, unknown>).phase !== undefined) {
        nodesWithPhaseField.push(nid);
      }
    }
    if (nodesWithPhaseField.length > 0) {
      throw new Error(
        `Phase assignment conflict: top-level 'phases:' block and per-node 'phase:' field cannot coexist. ` +
          `Affected node(s): ${
            nodesWithPhaseField.join(", ")
          }. Use one mechanism only.`,
      );
    }
  }
}

/**
 * Validate a single node's required fields and type-specific constraints.
 *
 * Why recursive with widened ID set: loop body nodes may reference each other
 * (for intra-body ordering) in addition to top-level nodes. When we recurse
 * into loop body nodes we pass `[...allNodeIds, ...bodyNodeIds]` so that
 * inputs can resolve against both namespaces. Passing only `allNodeIds` would
 * falsely reject valid body-node cross-references.
 */
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

    // Validate loop input forwarding (FR-E35): body nodes referencing external inputs
    // must declare those inputs in the enclosing loop node's own inputs list.
    const loopInputs = new Set((node.inputs as string[] | undefined) ?? []);
    for (const [bodyId, rawBody] of Object.entries(bodyNodes)) {
      const bodyNode = rawBody as Record<string, unknown>;
      if (!Array.isArray(bodyNode.inputs)) continue;
      const missing = (bodyNode.inputs as string[]).filter(
        (inp: string) => !bodyNodeIds.includes(inp) && !loopInputs.has(inp),
      );
      if (missing.length > 0) {
        throw new Error(
          `Loop '${id}' body node '${bodyId}' references external input(s) [${
            missing.join(", ")
          }] not listed in loop inputs`,
        );
      }
    }

    // Validate condition_field vs frontmatter_field in condition node (FR-E36):
    // If condition node declares a validate block, it must include a frontmatter_field
    // rule whose 'field' matches condition_field — fail fast on misconfigured pipelines.
    // Skip if condition node has no validate block (no contract to enforce).
    const condNodeRaw = bodyNodes[node.condition_node as string] as Record<
      string,
      unknown
    >;
    if (
      Array.isArray(condNodeRaw.validate) && condNodeRaw.validate.length > 0
    ) {
      const rules = condNodeRaw.validate as Array<Record<string, unknown>>;
      const hasMatchingRule = rules.some(
        (r) =>
          r.type === "frontmatter_field" && r.field === node.condition_field,
      );
      if (!hasMatchingRule) {
        throw new Error(
          `Loop '${id}' condition_field '${node.condition_field}' is not declared as a frontmatter_field in condition node '${node.condition_node}' validate block`,
        );
      }
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
    "artifact",
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
  if (rule.type === "artifact") {
    if (!Array.isArray(rule.sections) || rule.sections.length === 0) {
      throw new Error(
        `Node '${nodeId}' artifact rule requires a non-empty 'sections' array`,
      );
    }
    if (
      !(rule.sections as unknown[]).every((e: unknown) => typeof e === "string")
    ) {
      throw new Error(
        `Node '${nodeId}' artifact rule 'sections' must be an array of strings`,
      );
    }
  }
}

/**
 * Merge pipeline defaults into each node's settings.
 *
 * Why 3-tier cascade: `DEFAULT_SETTINGS` (hardcoded engine fallbacks) →
 * `config.defaults` (pipeline-level overrides) → `node.settings` (per-node
 * overrides). Each tier wins over the one before it, so operators can set
 * pipeline-wide timeouts without touching every node, and nodes can still
 * override individually.
 *
 * Why `run_always` normalisation: `run_always: true` is a legacy shorthand
 * that predates the `run_on` enum. We canonicalise it to `run_on: "always"`
 * here so all downstream code only needs to handle `run_on`.
 */
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
  validateFileReferences(result);
  return result;
}

/**
 * Validate all non-template prompt paths exist on the filesystem
 * and cache their contents into node.prompt_content.
 * Accumulates all missing paths and throws a single error listing them all.
 * Paths containing `{{` are template variables — skipped (unresolvable at load time).
 */
export function validatePromptPaths(config: PipelineConfig): void {
  const missing: string[] = [];

  for (const node of Object.values(config.nodes)) {
    readPromptContent(node, missing);
    // Recurse into loop body nodes
    if (node.type === "loop" && node.nodes) {
      for (const bodyNode of Object.values(node.nodes)) {
        readPromptContent(bodyNode, missing);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing prompt files:\n  - ${missing.join("\n  - ")}`);
  }
}

/** Read prompt file content into node.prompt_content; append to missing[] on NotFound. */
function readPromptContent(node: NodeConfig, missing: string[]): void {
  if (!node.prompt || node.prompt.includes("{{")) return;
  try {
    node.prompt_content = Deno.readTextFileSync(node.prompt);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      missing.push(node.prompt);
    }
  }
}

/**
 * Validate all `{{file("path")}}` references in task_template and prompt fields.
 *
 * Scans top-level and loop body nodes. Paths containing `{{` are skipped
 * (unresolvable template variables at load time). Throws immediately on the
 * first missing file, including the node ID for context.
 */
export function validateFileReferences(config: PipelineConfig): void {
  const FILE_REF_RE = /\{\{file\("([^"]+)"\)\}\}/g;

  function scanNode(nodeId: string, node: NodeConfig): void {
    const fields = [node.task_template, node.prompt].filter(
      (f): f is string => typeof f === "string",
    );
    for (const field of fields) {
      FILE_REF_RE.lastIndex = 0;
      let match;
      while ((match = FILE_REF_RE.exec(field)) !== null) {
        const path = match[1];
        if (path.includes("{{")) continue;
        try {
          Deno.statSync(path);
        } catch {
          throw new Error(
            `Node '${nodeId}': {{file("${path}")}} — file not found: ${path}`,
          );
        }
      }
    }
  }

  for (const [id, node] of Object.entries(config.nodes)) {
    scanNode(id, node);
    if (node.type === "loop" && node.nodes) {
      for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
        scanNode(bodyId, bodyNode);
      }
    }
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

/**
 * Find a NodeConfig by ID, searching both top-level nodes and loop body nodes.
 * Returns undefined if not found.
 */
export function findNodeConfig(
  config: PipelineConfig,
  nodeId: string,
): NodeConfig | undefined {
  if (config.nodes[nodeId]) return config.nodes[nodeId];
  for (const node of Object.values(config.nodes)) {
    if (node.type === "loop" && node.nodes && node.nodes[nodeId]) {
      return node.nodes[nodeId];
    }
  }
  return undefined;
}

/**
 * Collect all node IDs including nested body nodes from loop `nodes` sub-objects.
 * Returns a flat list suitable for `createRunState()`.
 */
export function collectAllNodeIds(config: PipelineConfig): string[] {
  const ids: string[] = [];
  for (const [id, node] of Object.entries(config.nodes)) {
    ids.push(id);
    if (node.type === "loop" && node.nodes) {
      for (const bodyId of Object.keys(node.nodes)) {
        ids.push(bodyId);
      }
    }
  }
  return ids;
}

/** Extract NodeSettings fields from PipelineDefaults (exclude pipeline-only fields). */
function extractNodeSettings(defaults: PipelineDefaults): NodeSettings {
  const { max_parallel: _, claude_args: _ca, hitl: _hitl, ...settings } =
    defaults;
  return settings;
}
