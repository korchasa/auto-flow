/**
 * @module
 * Workflow config loading, schema validation, and default merging.
 * Entry points: {@link loadConfig} (file → WorkflowConfig) and
 * {@link parseConfig} (YAML string → WorkflowConfig).
 * Defaults are applied in a 3-tier cascade: hardcoded → workflow-level → node-level.
 */

import { parse as parseYaml } from "@std/yaml";
import { dirname, join } from "@std/path";
import {
  getRuntimeAdapter,
  resolveRuntimeConfig,
} from "@korchasa/ai-ide-cli/runtime";
import { validateTemplateVars } from "./template.ts";
import { globsOverlap } from "../isolation/glob.ts";
import {
  REASONING_EFFORT_VALUES,
  VALID_PERMISSION_MODES,
  VALID_RUNTIME_IDS,
} from "../types.ts";
import type {
  NodeBudget,
  NodeConfig,
  NodeSettings,
  WorkflowConfig,
  WorkflowDefaults,
} from "../types.ts";

/** Optional sink for non-fatal warnings emitted during config load.
 * Defaults to no-op; CLI wires it to `OutputManager.warn`. */
export type ConfigWarnSink = (message: string) => void;

/** Default node settings applied when not specified. `max_retry_wall_clock_seconds`
 * (FR-E80) is intentionally absent: `undefined` IS the documented "no cap"
 * state. */
export const DEFAULT_SETTINGS: Required<
  Omit<NodeSettings, "max_retry_wall_clock_seconds">
> = {
  max_continuations: 3,
  timeout_seconds: 1800,
  on_error: "fail",
  max_retries: 3,
  retry_delay_seconds: 5,
};

/** Default workflow-level settings. Fields intentionally excluded from
 * Required<> because undefined carries semantic meaning ("not set"):
 * `permission_mode`, `effort`, `budget`, `allowed_tools`,
 * `disallowed_tools`, `memory_paths`. */
export const DEFAULT_WORKFLOW_DEFAULTS: Required<
  Omit<
    WorkflowDefaults,
    | "permission_mode"
    | "effort"
    | "budget"
    | "allowed_tools"
    | "disallowed_tools"
    | "memory_paths"
    | "max_retry_wall_clock_seconds"
  >
