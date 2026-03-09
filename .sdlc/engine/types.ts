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
}

/** Configuration for a single pipeline node. */
export interface NodeConfig {
  type: "agent" | "merge" | "loop" | "human";
  label: string;
  inputs?: string[];

  // agent-specific
  prompt?: string;
  task_template?: string;
  allowed_paths?: string[];

  // common
  settings?: NodeSettings;
  validate?: ValidationRule[];
  before?: string;
  after?: string;

  // loop-specific
  body?: string[];
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
  /** When true, node executes after all DAG levels complete (even on failure). */
  run_always?: boolean;
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
  | "skipped";

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

/** JSON output from `claude -p ... --output-format json`. */
export interface ClaudeCliOutput {
  result: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  is_error: boolean;
}
