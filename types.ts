/**
 * @module
 * Type declarations for the configurable node-based workflow engine.
 * No logic — pure type definitions.
 *
 * Runtime-neutral agent-CLI types (runtime identifiers, permission modes,
 * verbosity, HITL request shapes, normalized CLI output, HITL config) are
 * defined in `@korchasa/ai-ide-cli/types` and re-exported here so existing
 * engine-internal imports continue to resolve through `./types.ts`.
 */

import type {
  CliRunOutput,
  HitlConfig,
  HumanInputOption,
  HumanInputRequest,
  PermissionDenial,
  PermissionMode,
  RuntimeId,
  Verbosity,
} from "@korchasa/ai-ide-cli/types";
import type { ExtraArgsMap } from "@korchasa/ai-ide-cli/runtime/types";
import type { ReasoningEffort } from "@korchasa/ai-ide-cli/runtime/reasoning-effort";
import type { ProcessRegistry } from "@korchasa/ai-ide-cli/process-registry";

export type {
  CliRunOutput,
  HitlConfig,
  HumanInputOption,
  HumanInputRequest,
  PermissionDenial,
  PermissionMode,
  ProcessRegistry,
  ReasoningEffort,
  RuntimeId,
  Verbosity,
};
export {
  VALID_PERMISSION_MODES,
  VALID_RUNTIME_IDS,
} from "@korchasa/ai-ide-cli/types";
export { REASONING_EFFORT_VALUES } from "@korchasa/ai-ide-cli/runtime/reasoning-effort";

// --- Workflow Configuration (parsed from YAML) ---

/** Top-level workflow configuration. */
export interface WorkflowConfig {
  /** Workflow identifier used in logs and state files. */
  name: string;
  /** Config schema version; only "1" is currently supported. */
  version: "1";
  /** Global defaults applied to all nodes unless overridden at node level. */
  defaults?: WorkflowDefaults;
  /** Global environment variables accessible via `{{env.<key>}}` in templates. */
  env?: Record<string, string>;
  /** DAG node definitions keyed by unique node ID. */
  nodes: Record<string, NodeConfig>;
  /** Optional phase grouping: maps phase name to list of node IDs.
   * Enables phase-organized artifact directories (FR-E9, FR-S25). */
  phases?: Record<string, string[]>;
}

/**
 * Per-node budget limits (FR-E47).
 * `max_usd` caps the node's own `cost_usd` (for loop body nodes: per-iteration).
 * `max_turns` is forwarded to the Claude CLI as `--max-turns <N>` — other
 * runtimes omit the flag and emit a one-time warning at workflow start.
 */
export interface NodeBudget {
  /** Maximum allowed `cost_usd` for this node; exceeding it fails the node. */
  max_usd?: number;
  /** Claude-only. Maps to `--max-turns <N>` CLI flag. */
  max_turns?: number;
}

/** Global defaults applied to all nodes unless overridden. */
export interface WorkflowDefaults extends NodeSettings {
  /** When true, skip worktree creation and run in CWD (default false). */
  worktree_disabled?: boolean;
  /** Maximum parallel node executions; 0 means unlimited (default). */
  max_parallel?: number;
  /** Runtime used for agent execution when not overridden (default: claude). */
  runtime?: RuntimeId;
  /** Generic extra CLI args forwarded to the selected runtime.
   * Map-shape: `{ "--flag": "value" }`, `{ "--bool": "" }` (boolean flag),
   * `{ "--suppressed": null }` (suppress a parent-supplied flag). */
  runtime_args?: ExtraArgsMap;
  /** Permission mode for all agent nodes (maps to --permission-mode CLI flag).
   * Overridable per-node via NodeConfig.permission_mode. */
  permission_mode?: PermissionMode;
  /** Default Claude model for all agent nodes (e.g. "claude-sonnet-4-6"). */
  model?: string;
  /** Default reasoning effort for all agent nodes (FR-E42).
   * Values: minimal | low | medium | high. Maps to Claude's `--effort`,
   * Codex's `--config model_reasoning_effort=…`, OpenCode's `--variant`;
   * Cursor warns and ignores. Skipped on `--resume` (session inherits). */
  effort?: ReasoningEffort;
  /** Human-in-the-loop config: ask/check scripts, poll interval, timeout. */
  hitl?: HitlConfig;
  /** Path to script executed when the workflow fails (FR-E19). */
  on_failure_script?: string;
  /** Shell command executed once before the node level loop on fresh runs.
   * Supports template interpolation (run_dir, run_id, env.*, args.*).
   * Skipped on resume. Non-zero exit aborts the workflow (FR-E30). */
  prepare_command?: string;
  /** Workflow-level default budget cascade source (FR-E47). */
  budget?: NodeBudget;
  /** Whitelist of tools available to agent nodes (FR-E48).
   * Mutually exclusive with `disallowed_tools`. Claude emits
   * `--allowedTools <comma-joined>`; other runtimes warn and ignore. */
  allowed_tools?: string[];
  /** Blacklist of tools forbidden to agent nodes (FR-E48).
   * Mutually exclusive with `allowed_tools`. */
  disallowed_tools?: string[];
  /** Glob patterns identifying agent reflection-memory files (FR-S28).
   * After every agent invocation under worktree isolation, the engine
   * checks the worktree's working tree against these globs; any matching
   * path that is dirty AND the node did not declare
   * `memory_commit_deferred: true` causes the node to fail.
   * Empty / undefined disables the check entirely (engine is
   * domain-agnostic — workflows opt in by configuring this list). */
  memory_paths?: string[];
}

