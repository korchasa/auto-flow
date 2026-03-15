/**
 * Type declarations for the configurable node-based pipeline engine.
 * No logic — pure type definitions.
 */

// --- Pipeline Configuration (parsed from YAML) ---

/** Top-level pipeline configuration. */
export interface PipelineConfig {
  /** Pipeline identifier used in logs and state files. */
  name: string;
  /** Config schema version; only "1" is currently supported. */
  version: "1";
  /** Shell script executed before config is fully loaded and pipeline starts.
   * Enables self-healing (e.g. reset to stable branch). The engine reads only
   * this field first, runs the script, then re-reads the full config. */
  pre_run?: string;
  /** Global defaults applied to all nodes unless overridden at node level. */
  defaults?: PipelineDefaults;
  /** Global environment variables accessible via `{{env.<key>}}` in templates. */
  env?: Record<string, string>;
  /** DAG node definitions keyed by unique node ID. */
  nodes: Record<string, NodeConfig>;
  /** Optional phase grouping: maps phase name to list of node IDs.
   * Enables phase-organized artifact directories (FR-E9, FR-S25). */
  phases?: Record<string, string[]>;
}

/** Global defaults applied to all nodes unless overridden. */
export interface PipelineDefaults extends NodeSettings {
  /** Maximum parallel node executions; 0 means unlimited (default). */
  max_parallel?: number;
  /** Extra CLI args forwarded to every claude invocation (e.g. ["--dangerously-skip-permissions"]). */
  claude_args?: string[];
  /** Default Claude model for all agent nodes (e.g. "claude-sonnet-4-6"). */
  model?: string;
  /** Human-in-the-loop config: ask/check scripts, poll interval, timeout. */
  hitl?: HitlConfig;
  /** Path to script executed when the pipeline fails (FR-34). */
  on_failure_script?: string;
  /** Shell command executed once before the node level loop on fresh runs.
   * Supports template interpolation (run_dir, run_id, env.*, args.*).
   * Skipped on resume. Non-zero exit aborts the pipeline (FR-E30). */
  prepare_command?: string;
}

/** Configuration for a single pipeline node. */
export interface NodeConfig {
  /** Determines execution behavior: agent (Claude CLI), merge, loop, or human prompt. */
  type: "agent" | "merge" | "loop" | "human";
  /** Human-readable description shown in logs and status output. */
  label: string;
  /** Node IDs whose outputs this node depends on; defines DAG edges. */
  inputs?: string[];

  // agent-specific
  /** Path to prompt file or inline prompt text for agent nodes. */
  prompt?: string;
  /** Cached prompt file content, read at config load time.
   * Populated for non-template prompt paths; undefined for template paths. */
  prompt_content?: string;
  /** Template for the task message sent to the agent; supports `{{...}}` interpolation. */
  task_template?: string;
  /** Claude model override for this node (e.g. "claude-opus-4-6"). */
  model?: string;

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
  /** Response values that cause the pipeline to abort. */
  abort_on?: string[];

  /** Optional phase this node belongs to. Used by phase registry to determine
   * artifact directory: `<runDir>/<phase>/<nodeId>/`. Falls back to top-level
   * `phases:` config. When absent, flat `<runDir>/<nodeId>/` is used. */
  phase?: string;

  // post-pipeline execution
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
}

/** Per-node settings (merged with defaults). */
export interface NodeSettings {
  /** Max agent re-invocations on validation failure before giving up (default 3). */
  max_continuations?: number;
  /** Wall-clock timeout per node execution in seconds (default 1800). */
  timeout_seconds?: number;
  /** Whether a node failure aborts the pipeline or allows remaining nodes to proceed. */
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
    | "frontmatter_field";
  /** Relative path to the artifact file being validated. */
  path: string;
  /** Expected content (section header for contains_section, script path for custom_script). */
  value?: string;
  /** Target field name in YAML frontmatter (for frontmatter_field rule). */
  field?: string;
  /** Allowed values for the field (for frontmatter_field rule). */
  allowed?: string[];
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
  /** Per-node cost from ClaudeCliOutput.total_cost_usd (FR-32). */
  cost_usd?: number;
  /** Excerpt of agent result text, persisted for summary display (FR-E15, FR-E22). */
  result?: string;
}

