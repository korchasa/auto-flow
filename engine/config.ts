/**
 * @module
 * Workflow config loading, schema validation, and default merging.
 * Entry points: {@link loadConfig} (file → WorkflowConfig) and
 * {@link parseConfig} (YAML string → WorkflowConfig).
 * Defaults are applied in a 3-tier cascade: hardcoded → workflow-level → node-level.
 */

import { parse as parseYaml } from "@std/yaml";
import { validateTemplateVars } from "./template.ts";
import { VALID_PERMISSION_MODES } from "./types.ts";
import type {
  NodeConfig,
  NodeSettings,
  WorkflowConfig,
  WorkflowDefaults,
} from "./types.ts";

/** Default node settings applied when not specified. */
export const DEFAULT_SETTINGS: Required<NodeSettings> = {
  max_continuations: 3,
  timeout_seconds: 1800,
  on_error: "fail",
  max_retries: 3,
  retry_delay_seconds: 5,
};

/** Default workflow-level settings (permission_mode intentionally excluded — undefined means "not set"). */
export const DEFAULT_WORKFLOW_DEFAULTS: Required<
  Omit<WorkflowDefaults, "permission_mode">
> = {
  ...DEFAULT_SETTINGS,
  worktree_disabled: false,
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
 * Extract only `worktree_disabled` from YAML without full config parsing.
 * Used for two-phase loading: check worktree_disabled → create worktree → load full config from worktree.
 */
export function extractWorktreeDisabled(yaml: string): boolean {
  const raw = parseYaml(yaml);
  if (!raw || typeof raw !== "object") return false;
  const config = raw as Record<string, unknown>;
  if (!config.defaults || typeof config.defaults !== "object") return false;
  const defaults = config.defaults as Record<string, unknown>;
  return defaults.worktree_disabled === true;
}

/** Parse YAML string into WorkflowConfig, validate schema, merge defaults.
 * @param workDir — base directory for resolving {{file()}} references. */
export function parseConfig(yaml: string, workDir?: string): WorkflowConfig {
  const raw = parseYaml(yaml);
  if (!raw || typeof raw !== "object") {
    throw new Error("Workflow config must be a YAML object");
  }
  const config = raw as Record<string, unknown>;
  validateSchema(config);
  return mergeDefaults(config as unknown as WorkflowConfig, workDir);
}

/** Load and parse workflow config from a file path.
 * @param workDir — base directory for resolving {{file()}} references. */
export async function loadConfig(
  path: string,
  workDir?: string,
): Promise<WorkflowConfig> {
  const yaml = await Deno.readTextFile(path);
  return parseConfig(yaml, workDir);
}

/** Validate required fields and node type constraints. */
function validateSchema(config: Record<string, unknown>): void {
  // Reject removed pre_run field with migration message
  if ("pre_run" in config) {
    throw new Error(
      "pre_run removed; worktree isolation replaces it. Set defaults.worktree_disabled: true to opt out.",
    );
  }
  if (typeof config.name !== "string" || !config.name) {
    throw new Error("Workflow config requires a non-empty 'name' field");
  }
  if (config.version !== "1") {
    throw new Error(
      `Unsupported workflow config version: ${config.version}. Expected "1"`,
    );
  }
  if (
    !config.nodes || typeof config.nodes !== "object" ||
    Array.isArray(config.nodes)
  ) {
    throw new Error("Workflow config requires a 'nodes' object");
  }

  const nodes = config.nodes as Record<string, unknown>;
  const nodeIds = Object.keys(nodes);

  if (nodeIds.length === 0) {
    throw new Error("Workflow config must have at least one node");
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

  // Validate defaults.permission_mode if present
  if (config.defaults && typeof config.defaults === "object") {
    const defaults = config.defaults as Record<string, unknown>;
    if (defaults.permission_mode !== undefined) {
      if (
        !VALID_PERMISSION_MODES.includes(defaults.permission_mode as string)
      ) {
        throw new Error(
          `defaults.permission_mode has invalid value '${defaults.permission_mode}'. Must be one of: ${
            VALID_PERMISSION_MODES.join(", ")
          }`,
        );
      }
      // Conflict detection: permission_mode vs permission-related claude_args
      if (Array.isArray(defaults.claude_args)) {
        const args = defaults.claude_args as string[];
        if (
          args.includes("--dangerously-skip-permissions") ||
          args.includes("--permission-mode")
        ) {
          throw new Error(
            "Conflict: defaults.permission_mode and permission-related flags in defaults.claude_args cannot coexist. " +
              "Remove --dangerously-skip-permissions or --permission-mode from claude_args.",
          );
        }
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
    if (!node.prompt) {
      throw new Error(
        `Agent node '${id}' requires a 'prompt' field`,
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
    // rule whose 'field' matches condition_field — fail fast on misconfigured workflows.
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

  // Validate hook template variables (FR-E7)
  if (typeof node.before === "string" && node.before) {
    const errors = validateTemplateVars(node.before, allNodeIds);
    if (errors.length > 0) {
      throw new Error(
        `Node '${id}' before hook has invalid template variables: ${
          errors.join("; ")
        }`,
      );
    }
  }
  if (typeof node.after === "string" && node.after) {
    const errors = validateTemplateVars(node.after, allNodeIds);
    if (errors.length > 0) {
      throw new Error(
        `Node '${id}' after hook has invalid template variables: ${
          errors.join("; ")
        }`,
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

  // Validate permission_mode if present
  if (node.permission_mode !== undefined) {
    if (!VALID_PERMISSION_MODES.includes(node.permission_mode as string)) {
      throw new Error(
        `Node '${id}' has invalid permission_mode '${node.permission_mode}'. Must be one of: ${
          VALID_PERMISSION_MODES.join(", ")
        }`,
      );
    }
  }

  // Validate allowed_paths if present (FR-E37)
  if (node.allowed_paths !== undefined) {
    validateAllowedPaths(id, node.allowed_paths);
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
    const hasSections = Array.isArray(rule.sections) &&
      rule.sections.length > 0;
    const hasFields = Array.isArray(rule.fields) &&
      (rule.fields as unknown[]).length > 0;

    if (!hasSections && !hasFields) {
      throw new Error(
        `Node '${nodeId}' artifact rule requires at least one of 'sections' or 'fields'`,
      );
    }

    if (Array.isArray(rule.sections)) {
      if (
        !(rule.sections as unknown[]).every(
          (e: unknown) => typeof e === "string",
        )
      ) {
        throw new Error(
          `Node '${nodeId}' artifact rule 'sections' must be an array of strings`,
        );
      }
    }

    if (Array.isArray(rule.fields)) {
      for (const entry of rule.fields) {
        if (typeof entry !== "string" || !entry) {
          throw new Error(
            `Node '${nodeId}' artifact rule 'fields' must be an array of non-empty strings`,
          );
        }
      }
    }
  }
}

/**
 * Validate the allowed_paths field on a node.
 * Must be an array of non-empty strings (glob patterns).
 * Called from validateNode() when allowed_paths is present (FR-E37).
 */
function validateAllowedPaths(
  nodeId: string,
  allowedPaths: unknown,
): void {
  if (!Array.isArray(allowedPaths)) {
    throw new Error(
      `Node '${nodeId}' allowed_paths must be an array of strings`,
    );
  }
  for (const entry of allowedPaths) {
    if (typeof entry !== "string" || !entry) {
      throw new Error(
        `Node '${nodeId}' allowed_paths entries must be non-empty strings`,
      );
    }
  }
}

/**
 * Merge workflow defaults into each node's settings.
 *
 * Why 3-tier cascade: `DEFAULT_SETTINGS` (hardcoded engine fallbacks) →
 * `config.defaults` (workflow-level overrides) → `node.settings` (per-node
 * overrides). Each tier wins over the one before it, so operators can set
 * workflow-wide timeouts without touching every node, and nodes can still
 * override individually.
 *
 * Why `run_always` normalisation: `run_always: true` is a legacy shorthand
 * that predates the `run_on` enum. We canonicalise it to `run_on: "always"`
 * here so all downstream code only needs to handle `run_on`.
 */
function mergeDefaults(
  config: WorkflowConfig,
  workDir?: string,
): WorkflowConfig {
  const workflowDefaults: WorkflowDefaults = {
    ...DEFAULT_WORKFLOW_DEFAULTS,
    ...config.defaults,
  };

  const nodeDefaults = extractNodeSettings(workflowDefaults);

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

  const result: WorkflowConfig = {
    ...config,
    defaults: workflowDefaults,
    nodes: mergedNodes,
  };
  validateFileReferences(result, workDir);
  return result;
}

/**
 * Validate all `{{file("path")}}` references in prompt and system_prompt fields.
 *
 * Scans top-level and loop body nodes. Paths containing `{{` are skipped
 * (unresolvable template variables at load time). Throws immediately on the
 * first missing file, including the node ID for context.
 *
 * @param workDir — base directory for resolving relative paths. Defaults to CWD.
 */
export function validateFileReferences(
  config: WorkflowConfig,
  workDir?: string,
): void {
  const FILE_REF_RE = /\{\{file\("([^"]+)"\)\}\}/g;
  const base = workDir ?? Deno.cwd();

  function scanNode(nodeId: string, node: NodeConfig): void {
    const fields = [node.prompt, node.system_prompt].filter(
      (f): f is string => typeof f === "string",
    );
    for (const field of fields) {
      FILE_REF_RE.lastIndex = 0;
      let match;
      while ((match = FILE_REF_RE.exec(field)) !== null) {
        const path = match[1];
        if (path.includes("{{")) continue;
        const resolved = path.startsWith("/") ? path : `${base}/${path}`;
        try {
          Deno.statSync(resolved);
        } catch {
          throw new Error(
            `Node '${nodeId}': {{file("${path}")}} — file not found: ${resolved}`,
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

/**
 * Find a NodeConfig by ID, searching both top-level nodes and loop body nodes.
 * Returns undefined if not found.
 */
export function findNodeConfig(
  config: WorkflowConfig,
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
export function collectAllNodeIds(config: WorkflowConfig): string[] {
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

/** Extract NodeSettings fields from WorkflowDefaults (exclude workflow-only fields). */
function extractNodeSettings(defaults: WorkflowDefaults): NodeSettings {
  const {
    max_parallel: _,
    claude_args: _ca,
    hitl: _hitl,
    permission_mode: _pm,
    worktree_disabled: _wd,
    ...settings
  } = defaults;
  return settings;
}