/** Configuration for a single workflow node. */
export interface NodeConfig {
  /** Determines execution behavior: agent (Claude CLI), merge, loop, or human prompt. */
  type: "agent" | "merge" | "loop" | "human";
  /** Human-readable description shown in logs and status output. */
  label: string;
  /** Node IDs whose outputs this node depends on; defines DAG edges. */
  inputs?: string[];

  // agent-specific
  /** Name of Claude Code agent (without .md extension) passed via --agent flag.
   * Resolved by the runtime against its own subagent registry. Optional —
   * allows prompt-only nodes. */
  agent?: string;
  /** Templateable task prompt sent to the agent via -p flag.
   * Supports `{{...}}` interpolation. Required for agent nodes. */
  prompt?: string;
  /** Templateable system context passed via --append-system-prompt.
   * Supports `{{...}}` interpolation and `{{file()}}` for inlining agent definitions. */
  system_prompt?: string;
  /** Claude model override for this node (e.g. "claude-opus-4-6"). */
  model?: string;
  /** Reasoning-effort override for this node (FR-E42). Cascade:
   * node → enclosing loop → defaults. See {@link WorkflowDefaults.effort}. */
  effort?: ReasoningEffort;
  /** Runtime override for this node. */
  runtime?: RuntimeId;
  /** Generic extra CLI args forwarded to this node's selected runtime.
   * Map-shape: see {@link WorkflowDefaults.runtime_args}. */
  runtime_args?: ExtraArgsMap;
  /** Permission mode override for this node (maps to --permission-mode CLI flag). */
  permission_mode?: PermissionMode;

  // common
  /** Per-node execution settings (timeouts, retries, error handling). */
  settings?: NodeSettings;
  /** Artifact validation rules checked after node completion. */
  validate?: ValidationRule[];
  /** Shell command or script to run before the node starts. */
  before?: string;
  /** Shell command or script to run after the node completes successfully. */
  after?: string;

  // loop-specific
  /** Inline body node definitions for loop nodes. Keys are body node IDs. */
  nodes?: Record<string, NodeConfig>;
  /** Node ID whose output is checked against exit_value each iteration. */
  condition_node?: string;
  /** Field name in condition_node's output to evaluate for loop exit. */
  condition_field?: string;
  /** Value that triggers loop termination when matched by condition_field. */
  exit_value?: string;
  /** Safety cap on loop iterations to prevent infinite execution. */
  max_iterations?: number;

  // merge-specific
  /** Strategy for combining inputs; currently only "copy_all" is supported. */
  merge_strategy?: "copy_all";

  // human-specific
  /** Prompt text displayed to the human operator. */
  question?: string;
  /** Allowed response values for the human prompt. */
  options?: string[];
  /** Response values that cause the workflow to abort. */
  abort_on?: string[];

  /** Optional phase this node belongs to. Used by phase registry to determine
   * artifact directory: `<runDir>/<phase>/<nodeId>/`. Falls back to top-level
   * `phases:` config. When absent, flat `<runDir>/<nodeId>/` is used. */
  phase?: string;

  // post-workflow execution
  /** When set, node executes after all DAG levels complete.
   * "always" = regardless of outcome, "success" = only on success, "failure" = only on failure. */
  run_on?: "always" | "success" | "failure";

  /** Legacy flag superseded by run_on; config loader normalizes it automatically.
   * @deprecated Use run_on instead. */
  run_always?: boolean;