/** Persisted run state (state.json). */
export interface RunState {
  /** Unique identifier for this pipeline run (timestamp-based). */
  run_id: string;
  /** Path to the YAML pipeline config that produced this run. */
  config_path: string;
  /** ISO 8601 timestamp when the run started. */
  started_at: string;
  /** ISO 8601 timestamp when the run finished; absent while running. */
  completed_at?: string;
  /** Overall pipeline outcome. */
  status: "running" | "completed" | "failed" | "aborted";
  /** CLI --arg key-value pairs passed at invocation. */
  args: Record<string, string>;
  /** Resolved environment variables (global + overrides) for this run. */
  env: Record<string, string>;
  /** Per-node execution state keyed by node ID. */
  nodes: Record<string, NodeState>;
  /** Sum of all nodes[*].cost_usd, recomputed on each node completion (FR-32). */
  total_cost_usd?: number;
}

// --- Template Context ---

/** Variables available for template interpolation. */
export interface TemplateContext {
  /** Absolute path to the current node's artifact directory. */
  node_dir: string;
  /** Absolute path to the run's root directory. */
  run_dir: string;
  /** Unique identifier of the current run. */
  run_id: string;
  /** CLI --arg key-value pairs available as `{{args.<key>}}`. */
  args: Record<string, string>;
  /** Resolved environment variables available as `{{env.<key>}}`. */
  env: Record<string, string>;
  /** Maps dependency node IDs to their artifact directory paths. */
  input: Record<string, string>;
  /** Loop context; only present for nodes executing inside a loop body. */
  loop?: {
    /** Zero-based iteration counter of the enclosing loop. */
    iteration: number;
  };
}

// --- Engine Options ---

/** Verbosity level for terminal output. */
export type Verbosity = "quiet" | "normal" | "semi-verbose" | "verbose";

/** CLI options passed to the engine. */
export interface EngineOptions {
  /** Path to the YAML pipeline config file. */
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
  /** Override lock file path (default: .auto-flow/runs/.lock). Used in tests. */
  lock_path?: string;
}

// --- Claude CLI Output ---

/** A single permission denial from Claude CLI JSON output. */
export interface PermissionDenial {
  /** Name of the tool that was denied (e.g. "Bash", "Edit"). */
  tool_name: string;
  /** Arguments passed to the denied tool invocation. */
  tool_input: Record<string, unknown>;
}

/** JSON output from `claude -p ... --output-format json`. */
export interface ClaudeCliOutput {
  /** Agent's final text response. */
  result: string;
  /** Session ID for continuation and log correlation. */
  session_id: string;
  /** Total API cost in USD for this invocation. */
  total_cost_usd: number;
  /** Wall-clock duration of the entire CLI run in milliseconds. */
  duration_ms: number;
  /** Time spent waiting for API responses in milliseconds. */
  duration_api_ms: number;
  /** Number of conversational turns in this session. */
  num_turns: number;
  /** Whether the CLI exited with an error condition. */
  is_error: boolean;
  /** Tools the agent tried to use but was denied permission for. */
  permission_denials?: PermissionDenial[];
}

// --- HITL Configuration ---

/** Human-in-the-loop configuration for pipeline defaults. */
export interface HitlConfig {
  /** Script invoked to post a question to the human operator. */
  ask_script: string;
  /** Script polled to check if the human has responded. */
  check_script: string;
  /** Relative path from run_dir to artifact containing issue frontmatter. */
  artifact_source?: string;
  /** Seconds between consecutive polls of check_script (default 60). */
  poll_interval: number;
  /** Maximum seconds to wait for a human response before timing out (default 7200). */
  timeout: number;
  /** Login name to exclude from HITL responses (e.g. bot's own login). */
  exclude_login?: string;
}