> = {
  ...DEFAULT_SETTINGS,
  worktree_disabled: false,
  // Sequential by default. `0` (unlimited) used to be the default, which put
  // every node of a DAG level into one `Promise.allSettled` — but all nodes of
  // a run share ONE worktree, and the FR-E50 guardrail snapshots the main tree
  // before/after each node. Concurrent nodes therefore see each other's writes
  // as their own leaks and roll them back. Parallelism stays available, but it
  // is now an explicit opt-in that the engine warns about.
  max_parallel: 1,
  runtime: "claude",
  runtime_args: {},
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
 * @param workDir — base directory for resolving {{file()}} references.
 * @param workflowDir — workDir-relative directory containing the workflow.yaml,
 *   used for resolving {{flow_file()}} references. Defaults to "" (workDir root).
 * @param warnSink — optional callback for non-fatal warnings (ACP tool-filter
 *   downgrade etc.). Defaults to no-op. */
export function parseConfig(
  yaml: string,
  workDir?: string,
  workflowDir?: string,
  warnSink?: ConfigWarnSink,
): WorkflowConfig {
  const raw = parseYaml(yaml);
  if (!raw || typeof raw !== "object") {
    throw new Error("Workflow config must be a YAML object");
  }
  const config = raw as Record<string, unknown>;
  validateSchema(config);
  return mergeDefaults(
    config as unknown as WorkflowConfig,
    workDir,
    workflowDir,
    warnSink,
  );
}

/** Resolve a workflow folder to its `workflow.yaml` config path. Single
 * source of the config-filename convention shared by MCP and CLI layers. */
export function workflowConfigPath(workflowDir: string): string {
  return join(workflowDir, "workflow.yaml");
}

/** Load and parse workflow config from a file path.
 * @param workDir — base directory for resolving {{file()}} references.
 *   `{{flow_file()}}` references resolve against `workDir/dirname(path)`.
 * @param warnSink — optional non-fatal warning callback (see {@link parseConfig}). */
export async function loadConfig(
  path: string,
  workDir?: string,
  warnSink?: ConfigWarnSink,
): Promise<WorkflowConfig> {
  const yaml = await Deno.readTextFile(path);
  const wfDir = workflowDirFromConfigPath(path, workDir);
  return parseConfig(yaml, workDir, wfDir, warnSink);
}

/** Compute the workDir-relative workflow directory from a (possibly
 * workDir-prefixed) config path. Returns "" when the config sits at workDir
 * root. Strips the leading workDir prefix when present so the result is
 * always workDir-relative — matching the contract on TemplateContext. */
function workflowDirFromConfigPath(
  configPath: string,
  workDir?: string,
): string {
  let p = configPath;
  if (workDir && workDir !== "." && p.startsWith(`${workDir}/`)) {
    p = p.slice(workDir.length + 1);
  }
  const d = dirname(p);
  return d === "." || d === "/" ? "" : d;
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

  validateForkGraph(config as unknown as WorkflowConfig);

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
    if (
      defaults.runtime !== undefined &&
      !VALID_RUNTIME_IDS.includes(defaults.runtime as "claude" | "opencode")
    ) {
      throw new Error(
        `defaults.runtime has invalid value '${defaults.runtime}'. Must be one of: ${
          VALID_RUNTIME_IDS.join(", ")
        }`,
      );
    }
    if (defaults.runtime_args !== undefined) {
      validateRuntimeArgs("defaults", defaults.runtime_args);
    }
    if (defaults.hitl !== undefined) {
      validateHitlConfig(defaults.hitl);
    }
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
    }
    // FR-E42: validate defaults.effort enum
    if (defaults.effort !== undefined) {
      if (
        !REASONING_EFFORT_VALUES.includes(
          defaults.effort as typeof REASONING_EFFORT_VALUES[number],
        )
      ) {
        throw new Error(
          `defaults.effort has invalid value '${defaults.effort}'. Must be one of: ${
            REASONING_EFFORT_VALUES.join(", ")
          }`,
        );
      }
    }
    if (defaults.budget !== undefined) {
      validateBudget("defaults", defaults.budget);
    }
    if (defaults.max_parallel !== undefined) {
      const value = defaults.max_parallel;
      if (
        typeof value !== "number" || !Number.isInteger(value) || value < 0
      ) {
        throw new Error(
          `defaults.max_parallel must be a non-negative integer (got '${value}'); 0 means unlimited`,
        );
      }
    }
    validateToolFilterLevel("defaults", defaults);

    // FR-E80: validate defaults.max_retry_wall_clock_seconds if present.
    if (defaults.max_retry_wall_clock_seconds !== undefined) {
      validateWallClockBudget(
        "defaults",
        defaults.max_retry_wall_clock_seconds,
      );
    }

    // Validate memory_paths if present (FR-S28)
    if (defaults.memory_paths !== undefined) {
      if (!Array.isArray(defaults.memory_paths)) {
        throw new Error(
          `defaults.memory_paths must be an array of glob strings`,
        );
      }
      for (const pat of defaults.memory_paths) {
        if (typeof pat !== "string" || pat.length === 0) {
          throw new Error(
            `defaults.memory_paths entries must be non-empty strings`,
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
/**
 * Every key `NodeConfig` accepts. Mirrors the interface in `types.ts` — keep
 * both in sync when adding a field.
 *
 * Unknown keys are rejected rather than ignored: a mistyped `validat:` used to
 * pass validation and silently disable all of a node's output checks, and a
 * mistyped `prompts:` produced a confusing "requires a 'prompt' field" instead
 * of naming the actual typo. `settings` and `budget` already worked this way;
 * this extends the same strictness to the node itself.
 */
const NODE_CONFIG_KEYS: readonly string[] = [
  "type",
  "label",
  "inputs",
  "agent",
  "prompt",
  "system_prompt",
  "model",
  "effort",
  "runtime",
  "runtime_args",
  "permission_mode",
  "settings",
  "validate",
  "before",
  "after",
  "nodes",
  "condition_node",
  "condition_field",
  "exit_value",
  "until",
  "command",
  "when",
  "fork",
  "join",
  "failure_mode",
  "isolation",
  "max_iterations",
  "merge_strategy",
  "question",
  "options",
  "abort_on",
  "phase",
  "run_on",
  "run_always",
  "env",
  "allowed_paths",
  "budget",
  "allowed_tools",
  "disallowed_tools",
  "memory_commit_deferred",
];

/**
 * FR-E95: validate and normalise a `fork` declaration in place.
 *
 * Two shapes. The string form `"<group>.<branch>"` opens one static branch and
 * needs nothing at runtime. The object form expands the node into one branch
 * per element of a list an earlier node produced, so it carries the source
 * path and the naming rule. Both are restricted to the node types that run
 * work of their own — a merge, loop, human or hitl node has no execution to
 * multiply.
 */
/**
 * FR-E91: validate `isolation`. Restricted to the two node types that run a
 * subprocess in a working tree — a merge, loop, human or hitl node has no tree
 * of its own to isolate, and accepting the key there would promise an
 * isolation the engine never delivers.
 */
function validateIsolation(
  id: string,
  node: Record<string, unknown>,
  type: string,
): void {
  if (node.isolation === undefined) return;
  if (node.isolation !== "worktree") {
    throw new Error(
      `Node '${id}' 'isolation' must be 'worktree', got '${node.isolation}'`,
    );
  }
  if (type !== "agent" && type !== "command") {
    throw new Error(
      `Node '${id}' declares 'isolation', which is only valid on 'agent' and 'command' nodes`,
    );
  }
}

function validateFork(
  id: string,
  node: Record<string, unknown>,
  type: string,
): void {
  if (node.fork === undefined) return;
  if (type !== "agent" && type !== "command") {
    throw new Error(
      `Node '${id}' declares 'fork', which is only valid on 'agent' and 'command' nodes`,
    );
  }

  if (typeof node.fork === "string") {
    parseForkName(id, node.fork);
    return;
  }
  if (
    typeof node.fork !== "object" || node.fork === null ||
    Array.isArray(node.fork)
  ) {
    throw new Error(
      `Node '${id}' 'fork' must be a '<group>.<branch>' string or an object`,
    );
  }

  const cfg = node.fork as Record<string, unknown>;
  const known = ["group", "branches", "key", "max_concurrent"];
  for (const key of Object.keys(cfg)) {
    if (!known.includes(key)) {
      throw new Error(
        `Node '${id}' 'fork' has unknown key '${key}'. Valid keys: ${
          known.join(", ")
        }`,
      );
    }
  }
  if (typeof cfg.group !== "string" || !cfg.group || cfg.group.includes(".")) {
    throw new Error(
      `Node '${id}' 'fork' requires a non-empty 'group' without a '.'`,
    );
  }
  if (typeof cfg.branches !== "string" || !cfg.branches) {
    throw new Error(
      `Node '${id}' 'fork' requires a non-empty 'branches' source path`,
    );
  }
  if (cfg.key !== undefined) {
    if (
      typeof cfg.key !== "string" ||
      !/^value(\.[A-Za-z0-9_$-]+)*$/.test(cfg.key)
    ) {
      throw new Error(
        `Node '${id}' 'fork' key must be 'value' or 'value.<field>', got '${cfg.key}'`,
      );
    }
  }
  if (cfg.max_concurrent === undefined) {
    cfg.max_concurrent = 1;
  } else if (
    typeof cfg.max_concurrent !== "number" ||
    !Number.isInteger(cfg.max_concurrent) ||
    cfg.max_concurrent < 1
  ) {
    throw new Error(
      `Node '${id}' 'fork' max_concurrent must be a positive integer, got '${cfg.max_concurrent}'`,
    );
  }
}

/** Split a `"<group>.<branch>"` fork name, rejecting every other shape. */
export function parseForkName(
  id: string,
  raw: string,
): { group: string; branch: string } {
  const parts = raw.split(".");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw new Error(
      `Node '${id}' 'fork' must name '<group>.<branch>', got '${raw}'`,
    );
  }
  return { group: parts[0], branch: parts[1] };
}

/** FR-E95: validate `join` and the `failure_mode` that only a join may carry. */
function validateJoin(id: string, node: Record<string, unknown>): void {
  if (node.join !== undefined) {
    if (typeof node.join !== "string" || !node.join) {
      throw new Error(`Node '${id}' 'join' must be a non-empty group name`);
    }
    if (node.fork !== undefined) {
      throw new Error(
        `Node '${id}' declares both 'fork' and 'join' — a node either opens a branch or closes a group`,
      );
    }
  }

  if (node.failure_mode === undefined) return;
  if (node.join === undefined) {
    throw new Error(
      `Node '${id}' declares 'failure_mode', which is only valid on a 'join' node`,
    );
  }
  const modes = ["fail_fast", "collect", "all_or_nothing"];
  if (!modes.includes(node.failure_mode as string)) {
    throw new Error(
      `Node '${id}' failure_mode must be one of ${
        modes.join(", ")
      }, got '${node.failure_mode}'`,
    );
  }
}

function validateNode(
  id: string,
  node: Record<string, unknown>,
  allNodeIds: string[],
): void {
  if (node.for_each !== undefined) {
    throw new Error(
      `Node '${id}': 'for_each' was replaced by 'fork' (FR-E95) — declare 'fork: {group, branches, key}' on this node and add a matching 'join' node`,
    );
  }

  for (const key of Object.keys(node)) {
    if (!NODE_CONFIG_KEYS.includes(key)) {
      throw new Error(
        `Node '${id}' has unknown key '${key}'. Valid keys: ${
          NODE_CONFIG_KEYS.join(", ")
        }`,
      );
    }
  }

  const validTypes = ["agent", "command", "merge", "loop", "human", "hitl"];
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

  // FR-E95: `fork`/`join` are normalised before any template validation runs.
  // Whether `{{branch.*}}` is legal here depends on branch membership, which
  // only the whole graph knows, so that gate runs in `validateForkGraph`
  // after every node has been checked on its own.
  validateFork(id, node, type);
  validateJoin(id, node);
  const allowBranch = true;
  validateIsolation(id, node, type);

  // FR-E89: `when` gates any node type, so it is checked before the
  // type-specific branches.
  if (node.when !== undefined) {
    if (typeof node.when !== "string" || !node.when) {
      throw new Error(
        `Node '${id}' 'when' must be a non-empty string (a shell predicate)`,
      );
    }
    const whenErrors = validateTemplateVars(node.when, allNodeIds, allowBranch);
    if (whenErrors.length > 0) {
      throw new Error(
        `Node '${id}' 'when' has invalid template variables: ${
          whenErrors.join("; ")
        }`,
      );
    }
  }

  // FR-E88: `command` belongs to command nodes only. Silently ignoring it on
  // an agent node would let a config author believe a shell step runs when
  // nothing does.
  if (type !== "command" && node.command !== undefined) {
    throw new Error(
      `Node '${id}' declares 'command', which is only valid on 'command' nodes`,
    );
  }

  if (type === "command") {
    if (typeof node.command !== "string" || !node.command) {
      throw new Error(
        `Command node '${id}' requires a non-empty 'command' field`,
      );
    }
    if (node.prompt !== undefined) {
      throw new Error(
        `Command node '${id}' does not accept 'prompt' — it runs a shell command, not an agent`,
      );
    }
    const commandErrors = validateTemplateVars(
      node.command,
      allNodeIds,
      allowBranch,
    );
    if (commandErrors.length > 0) {
      throw new Error(
        `Command node '${id}' has invalid template variables: ${
          commandErrors.join("; ")
        }`,
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
    // FR-E87: a loop declares its exit EITHER as a shell predicate (`until`)
    // OR as the artifact-field triple. Accepting both would leave the engine
    // guessing which one wins; accepting neither would silently run to
    // max_iterations every time.
    const TRIPLE_KEYS = [
      "condition_node",
      "condition_field",
      "exit_value",
    ] as const;
    const hasUntil = node.until !== undefined;
    const declaredTriple = TRIPLE_KEYS.filter((k) => node[k] !== undefined);

    if (hasUntil && declaredTriple.length > 0) {
      throw new Error(
        `Loop node '${id}': 'until' and the condition triple (${
          declaredTriple.join(", ")
        }) are mutually exclusive — declare the exit either as a shell predicate or as an artifact-field match`,
      );
    }
    if (!hasUntil && declaredTriple.length === 0) {
      throw new Error(
        `Loop node '${id}' requires either 'until' (a shell predicate) or the 'condition_node'/'condition_field'/'exit_value' triple`,
      );
    }

    if (hasUntil) {
      if (typeof node.until !== "string" || !node.until) {
        throw new Error(
          `Loop node '${id}' 'until' must be a non-empty string (a shell predicate)`,
        );
      }
      const untilErrors = validateTemplateVars(node.until, allNodeIds);
      if (untilErrors.length > 0) {
        throw new Error(
          `Loop node '${id}' 'until' has invalid template variables: ${
            untilErrors.join("; ")
          }`,
        );
      }
    } else {
      if (typeof node.condition_node !== "string") {
        throw new Error(`Loop node '${id}' requires 'condition_node'`);
      }
      if (typeof node.condition_field !== "string") {
        throw new Error(`Loop node '${id}' requires 'condition_field'`);
      }
      if (typeof node.exit_value !== "string") {
        throw new Error(`Loop node '${id}' requires 'exit_value'`);
      }
    }

    const bodyNodes = node.nodes as Record<string, unknown>;
    const bodyNodeIds = Object.keys(bodyNodes);

    // condition_node must reference a key in nodes
    if (!hasUntil && !bodyNodeIds.includes(node.condition_node as string)) {
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
      // FR-E97: a loop body runs through its own traversal, not the readiness
      // scheduler, so a branch opened inside one would never reach a join.
      if (bodyNode.fork !== undefined || bodyNode.join !== undefined) {
        throw new Error(
          `Loop node '${id}' body node '${bodyId}' declares 'fork' or 'join' — branch groups are not allowed inside a loop body`,
        );
      }
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
    // Skip if condition node has no validate block (no contract to enforce),
    // and skip entirely for FR-E87 `until` loops, which have no condition node.
    const condNodeRaw = hasUntil
      ? undefined
      : bodyNodes[node.condition_node as string] as Record<string, unknown>;
    if (
      condNodeRaw && Array.isArray(condNodeRaw.validate) &&
      condNodeRaw.validate.length > 0
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

  // FR-E93: a hitl node asks its question through the workflow's HITL
  // transport instead of the terminal, but the question itself is just as
  // mandatory.
  if (type === "hitl") {
    if (typeof node.question !== "string" || !node.question) {
      throw new Error(
        `Hitl node '${id}' requires a non-empty 'question' field`,
      );
    }
    const questionErrors = validateTemplateVars(
      node.question,
      allNodeIds,
      allowBranch,
    );
    if (questionErrors.length > 0) {
      throw new Error(
        `Hitl node '${id}' question has invalid template variables: ${
          questionErrors.join("; ")
        }`,
      );
    }
  }

  // Validate hook template variables (FR-E7)
  if (typeof node.before === "string" && node.before) {
    const errors = validateTemplateVars(node.before, allNodeIds, allowBranch);
    if (errors.length > 0) {
      throw new Error(
        `Node '${id}' before hook has invalid template variables: ${
          errors.join("; ")
        }`,
      );
    }
  }
  if (typeof node.after === "string" && node.after) {
    const errors = validateTemplateVars(node.after, allNodeIds, allowBranch);
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

  // FR-E42: validate node.effort enum
  if (node.effort !== undefined) {
    if (
      !REASONING_EFFORT_VALUES.includes(
        node.effort as typeof REASONING_EFFORT_VALUES[number],
      )
    ) {
      throw new Error(
        `Node '${id}' has invalid effort '${node.effort}'. Must be one of: ${
          REASONING_EFFORT_VALUES.join(", ")
        }`,
      );
    }
  }

  if (node.runtime !== undefined) {
    if (!VALID_RUNTIME_IDS.includes(node.runtime as "claude" | "opencode")) {
      throw new Error(
        `Node '${id}' has invalid runtime '${node.runtime}'. Must be one of: ${
          VALID_RUNTIME_IDS.join(", ")
        }`,
      );
    }
  }

  if (node.runtime_args !== undefined) {
    validateRuntimeArgs(`Node '${id}'`, node.runtime_args);
  }

  // Validate allowed_paths if present (FR-E37)
  if (node.allowed_paths !== undefined) {
    validateAllowedPaths(id, node.allowed_paths);
  }

  // Validate budget if present (FR-E47)
  if (node.budget !== undefined) {
    validateBudget(`Node '${id}'`, node.budget);
  }

  // Validate tool filter fields if present (FR-E48)
  validateToolFilterLevel(`Node '${id}'`, node);

  // Validate memory_commit_deferred if present (FR-S28)
  if (
    node.memory_commit_deferred !== undefined &&
    typeof node.memory_commit_deferred !== "boolean"
  ) {
    throw new Error(
      `Node '${id}' memory_commit_deferred must be a boolean`,
    );
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
    "max_retry_wall_clock_seconds",
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
  if (settings.max_retry_wall_clock_seconds !== undefined) {
    validateWallClockBudget(
      `Node '${nodeId}' settings`,
      settings.max_retry_wall_clock_seconds,
    );
  }
}

/** Validate FR-E80 `max_retry_wall_clock_seconds`: positive integer. */
function validateWallClockBudget(context: string, value: unknown): void {
  if (
    typeof value !== "number" || !Number.isInteger(value) || value <= 0
  ) {
    throw new Error(
      `${context}.max_retry_wall_clock_seconds must be a positive integer (got '${value}')`,
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
    "git_worktree_clean",
    "git_default_branch_checked_out",
    "git_no_unpushed_commits",
  ];
  if (!validTypes.includes(rule.type as string)) {
    throw new Error(
      `Node '${nodeId}' validation rule has invalid type '${rule.type}'`,
    );
  }
  if (
    // FR-E67: Git repository-state validation rules are parameterless.
    rule.type === "git_worktree_clean" ||
    rule.type === "git_default_branch_checked_out" ||
    rule.type === "git_no_unpushed_commits"
  ) {
    return;
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
 * Validate a budget object (node-level or defaults-level, FR-E47).
 * `max_usd` must be a positive finite number; `max_turns` must be a positive
 * integer. Extra keys are rejected to catch typos early.
 */
function validateBudget(context: string, budget: unknown): void {
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    throw new Error(`${context}.budget must be an object`);
  }
  const b = budget as Record<string, unknown>;
  const validKeys = ["max_usd", "max_turns"];
  for (const key of Object.keys(b)) {
    if (!validKeys.includes(key)) {
      throw new Error(`${context}.budget has unknown key '${key}'`);
    }
  }
  if (b.max_usd !== undefined) {
    if (
      typeof b.max_usd !== "number" || !Number.isFinite(b.max_usd) ||
      b.max_usd <= 0
    ) {
      throw new Error(`${context}.budget.max_usd must be a positive number`);
    }
  }
  if (b.max_turns !== undefined) {
    if (
      typeof b.max_turns !== "number" || !Number.isInteger(b.max_turns) ||
      b.max_turns <= 0
    ) {
      throw new Error(
        `${context}.budget.max_turns must be a positive integer`,
      );
    }
  }
}

/**
 * Resolve effective budget for a node via cascade: node → enclosing loop
 * parent → workflow defaults. First-defined wins at the object level (shallow
 * cascade, same spirit as the `model` field resolution). Returns undefined
 * when no budget is set at any level.
 */
export function resolveBudget(
  node: NodeConfig,
  defaults: WorkflowDefaults | undefined,
  loopParent?: NodeConfig,
): NodeBudget | undefined {
  return node.budget ?? loopParent?.budget ?? defaults?.budget;
}

/** Reserved-keys in `runtime_args` that conflict with typed tool filter fields
 * (FR-E48). Claude CLI and engine own these flags. */
const TOOL_FILTER_RESERVED_KEYS = [
  "--allowedTools",
  "--allowed-tools",
  "--disallowedTools",
  "--disallowed-tools",
  "--tools",
] as const;

/**
 * Validate tool-filter fields at a single cascade level (FR-E48).
 *
 * Three checks:
 * 1. Each field, if present, must be an array of non-empty strings.
 * 2. Fields are mutually exclusive at the same level.
 * 3. If any typed field is set at this level, `runtime_args` of the same
 *    level must not contain any key from {@link TOOL_FILTER_RESERVED_KEYS}.
 *
 * Context string identifies the level in error messages (`defaults`,
 * `Node 'foo'`, etc.).
 */
function validateToolFilterLevel(
  context: string,
  level: Record<string, unknown>,
): void {
  const allowed = level.allowed_tools;
  const disallowed = level.disallowed_tools;

  if (allowed !== undefined) {
    validateToolFilterField(context, "allowed_tools", allowed);
  }
  if (disallowed !== undefined) {
    validateToolFilterField(context, "disallowed_tools", disallowed);
  }
  if (allowed !== undefined && disallowed !== undefined) {
    throw new Error(
      `${context}: allowed_tools and disallowed_tools are mutually exclusive at the same level`,
    );
  }

  const hasTypedField = allowed !== undefined || disallowed !== undefined;
  if (hasTypedField && level.runtime_args !== undefined) {
    const runtimeArgs = level.runtime_args as Record<string, unknown>;
    for (const reserved of TOOL_FILTER_RESERVED_KEYS) {
      if (reserved in runtimeArgs) {
        throw new Error(
          `${context}.runtime_args key '${reserved}' conflicts with typed allowed_tools/disallowed_tools fields — use the typed field exclusively`,
        );
      }
    }
  }
}

function validateToolFilterField(
  context: string,
  fieldName: "allowed_tools" | "disallowed_tools",
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${fieldName} must be an array of strings`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !entry) {
      throw new Error(
        `${context}.${fieldName} entries must be non-empty strings`,
      );
    }
  }
}

/** Resolved tool filter for a single node invocation (FR-E48).
 * At most one of the two fields is set (mutex enforced at validation). */
export interface ResolvedToolFilter {
  allowedTools?: string[];
  disallowedTools?: string[];
}

/**
 * Resolve effective tool filter via REPLACE-semantics cascade:
 * node → loopParent → defaults.
 *
 * Unlike {@link resolveRuntimeConfig} which merges `runtime_args` per-key,
 * this resolver picks the FIRST level that declares either `allowed_tools`
 * or `disallowed_tools` and returns only that level's values. Other levels
 * are ignored entirely — this is the "replace" semantics demanded by
 * FR-E48 to keep author intent unambiguous.
 *
 * Contract: caller has already passed the config through
 * {@link validateSchema}, so mutex and reserved-keys constraints hold.
 * The resolver never throws.
 */
export function resolveToolFilter(
  node: NodeConfig,
  defaults: WorkflowDefaults | undefined,
  loopParent?: NodeConfig,
): ResolvedToolFilter {
  const sources: Array<NodeConfig | WorkflowDefaults | undefined> = [
    node,
    loopParent,
    defaults,
  ];
  for (const src of sources) {
    if (!src) continue;
    if (
      src.allowed_tools !== undefined || src.disallowed_tools !== undefined
    ) {
      return {
        allowedTools: src.allowed_tools,
        disallowedTools: src.disallowed_tools,
      };
    }
  }
  return {};
}

function validateRuntimeArgs(
  context: string,
  runtimeArgs: unknown,
): void {
  if (
    !runtimeArgs || typeof runtimeArgs !== "object" ||
    Array.isArray(runtimeArgs)
  ) {
    throw new Error(
      `${context}.runtime_args must be a map (Record<string, string | null>)`,
    );
  }
  for (const [key, value] of Object.entries(runtimeArgs)) {
    if (!key) {
      throw new Error(
        `${context}.runtime_args keys must be non-empty strings`,
      );
    }
    if (value !== null && typeof value !== "string") {
      throw new Error(
        `${context}.runtime_args['${key}'] must be a string or null (null suppresses the flag)`,
      );
    }
  }
}

function validateHitlConfig(hitl: unknown): void {
  if (!hitl || typeof hitl !== "object" || Array.isArray(hitl)) {
    throw new Error("defaults.hitl must be an object");
  }
  const config = hitl as Record<string, unknown>;
  if (typeof config.ask_script !== "string" || !config.ask_script) {
    throw new Error(
      "defaults.hitl.ask_script must be a non-empty string",
    );
  }
  if (typeof config.check_script !== "string" || !config.check_script) {
    throw new Error(
      "defaults.hitl.check_script must be a non-empty string",
    );
  }
  const validKeys = [
    "ask_script",
    "check_script",
    "artifact_source",
    "poll_interval",
    "timeout",
    "exclude_login",
  ];
  for (const key of Object.keys(config)) {
    if (!validKeys.includes(key)) {
      throw new Error(`defaults.hitl has unknown key '${key}'`);
    }
  }
  // Both knobs feed arithmetic in the poll loop (`poll_interval * 1000`,
  // `Date.now() + timeout * 1000`). A non-number silently produces NaN and a
  // loop that never runs, so reject it here instead.
  for (const key of ["poll_interval", "timeout"] as const) {
    const value = config[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `defaults.hitl.${key} must be a positive number (got '${value}')`,
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
  workflowDir?: string,
  warnSink?: ConfigWarnSink,
): WorkflowConfig {
  const workflowDefaults: WorkflowDefaults = {
    ...DEFAULT_WORKFLOW_DEFAULTS,
    ...config.defaults,
  };

  // `hitl` needs a per-FIELD merge, not the shallow object replace the spread
  // above performs. A workflow that declares only `ask_script`/`check_script`
  // used to wipe the `poll_interval`/`timeout` defaults, leaving them
  // undefined: `runHitlLoop` then computed `Date.now() + NaN` for its deadline,
  // skipped the poll loop entirely, and reported an instant
  // "HITL timeout after undefineds" — the question was delivered but never
  // awaited.
  if (config.defaults?.hitl) {
    workflowDefaults.hitl = {
      ...DEFAULT_WORKFLOW_DEFAULTS.hitl,
      ...config.defaults.hitl,
    };
  }

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
  validateRuntimeCompatibility(result, warnSink);
  validateFileReferences(result, workDir, workflowDir);
  return result;
}

function validateRuntimeCompatibility(
  config: WorkflowConfig,
  warnSink?: ConfigWarnSink,
): void {
  const defaults = config.defaults;

  const checkNode = (nodeId: string, node: NodeConfig, parent?: NodeConfig) => {
    if (node.type !== "agent") return;

    const runtimeConfig = resolveRuntimeConfig({ defaults, node, parent });
    if (
      runtimeConfig.runtime === "opencode" ||
      runtimeConfig.runtime === "cursor"
    ) {
      if (
        runtimeConfig.permissionMode &&
        runtimeConfig.permissionMode !== "bypassPermissions"
      ) {
        const source = node.permission_mode !== undefined
          ? `nodes.${nodeId}.permission_mode`
          : "defaults.permission_mode";
        throw new Error(
          `${source} '${runtimeConfig.permissionMode}' is not supported for runtime '${runtimeConfig.runtime}' — only 'bypassPermissions' is supported (node '${nodeId}')`,
        );
      }
    }

    // ACP is the only transport: every agent node must resolve to a runtime
    // that supports ACP execution. Fail fast if the adapter cannot.
    const adapter = getRuntimeAdapter(runtimeConfig.runtime);
    let acpCaps: { toolFilter?: boolean } | undefined;
    try {
      acpCaps = adapter.capabilitiesFor?.("acp");
    } catch (_err) {
      throw new Error(
        `Node '${nodeId}': runtime '${runtimeConfig.runtime}' does not support ACP execution`,
      );
    }
    if (acpCaps === undefined) {
      throw new Error(
        `Node '${nodeId}': runtime '${runtimeConfig.runtime}' does not support ACP execution`,
      );
    }
    // Surface the silent tool-filter downgrade at config-load: under ACP
    // allowed_tools/disallowed_tools are ignored at any cascade level.
    if (
      warnSink &&
      (node.allowed_tools !== undefined ||
        node.disallowed_tools !== undefined ||
        defaults?.allowed_tools !== undefined ||
        defaults?.disallowed_tools !== undefined)
    ) {
      const field = (node.allowed_tools ?? defaults?.allowed_tools) !==
          undefined
        ? "allowed_tools"
        : "disallowed_tools";
      warnSink(
        `Node '${nodeId}': ${field} is ignored under ACP (capabilitiesFor: toolFilter=${acpCaps.toolFilter})`,
      );
    }
  };

  for (const [nodeId, node] of Object.entries(config.nodes)) {
    checkNode(nodeId, node);
    if (node.type === "loop" && node.nodes) {
      for (const [bodyId, bodyNode] of Object.entries(node.nodes)) {
        checkNode(bodyId, bodyNode, node);
      }
    }
  }
}

/**
 * Validate all `{{file("path")}}` and `{{flow_file("path")}}` references in
 * prompt and system_prompt fields.
 *
 * Scans top-level and loop body nodes. Paths containing `{{` are skipped
 * (unresolvable template variables at load time). Throws immediately on the
 * first missing file, including the node ID for context.
 *
 * `file()` paths resolve against `workDir`. `flow_file()` paths resolve against
 * `workDir/workflowDir` — i.e. the directory containing the workflow.yaml.
 *
 * @param workDir — base directory for resolving `{{file()}}` paths. Defaults
 *   to CWD.
 * @param workflowDir — workDir-relative directory containing the workflow.yaml,
 *   used as the base for `{{flow_file()}}` paths. "" or undefined means
 *   `flow_file()` resolves identically to `file()`.
 */
export function validateFileReferences(
  config: WorkflowConfig,
  workDir?: string,
  workflowDir?: string,
): void {
  const FILE_REF_RE = /\{\{(flow_file|file)\("([^"]+)"\)\}\}/g;
  const base = workDir ?? Deno.cwd();
  const wfDir = workflowDir ?? "";

  function scanNode(nodeId: string, node: NodeConfig): void {
    const fields = [node.prompt, node.system_prompt].filter(
      (f): f is string => typeof f === "string",
    );
    for (const field of fields) {
      FILE_REF_RE.lastIndex = 0;
      let match;
      while ((match = FILE_REF_RE.exec(field)) !== null) {
        const fnName = match[1] as "file" | "flow_file";
        const path = match[2];
        if (path.includes("{{")) continue;
        let resolved: string;
        if (path.startsWith("/")) {
          resolved = path;
        } else if (fnName === "flow_file" && wfDir !== "") {
          resolved = `${base}/${wfDir}/${path}`;
        } else {
          resolved = `${base}/${path}`;
        }
        try {
          Deno.statSync(resolved);
        } catch {
          throw new Error(
            `Node '${nodeId}': {{${fnName}("${path}")}} — file not found: ${resolved}`,
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
/** Branch identity of a node inside a fork group. */
export interface BranchMembership {
  /** The fork group. */
  group: string;
  /** The branch within it; `*` for a branch set only known at runtime. */
  branch: string;
}

/** Branch name standing for "one per element of the runtime list". */
export const DYNAMIC_BRANCH = "*";

/** Read a node's own `fork` declaration, or undefined when it opens no branch. */
function forkEntry(id: string, node: NodeConfig): BranchMembership | undefined {
  if (node.fork === undefined) return undefined;
  return typeof node.fork === "string"
    ? parseForkName(id, node.fork)
    : { group: node.fork.group, branch: DYNAMIC_BRANCH };
}

/**
 * FR-E95: work out which branch each node runs in.
 *
 * A branch declares itself once, on the node that opens it, and membership
 * then flows along `inputs` until the group's `join`. That is what lets a
 * branch be several nodes — an agent that edits and a command that checks its
 * work belong to the same branch, and therefore to the same worktree, without
 * repeating the declaration on both.
 *
 * A node fed by two branches of the same group is an error unless it is the
 * join: it would otherwise read two branches' artifacts while belonging to
 * one, and its writes could not be attributed to either.
 */
export function resolveBranchMembership(
  config: WorkflowConfig,
): Map<string, BranchMembership> {
  const membership = new Map<string, BranchMembership>();
  for (const [id, node] of Object.entries(config.nodes)) {
    const own = forkEntry(id, node);
    if (own) membership.set(id, own);
  }

  // Fixpoint rather than a topological walk: `inputs` may describe a cycle,
  // and rejecting that is the DAG builder's job, not this one's.
  let changed = true;
  let guard = Object.keys(config.nodes).length + 1;
  while (changed && guard-- > 0) {
    changed = false;
    for (const [id, node] of Object.entries(config.nodes)) {
      if (node.fork !== undefined || node.join !== undefined) continue;
      const seen: BranchMembership[] = [];
      for (const input of node.inputs ?? []) {
        const m = membership.get(input);
        if (!m) continue;
        if (!seen.some((x) => x.group === m.group && x.branch === m.branch)) {
          seen.push(m);
        }
      }
      if (seen.length > 1) {
        throw new Error(
          `Node '${id}' takes inputs from two branches (${
            seen.map((m) => `${m.group}.${m.branch}`).join(", ")
          }) — only the group's 'join' node may read more than one branch`,
        );
      }
      if (seen.length === 1 && !membership.has(id)) {
        membership.set(id, seen[0]);
        changed = true;
      }
    }
  }

  return membership;
}

/**
 * FR-E95: check the fork groups of a whole graph.
 *
 * Per-node validation cannot see a group — it is spread over the node that
 * opens each branch and the node that closes the group — so pairing,
 * duplicate branch names and the scope of `{{branch.*}}` are all decided here.
 */
function validateForkGraph(config: WorkflowConfig): void {
  const entries = new Map<string, string>();
  const groups = new Set<string>();
  for (const [id, node] of Object.entries(config.nodes)) {
    const own = forkEntry(id, node);
    if (!own) continue;
    const key = `${own.group}.${own.branch}`;
    const previous = entries.get(key);
    if (previous !== undefined) {
      throw new Error(
        `Branch '${key}' is declared twice — nodes '${previous}' and '${id}' both fork into it`,
      );
    }
    entries.set(key, id);
    groups.add(own.group);
  }

  const joins = new Map<string, string>();
  for (const [id, node] of Object.entries(config.nodes)) {
    if (node.join === undefined) continue;
    const previous = joins.get(node.join);
    if (previous !== undefined) {
      throw new Error(
        `Branch group '${node.join}' has more than one 'join' node ('${previous}' and '${id}')`,
      );
    }
    joins.set(node.join, id);
  }

  for (const group of groups) {
    if (!joins.has(group)) {
      throw new Error(
        `Branch group '${group}' has no 'join' node — a group that never closes would leave its branches' answers unread`,
      );
    }
  }
  for (const [group, id] of joins) {
    if (!groups.has(group)) {
      throw new Error(
        `Node '${id}' joins branch group '${group}' but no node forks into it`,
      );
    }
  }

  const membership = resolveBranchMembership(config);

  // FR-E95: a branch produced at runtime is exactly one node long. Its
  // expansions live inside that node, so a downstream node would run once for
  // N branches and read whichever one finished last.
  for (const [id, own] of membership) {
    if (own.branch !== DYNAMIC_BRANCH) continue;
    if (config.nodes[id].fork !== undefined) continue;
    throw new Error(
      `Node '${id}' inherits branch group '${own.group}' from a node whose branches are produced at runtime, and such a branch is one node long — give the branch its work in the forking node, or declare static branches`,
    );
  }

  // FR-E97: a loop runs its body through its own traversal, not the readiness
  // scheduler, so a branch that swallows a loop has no terminal node the join
  // can wait on and no defined tree for the body's writes.
  for (const [id, own] of membership) {
    if (config.nodes[id].type !== "loop") continue;
    throw new Error(
      `Node '${id}': a loop node '${id}' belongs to branch '${own.group}.${own.branch}' — a loop may not sit inside a branch; move it before the fork or after the join`,
    );
  }

  validateDisjointBranchScopes(config, membership);

  const nodeIds = Object.keys(config.nodes);
  for (const [id, node] of Object.entries(config.nodes)) {
    if (membership.has(id)) continue;
    for (const [field, text] of templatedStrings(node)) {
      const errors = validateTemplateVars(text, nodeIds, false)
        .filter((e) => e.includes("branch"));
      if (errors.length > 0) {
        throw new Error(
          `Node '${id}' field '${field}': ${errors.join("; ")}`,
        );
      }
    }
  }
}

/**
 * FR-E37: two branches of one group may not claim overlapping write scopes.
 *
 * Branches run at the same time; a path both may write is a path where one
 * branch's edit silently replaces the other's. The check is conservative —
 * it fires unless the two scopes are provably disjoint — because a missed
 * overlap loses work while a false one costs an edit to the config.
 */
function validateDisjointBranchScopes(
  config: WorkflowConfig,
  membership: Map<string, BranchMembership>,
): void {
  const scopes = new Map<string, Map<string, string[]>>();
  for (const [id, own] of membership) {
    const paths = config.nodes[id].allowed_paths;
    if (paths === undefined) continue;
    const group = scopes.get(own.group) ?? new Map<string, string[]>();
    group.set(own.branch, [...(group.get(own.branch) ?? []), ...paths]);
    scopes.set(own.group, group);
  }

  for (const [group, branches] of scopes) {
    const names = [...branches.keys()].sort();
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        for (const left of branches.get(names[i])!) {
          for (const right of branches.get(names[j])!) {
            if (!globsOverlap(left, right)) continue;
            throw new Error(
              `Branches '${group}.${names[i]}' and '${group}.${
                names[j]
              }' declare overlapping write scopes ('${left}' and '${right}') — branches of one group run at the same time, so both edits cannot survive`,
            );
          }
        }
      }
    }
  }
}

/** Every string of a node that goes through template interpolation. */
function* templatedStrings(
  node: NodeConfig,
): Generator<[string, string]> {
  const direct: [string, string | undefined][] = [
    ["prompt", node.prompt],
    ["system_prompt", node.system_prompt],
    ["command", node.command],
    ["when", node.when],
    ["before", node.before],
    ["after", node.after],
    ["question", node.question],
  ];
  for (const [field, value] of direct) {
    if (typeof value === "string") yield [field, value];
  }
  for (const [i, pattern] of (node.allowed_paths ?? []).entries()) {
    yield [`allowed_paths[${i}]`, pattern];
  }
  for (const [key, value] of Object.entries(node.env ?? {})) {
    yield [`env.${key}`, value];
  }
}

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

/** Extract NodeSettings fields from WorkflowDefaults via explicit pick.
 * Explicit so that workflow-only fields (`on_failure_script`,
 * `prepare_command`, `memory_paths`, …) and any future WorkflowDefaults
 * additions can never silently leak into per-node settings — the previous
 * rest-spread subtraction did exactly that. */
function extractNodeSettings(defaults: WorkflowDefaults): NodeSettings {
  const settings: NodeSettings = {};
  if (defaults.max_continuations !== undefined) {
    settings.max_continuations = defaults.max_continuations;
  }
  if (defaults.timeout_seconds !== undefined) {
    settings.timeout_seconds = defaults.timeout_seconds;
  }
  if (defaults.on_error !== undefined) {
    settings.on_error = defaults.on_error;
  }
  if (defaults.max_retries !== undefined) {
    settings.max_retries = defaults.max_retries;
  }
  if (defaults.retry_delay_seconds !== undefined) {
    settings.retry_delay_seconds = defaults.retry_delay_seconds;
  }
  if (defaults.max_retry_wall_clock_seconds !== undefined) {
    settings.max_retry_wall_clock_seconds =
      defaults.max_retry_wall_clock_seconds;
  }
  return settings;
}