  /** Optional node-level environment variables.
   * Merged with global env (node-level overrides global defaults).
   * Accessible in template context via `{{env.<key>}}`. */
  env?: Record<string, string>;

  /** Glob patterns for file paths permitted to be modified during agent invocation.
   * When set, the engine snapshots modified files before/after each invocation
   * and injects a scope_check validation failure if out-of-scope modifications
   * are detected. Pre-existing uncommitted changes are excluded (FR-E37). */
  allowed_paths?: string[];

  /** Per-node budget limits (FR-E47). Cascades: node → enclosing loop → defaults. */
  budget?: NodeBudget;

  /** Whitelist of tools (FR-E48). REPLACE-semantics cascade:
   * node → enclosing loop → defaults. Mutex with `disallowed_tools`. */
  allowed_tools?: string[];
  /** Blacklist of tools (FR-E48). REPLACE-semantics cascade.
   * Mutex with `allowed_tools`. */
  disallowed_tools?: string[];

  /** Opt out of the per-invocation memory-dirty check (FR-S28). When true,
   * the engine does NOT fail this node if memory_paths-matching files are
   * dirty after the agent runs. Intended for loop-body agents (e.g.
   * `build`) that legitimately defer the commit to a later iteration.
   * Default: false. Only meaningful when `defaults.memory_paths` is set. */
  memory_commit_deferred?: boolean;
}

/** Per-node settings (merged with defaults). */
export interface NodeSettings {
  /** Max agent re-invocations on validation failure before giving up (default 3). */
  max_continuations?: number;
  /** Wall-clock timeout per node execution in seconds (default 1800). */
  timeout_seconds?: number;
  /** Whether a node failure aborts the workflow or allows remaining nodes to proceed. */
  on_error?: "fail" | "continue";
  /** Number of full retry attempts after node failure (default 3). */
  max_retries?: number;
  /** Delay in seconds between retry attempts (default 5). */
  retry_delay_seconds?: number;
}

/** Artifact validation rule. */
export interface ValidationRule {
  /** Kind of check to perform on the artifact. */
  type:
    | "file_exists"
    | "file_not_empty"
    | "contains_section"
    | "custom_script"
    | "frontmatter_field"
    | "artifact"
    | "scope_check";
  /** Relative path to the artifact file being validated.
   * Empty string for engine-injected scope_check rules. */
  path: string;
  /** Expected content (section header for contains_section, script path for custom_script). */
  value?: string;
  /** Target field name in YAML frontmatter (for frontmatter_field rule). */
  field?: string;
  /** Allowed values for the field (for frontmatter_field rule). */
  allowed?: string[];
  /** Required markdown section headings (for artifact rule). */
  sections?: string[];
  /** Required frontmatter field keys to check for presence and non-empty value (for artifact rule). */
  fields?: string[];
}

// --- Runtime State ---

/** Structured error category set by engine when a node fails.
 * Domain-agnostic — downstream agents map these to domain actions. */
export type ErrorCategory =
  | "continuations_exhausted"
  | "timeout"
  | "cli_crash"
  | "hook_failure"
  | "hitl_timeout"
  | "aborted"
  | "scope_violation"
  | "unknown";

/** Status of a single node during execution. */
export type NodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "waiting";

/** Execution record for a single node. */
export interface NodeState {
  /** Current lifecycle status of this node. */
  status: NodeStatus;
  /** ISO 8601 timestamp when execution began. */
  started_at?: string;
  /** ISO 8601 timestamp when execution finished (success or failure). */
  completed_at?: string;
  /** Elapsed wall-clock time for this node in milliseconds. */
  duration_ms?: number;
  /** Human-readable error message if the node failed. */
  error?: string;
  /** Structured failure reason for programmatic error handling. */
  error_category?: ErrorCategory;
  /** Current loop iteration index (only set for nodes inside a loop). */
  iteration?: number;
  /** Number of continuation re-invocations performed so far. */
  continuations?: number;
  /** Claude CLI session ID for resume and log correlation. */
  session_id?: string;
  /** Serialized HitlQuestion JSON; populated when status is "waiting". */
  question_json?: string;
  /** Per-node cost from CliRunOutput.total_cost_usd (FR-E17). */
  cost_usd?: number;
  /** Excerpt of agent result text, persisted for summary display (FR-E15, FR-E22). */
  result?: string;
}

