/**
 * Type declarations for the configurable node-based pipeline engine.
 * No logic — pure type definitions.
 */

// --- Pipeline Configuration (parsed from YAML) ---

/** Top-level pipeline configuration. */
export interface PipelineConfig {
  name: string;
  version: "1";
  defaults?: PipelineDefaults;
  env?: Record<string, string>;
  nodes: Record<string, NodeConfig>;
}

/** Global defaults applied to all nodes unless overridden. */
export interface PipelineDefaults extends NodeSettings {
  max_parallel?: number; // 0 = unlimited (default)
  claude_args?: string[]; // extra args passed to claude CLI (e.g. ["--dangerously-skip-permissions"])
  model?: string; // default Claude model for all agent nodes (e.g. "claude-sonnet-4-6")
  hitl?: HitlConfig; // human-in-the-loop config (ask/check scripts, poll, timeout)
}

/** Configuration for a single pipeline node. */
export interface NodeConfig {
  type: "agent" | "merge" | "loop" | "human";
  label: string;
  inputs?: string[];

  // agent-specific
  prompt?: string;
  task_template?: string;
  /** Claude model override for this node (e.g. "claude-opus-4-6"). */
  model?: string;

  // common
  settings?: NodeSettings;
  validate?: ValidationRule[];
  before?: string;
  after?: string;

  // loop-specific
  /** Inline body node definitions for loop nodes. Keys are body node IDs. */
  nodes?: Record<string, NodeConfig>;
  condition_node?: string;
  condition_field?: string;
  exit_value?: string;
  max_iterations?: number;

  // merge-specific
  merge_strategy?: "copy_all";

  // human-specific
  question?: string;
  options?: string[];
  abort_on?: string[];

  // post-pipeline execution
  /** When set, node executes after all DAG levels complete.
   * "always" = regardless of outcome, "success" = only on success, "failure" = only on failure. */
  run_on?: "always" | "success" | "failure";

  /** @deprecated Use run_on instead. Normalized to run_on by config loader. */
  run_always?: boolean;

  /** Optional node-level environment variables.
   * Merged with global env (node-level overrides global defaults).
   * Accessible in template context via `{{env.<key>}}`. */
  env?: Record<string, string>;
}

/** Per-node settings (merged with defaults). */
export interface NodeSettings {
  max_continuations?: number; // default 3
  timeout_seconds?: number; // default 1800
  on_error?: "fail" | "continue"; // default "fail"
  max_retries?: number; // default 3
  retry_delay_seconds?: number; // default 5
}

/** Artifact validation rule. */
export interface ValidationRule {
  type:
    | "file_exists"
    | "file_not_empty"
    | "contains_section"
    | "custom_script"
    | "frontmatter_field";
  path: string;
  value?: string;
  /** Target field name in YAML frontmatter (for frontmatter_field rule). */
  field?: string;
  /** Allowed values for the field (for frontmatter_field rule). */
  allowed?: string[];
}

// --- Runtime State ---

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
  status: NodeStatus;
  started_at?: string; // ISO 8601
  completed_at?: string; // ISO 8601
  duration_ms?: number;
  error?: string;
  iteration?: number; // for loop nodes
  continuations?: number;
  session_id?: string; // claude CLI session ID
  question_json?: string; // serialized HitlQuestion; set when status=waiting
}

/** Persisted run state (state.json). */
export interface RunState {
  run_id: string;
  config_path: string;
  started_at: string;
  completed_at?: string;
  status: "running" | "completed" | "failed" | "aborted";
  args: Record<string, string>;
  env: Record<string, string>;
  nodes: Record<string, NodeState>;
}

// --- Template Context ---

/** Variables available for template interpolation. */
export interface TemplateContext {
  node_dir: string;
  run_dir: string;
  run_id: string;
  args: Record<string, string>;
  env: Record<string, string>;
  input: Record<string, string>; // node-id → output dir
  loop?: {
    iteration: number;
  };
}

// --- Engine Options ---

/** Verbosity level for terminal output. */
export type Verbosity = "quiet" | "normal" | "verbose";

/** CLI options passed to the engine. */
export interface EngineOptions {
  config_path: string;
  run_id?: string; // for resume
  resume?: boolean;
  dry_run?: boolean;
  verbosity: Verbosity;
  args: Record<string, string>;
  env_overrides: Record<string, string>;
  skip_nodes?: string[];
  only_nodes?: string[];
}

// --- Claude CLI Output ---

/** A single permission denial from Claude CLI JSON output. */
export interface PermissionDenial {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/** JSON output from `claude -p ... --output-format json`. */
export interface ClaudeCliOutput {
  result: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  is_error: boolean;
  permission_denials?: PermissionDenial[];
}

// --- HITL Configuration ---

/** Human-in-the-loop configuration for pipeline defaults. */
export interface HitlConfig {
  ask_script: string;
  check_script: string;
  issue_source?: string; // relative path from run_dir to artifact with issue frontmatter
  poll_interval: number; // seconds between polls, default 60
  timeout: number; // max wait seconds, default 7200
  bot_login?: string; // login to exclude in hitl-check.sh
}