/** Persisted run state (state.json). */
export interface RunState {
  /** Unique identifier for this workflow run (timestamp-based). */
  run_id: string;
  /** Path to the YAML workflow config that produced this run. */
  config_path: string;
  /** ISO 8601 timestamp when the run started. */
  started_at: string;
  /** ISO 8601 timestamp when the run finished; absent while running. */
  completed_at?: string;
  /** Overall workflow outcome. */
  status: "running" | "completed" | "failed" | "aborted";
  /** CLI --arg key-value pairs passed at invocation. */
  args: Record<string, string>;
  /** Resolved environment variables (global + overrides) for this run. */
  env: Record<string, string>;
  /** Per-node execution state keyed by node ID. */
  nodes: Record<string, NodeState>;
  /** Sum of all nodes[*].cost_usd, recomputed on each node completion (FR-E17). */
  total_cost_usd?: number;
}

// --- Template Context ---

/** Variables available for template interpolation.
 *
 * Path fields (`node_dir`, `run_dir`, `input.<id>`) are workDir-relative —
 * valid when resolved from cwd = workDir. Agents launched with
 * cwd = workDir read them as-is. Engine internal code (whose cwd may
 * differ from workDir) must wrap them with `workPath(workDir, …)` before
 * any FS call.
 */
export interface TemplateContext {
  /** workDir-relative path to the current node's artifact directory.
   * Engine FS code must wrap with `workPath(workDir, node_dir)`. */
  node_dir: string;
  /** workDir-relative path to the run's root directory.
   * Engine FS code must wrap with `workPath(workDir, run_dir)`. */
  run_dir: string;
  /** Unique identifier of the current run. */
  run_id: string;
  /** Working directory of the engine (worktree path or "."). Engine code
   * uses it to recompose cwd-correct paths from `node_dir`/`run_dir`/
   * `input.<id>`. Not template-rendered — no `{{workDir}}` placeholder. */
  workDir: string;
  /** workDir-relative path to the directory containing the workflow.yaml
   * config file. Used by `{{flow_file("path")}}` to resolve paths against
   * the workflow folder rather than `workDir`. Empty string or undefined
   * when config sits at the workDir root (or in non-workflow contexts like
   * unit tests); `flow_file()` then degenerates to `file()`-equivalent
   * resolution against `workDir`. Not template-rendered — no
   * `{{workflow_dir}}` placeholder. */
  workflow_dir?: string;
  /** CLI --arg key-value pairs available as `{{args.<key>}}`. */
  args: Record<string, string>;
  /** Resolved environment variables available as `{{env.<key>}}`. */
  env: Record<string, string>;
  /** Maps dependency node IDs to their workDir-relative artifact directory
   * paths. Engine FS code must wrap each value with `workPath(workDir, …)`. */
  input: Record<string, string>;
  /** Loop context; only present for nodes executing inside a loop body. */
  loop?: {
    /** Zero-based iteration counter of the enclosing loop. */
    iteration: number;
  };
}

// --- Engine Options ---

/** CLI options passed to the engine. */
export interface EngineOptions {
  /** Path to the YAML workflow config file. */
  config_path: string;
  /** Existing run ID to resume; requires resume=true. */
  run_id?: string;
  /** When true, skip already-completed nodes and continue from last failure. */
  resume?: boolean;
  /** When true, validate config and print execution plan without running nodes. */
  dry_run?: boolean;
  /** Controls how much detail is printed to stderr during execution. */
  verbosity: Verbosity;
  /** User-supplied key-value pairs accessible via `{{args.<key>}}` in templates. */
  args: Record<string, string>;
  /** Environment variable overrides that take precedence over config-level env. */
  env_overrides: Record<string, string>;
  /** Node IDs to skip during execution (useful for partial reruns). */
  skip_nodes?: string[];
  /** When set, only these node IDs execute; all others are skipped. */
  only_nodes?: string[];
  /** Override lock file path (default: `<workflowDir>/runs/.lock`, FR-E54).
   * Used in tests. */
  lock_path?: string;
  /** Workflow-wide USD cost cap (FR-E47). Strict: exact-equal does not trigger. */
  budget_usd?: number;
  /** Optional caller-supplied process tracker scope
   * (FR-E60). When provided, every child
   * process spawned for this `Engine.run()` (runtime CLI invocations, HITL
   * MCP helpers) is registered in this {@link ProcessRegistry} instance
   * instead of the package-wide default singleton from
   * `@korchasa/ai-ide-cli`. Embedding hosts that run `Engine` alongside
   * other long-lived subsystems use this to scope `killAll()` to the
   * engine's children only — sibling subprocesses keep running. Falls
   * back to the default singleton when omitted, preserving stand-alone
   * CLI behavior. */
  processRegistry?: ProcessRegistry;
}
