/**
 * @module
 * Type declarations for the configurable node-based workflow engine.
 * No logic — pure type definitions.
 *
 * Runtime-neutral types (runtime identifiers, verbosity, normalized runtime
 * output) come from `@korchasa/ai-ide-cli` and are re-exported here.
 * `PermissionMode` and HITL types (`HitlConfig`, `HumanInputRequest`,
 * `HumanInputOption`) are owned by the engine — the runtime package ships no
 * HITL surface, and the engine pins its own narrowed permission-mode enum
 * (see this repo's hitl-via-engine-mcp).
 */

import type {
  CliRunOutput,
  PermissionDenial,
  RuntimeId,
  Verbosity,
} from "@korchasa/ai-ide-cli/types";
import type {
  ExtraArgsMap,
  RuntimeAdapter,
} from "@korchasa/ai-ide-cli/runtime/types";
import type { ReasoningEffort } from "@korchasa/ai-ide-cli/runtime/reasoning-effort";
import type { ProcessRegistry } from "@korchasa/ai-ide-cli/process-registry";

export type {
  CliRunOutput,
  PermissionDenial,
  ProcessRegistry,
  ReasoningEffort,
  RuntimeId,
  Verbosity,
};
export { VALID_RUNTIME_IDS } from "@korchasa/ai-ide-cli/types";
export { REASONING_EFFORT_VALUES } from "@korchasa/ai-ide-cli/runtime/reasoning-effort";

/**
 * Narrowed agent permission-mode values (maps to the runtime's
 * `--permission-mode` flag). Engine-owned: the engine pins its own narrowed
 * enum rather than depending on `@korchasa/ai-ide-cli`'s Claude-specific
 * permission-mode surface (same pattern as the engine-owned HITL types). */
export type PermissionMode =
  | "acceptEdits"
  | "bypassPermissions"
  | "default"
  | "plan";

/** Runtime-checkable list of valid {@link PermissionMode} values. */
export const VALID_PERMISSION_MODES: readonly string[] = [
  "acceptEdits",
  "bypassPermissions",
  "default",
  "plan",
];

// --- HITL Types (engine-owned, post library v0.8.0; hitl-via-engine-mcp) ---

/** A single answer-option attached to a HITL request. */
export interface HumanInputOption {
  /** User-visible option label. */
  label: string;
  /** Optional explanatory text shown alongside the label. */
  description?: string;
}

/** Runtime-normalised human-input request captured from an MCP tool call. */
export interface HumanInputRequest {
  /** Main question text to present to the operator. */
  question: string;
  /** Optional heading displayed above the question. */
  header?: string;
  /** Optional list of predefined answer choices. */
  options?: HumanInputOption[];
  /** Whether multiple options may be selected. */
  multiSelect?: boolean;
}

/**
 * Workflow-level HITL configuration. Specifies the external transport
 * scripts the engine invokes to post questions and poll for replies, plus
 * polling/timeout knobs. Read from `defaults.hitl` in workflow.yaml.
 */
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

/** FR-E95: the object form of `fork` — one branch per element of a list. */
export interface ForkConfig {
  /** Branch group this node's expansions belong to. The group's `join` node
   * names the same string. */
  group: string;
  /** Path to the branch list, interpolated then resolved against the working
   * directory. Content is a JSON array of strings, numbers or objects, or one
   * item per non-empty line. An object item is what lets the producing agent
   * hand each branch its own prompt and scope. */
  branches: string;
  /** How a branch gets its name: omitted numbers them (0, 1, 2 …), `value`
   * slugifies a scalar item, `value.<field>` reads a field of an object item.
   * Branch names must be unique within a group. */
  key?: string;
  /** Branches running at once. Defaults to 1; the config loader fills it in,
   * so only a hand-built config sees it absent. */
  max_concurrent?: number;
}

/** Configuration for a single workflow node. */
export interface NodeConfig {
  /** Determines execution behavior: agent (runtime CLI), command (shell),
   * merge, loop, or human prompt. */
  type: "agent" | "command" | "merge" | "loop" | "human" | "hitl";
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

  // command-specific
  /**
   * Shell command executed as the node's whole work (FR-E88). Required for
   * `type: command` and rejected on every other type.
   *
   * Runs through `bash -c` in the run's working directory, bounded by
   * `settings.timeout_seconds`, with the full template surface available.
   * stdout, stderr and the exit code are persisted as `stdout.txt`,
   * `stderr.txt` and `exit_code.txt` in the node's artifact directory, so a
   * downstream node can consume them through `{{input.<id>}}` exactly like an
   * agent's output. Exit 0 is success; anything else fails the node with
   * `error_category: "command_failed"`.
   *
   * Distinct from `before`/`after`, which are hooks bracketing another node's
   * work and carry no dependencies, artifacts or validation of their own.
   */
  command?: string;

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
  /**
   * Shell predicate evaluated after every iteration (FR-E87). Exit code 0
   * ends the loop; any other code starts the next iteration. Runs through
   * `bash -c` with cwd = the run's working directory, and supports the full
   * template surface (`{{loop.iteration}}`, `{{node_dir}}`, `{{env.*}}`, …).
   *
   * Mutually exclusive with the `condition_node`/`condition_field`/
   * `exit_value` triple: a loop declares its exit either as "this artifact
   * field equals this value" or as "this command succeeds", never both.
   */
  until?: string;
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

  /** FR-E95: declare that this node opens a branch of a fork group. The string
   * form `"<group>.<branch>"` opens one static branch; the object form expands
   * the node into one branch per element of a runtime list. Membership
   * propagates from here along `inputs` until the group's `join` node, so a
   * branch that takes several nodes declares `fork` only on its first one.
   * Valid on `agent` and `command` nodes only. */
  fork?: string | ForkConfig;

  /** FR-E95: this node is the barrier of the named fork group. It runs once,
   * after every branch of the group has finished, and reads their answers from
   * the manifest the engine writes into its artifact directory. Exactly one
   * node per group carries it, and no node carries both `fork` and `join`. */
  join?: string;

  /** FR-E95: what a failed branch does to the rest of its group. `fail_fast`
   * (default) stops the group at the first failure, `collect` lets every
   * branch finish and records the failures in the manifest, `all_or_nothing`
   * fails the group without running the join. Valid on a `join` node only. */
  failure_mode?: "fail_fast" | "collect" | "all_or_nothing";

  /** FR-E89: shell predicate gating this node. Evaluated immediately before
   * the node would run; exit 0 runs it, any other code skips it — and the skip
   * propagates to every node downstream of it. Unlike `run_on` (which selects
   * post-workflow nodes by run outcome) this is an ordinary in-graph branch. */
  when?: string;

  // post-workflow execution
  /** When set, the node executes after the graph, once its outcome is known.
   * "always" = regardless of outcome, "success" = only on success, "failure"
   * = only on failure — each of the three runs at most once per run, so a
   * node that already completed is left alone on `--resume`.
   * "every_attempt" (FR-E99) = regardless of outcome AND reconsidered on
   * every engine invocation, so a resumed run runs it again. Narrowing it by
   * outcome is `when`'s job: `run_on: every_attempt` with
   * `when: '[ "{{run.outcome}}" = "failure" ]'` reads "every attempt, while
   * the run is failing". */
  run_on?: "always" | "success" | "failure" | "every_attempt";

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

  /** Give this node a git worktree of its own instead of the run's shared one
   * (FR-E91). Valid on `agent` and `command` nodes. Off by default: the shared
   * worktree is how one node's source edits reach the next, so isolation is
   * something a workflow author asks for, not something the engine assumes.
   *
   * The node's artifacts still land in the run's shared directory, so
   * `{{input.<id>}}` keeps working downstream; only the source tree splits. */
  isolation?: "worktree";

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
  /**
   * Cumulative wall-clock budget for ALL invocation attempts of a single
   * node, in seconds (FR-E80). Bounds the engine's outer
   * AbortController forwarded into `RuntimeInvokeOptions.signal`. The
   * SAME controller is reused across initial invoke + validation
   * continuations, so the budget covers the sum (not per-attempt).
   * Undefined ≡ no cap; only the per-attempt `timeout_seconds` applies.
   */
  max_retry_wall_clock_seconds?: number;
}

/**
 * Node settings after the 3-tier defaults cascade. All fields with documented
 * defaults are guaranteed present; `max_retry_wall_clock_seconds` (FR-E80)
 * remains optional because `undefined` is the documented "no cap" state.
 */
export type ResolvedNodeSettings =
  & Required<Omit<NodeSettings, "max_retry_wall_clock_seconds">>
  & Pick<NodeSettings, "max_retry_wall_clock_seconds">;

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
    | "git_worktree_clean"
    | "git_default_branch_checked_out"
    | "git_no_unpushed_commits"
    | "scope_check";
  /** Relative path to the artifact file being validated.
   * Empty string for engine-injected scope_check rules. Optional for
   * Git repository-state rules, which check the full Git repository. */
  path?: string;
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
  | "command_failed"
  /** FR-E88: validation rules failed on a node that has no continuation path —
   * a command node cannot be re-prompted, so `continuations_exhausted` would
   * name a mechanism that never ran. */
  | "validation_failed"
  | "cli_crash"
  | "stream_stall"
  | "hook_failure"
  | "hitl_timeout"
  | "aborted"
  | "scope_violation"
  | "retry_budget_exceeded"
  /** FR-E98: the node asks for something the runtime transport cannot carry,
   * detected before any subprocess starts. Distinct from `cli_crash` — nothing
   * ran, and the fix is in the workflow file, not in the environment. */
  | "config_error"
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
  /** FR-E99: engine invocation in which this node last reached `completed`.
   * Set for nodes of the outcome wave only — it is what tells a
   * `run_on: every_attempt` node "you already ran in THIS attempt" apart from
   * "you ran in an earlier one". */
  completed_attempt?: number;
}

/** Optional metadata copied from a node state into a lifecycle event. */
export interface NodeLifecycleMetadata {
  /** Human-readable error message if the node failed. */
  error?: string;
  /** Structured failure reason for programmatic error handling. */
  error_category?: ErrorCategory;
  /** Elapsed wall-clock time for this node in milliseconds. */
  duration_ms?: number;
  /** Per-node cost from CliRunOutput.total_cost_usd. */
  cost_usd?: number;
  /** Excerpt of agent result text persisted for summary display. */
  result?: string;
  /** Runtime session ID for resume and log correlation. */
  session_id?: string;
  /** Serialized human-input question JSON when status is "waiting". */
  question_json?: string;
  /** Current loop iteration index for loop body nodes. */
  iteration?: number;
}

/** Engine-native node lifecycle event delivered to embedding hosts. */
export interface NodeLifecycleEvent extends NodeLifecycleMetadata {
  /** Unique identifier for this workflow run. */
  run_id: string;
  /** Node ID whose lifecycle state just changed. */
  node_id: string;
  /** Current lifecycle status after the state mutation. */
  status: NodeStatus;
  /** ISO 8601 event timestamp. Running/completed/failed reuse node timestamps. */
  timestamp: string;
  /** Snapshot of the node state after the mutation. */
  node: NodeState;
  /** Optional metadata copied from the node state for stable host consumption. */
  metadata: NodeLifecycleMetadata;
}

/** Optional callback invoked after node lifecycle state transitions. */
export type NodeLifecycleCallback = (
  event: NodeLifecycleEvent,
) => void | Promise<void>;

/** Versioned durable lifecycle event kinds stored in `journal.jsonl`. */
export type RunJournalEventKind =
  | "run_started"
  | "run_attempt_started"
  | "run_metadata_updated"
  | "workflow_loaded"
  | "node_declared"
  | "node_directory_declared"
  | "branches_expanded"
  | "node_started"
  | "node_completed"
  | "node_failed"
  | "node_waiting"
  | "node_skipped"
  | "attempt_started"
  | "attempt_completed"
  | "continuation_exhausted"
  | "loop_iteration_started"
  | "loop_iteration_completed"
  | "loop_iteration_failed"
  | "run_completed"
  | "run_failed"
  | "run_aborted";

/** Common envelope for every line in `journal.jsonl`. */
export interface RunJournalEventBase {
  /** Journal schema version. */
  schema_version: 1;
  /** Unique identifier for this workflow run. */
  run_id: string;
  /** Monotonic per-run sequence number assigned by the engine. */
  seq: number;
  /** Stable event identity used by hosts to deduplicate replay. */
  event_id: string;
  /** Discriminant for event-specific payload. */
  kind: RunJournalEventKind;
  /** ISO 8601 timestamp for when the fact was recorded. */
  ts: string;
  /** FR-E92: hash of the preceding record (`""` for the first). Absent in
   * journals written before hashing existed. */
  prev_hash?: string;
  /** FR-E92: SHA-256 of this record's canonical JSON with `hash` removed —
   * so it covers `prev_hash` and thus every earlier record. Absent in
   * journals written before hashing existed. */
  hash?: string;
}

/** Run bootstrap fact. */
export interface RunStartedJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "run_started";
  /** Workflow config path used for this run. */
  config_path: string;
  /** Run start timestamp. */
  started_at: string;
  /** CLI arguments resolved for this run. */
  args: Record<string, string>;
  /**
   * Names of the environment variables resolved for this run — VALUES ARE
   * NEVER PERSISTED. The engine's env map is fed from `.env` and `--env`, so
   * it routinely carries API tokens; writing it verbatim leaked those secrets
   * into `journal.jsonl` and, through the MCP `get_state` tool, into the
   * calling model's context. Recording only the key set keeps the journal
   * useful for post-mortems ("was OPENROUTER_API_KEY set?") while making the
   * file safe to read and ship. On resume the engine re-derives the values
   * from the live environment; a key that is no longer set surfaces as a
   * fail-fast `Unknown env variable` at template interpolation.
   */
  env_keys: string[];
  /**
   * Legacy full env map written by engines before the redaction change.
   * Read-only back-compat for replaying old journals — never written.
   * @deprecated Use {@link RunStartedJournalEvent.env_keys}.
   */
  env?: Record<string, string>;
}

/** FR-E99: one engine invocation over this run.
 *
 * `run_started` is emitted once, by the fresh run; every invocation — the
 * fresh one included — emits this. Counting them is how a resumed run knows
 * which attempt it is, which is what `run_on: every_attempt` and
 * `{{run.attempt}}` are defined against. A journal written before this event
 * existed replays as attempt 1. */
export interface RunAttemptStartedJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "run_attempt_started";
  /** One-based invocation counter: 1 for the fresh run, +1 per resume. */
  attempt: number;
}

/** Run metadata update fact. */
export interface RunMetadataUpdatedJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "run_metadata_updated";
  /** Captured Claude CLI version, when available. */
  claude_cli_version?: string;
}

/** Workflow configuration discovery fact. */
export interface WorkflowLoadedJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "workflow_loaded";
  /** Workflow config path used for this run. */
  config_path: string;
  /** Workflow name from config. */
  name: string;
  /** Workflow config schema version. */
  version: string;
}

/** Node discovery fact. */
export interface NodeDeclaredJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "node_declared";
  /** Declared workflow node ID. */
  node_id: string;
  /** Declared workflow node type. */
  node_type: NodeConfig["type"];
  /** Human-readable node label. */
  label: string;
  /** Optional artifact phase for this node. */
  phase?: string;
}

/** Node output directory discovery fact. */
export interface NodeDirectoryDeclaredJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "node_directory_declared";
  /** Node ID whose output directory was declared. */
  node_id: string;
  /** WorkDir-relative node output directory path. */
  node_dir: string;
}

/**
 * FR-E95/FR-E97: the branch set a dynamic `fork` expanded into.
 *
 * Durable because the list is produced at runtime by an earlier node: a
 * resumed run must rebuild the branches it actually ran, not whatever the
 * source file says now.
 */
export interface BranchesExpandedJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "branches_expanded";
  /** Node that carries the `fork`. */
  node_id: string;
  /** Fork group the branches belong to. */
  group: string;
  /** The expanded branches, in execution order. */
  branches: { index: number; key: string; value: unknown }[];
}

/** Durable node transition fact aligned with `NodeLifecycleEvent`. */
export interface NodeLifecycleJournalEvent
  extends RunJournalEventBase, NodeLifecycleMetadata {
  /** Event kind. */
  kind:
    | "node_started"
    | "node_completed"
    | "node_failed"
    | "node_waiting"
    | "node_skipped";
  /** Node ID whose lifecycle changed. */
  node_id: string;
  /** Node status after the transition. */
  status: NodeStatus;
  /** Lifecycle timestamp matching the live callback semantics. */
  timestamp: string;
  /** Node state snapshot after the transition. */
  node: NodeState;
  /** Optional metadata copied from the node state. */
  metadata: NodeLifecycleMetadata;
}

/** Runtime invocation attempt fact. */
export interface AttemptJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "attempt_started" | "attempt_completed" | "continuation_exhausted";
  /** Node ID whose runtime attempt changed. */
  node_id: string;
  /** Loop iteration for body-node attempts. */
  iteration?: number;
  /** Runtime session ID, when reported. */
  session_id?: string;
  /** Number of continuations used by the attempt. */
  continuations?: number;
  /** Attempt cost in USD, when reported. */
  cost_usd?: number;
  /** Compact result excerpt, when available. */
  result?: string;
  /** Whether the attempt ended successfully. */
  success?: boolean;
  /** Attempt error message, when failed. */
  error?: string;
  /** Structured attempt failure category. */
  error_category?: ErrorCategory;
}

/** Loop iteration lifecycle fact. */
export interface LoopIterationJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind:
    | "loop_iteration_started"
    | "loop_iteration_completed"
    | "loop_iteration_failed";
  /** Loop node ID whose iteration changed. */
  loop_node_id: string;
  /** One-based loop iteration number. */
  iteration: number;
  /** Configured maximum iteration count, when known. */
  max_iterations?: number;
  /** Iteration error message, when failed. */
  error?: string;
  /** Structured iteration failure category. */
  error_category?: ErrorCategory;
}

/** Terminal workflow fact. */
export interface RunTerminalJournalEvent extends RunJournalEventBase {
  /** Event kind. */
  kind: "run_completed" | "run_failed" | "run_aborted";
  /** Terminal run status. */
  status: RunState["status"];
  /** Terminal timestamp. */
  completed_at: string;
  /** Optional terminal error message. */
  error?: string;
}

/** Any durable lifecycle event stored in `journal.jsonl`. */
export type RunJournalEvent =
  | RunStartedJournalEvent
  | RunAttemptStartedJournalEvent
  | RunMetadataUpdatedJournalEvent
  | WorkflowLoadedJournalEvent
  | NodeDeclaredJournalEvent
  | NodeDirectoryDeclaredJournalEvent
  | BranchesExpandedJournalEvent
  | NodeLifecycleJournalEvent
  | AttemptJournalEvent
  | LoopIterationJournalEvent
  | RunTerminalJournalEvent;

/** Result of replaying a run journal from disk. */
export interface RunJournalReplayResult {
  /** Reconstructed current run state. */
  state: RunState;
  /** Unique events applied during replay, in file order. */
  events: RunJournalEvent[];
  /** Number of duplicate event IDs ignored. */
  ignored_duplicate_event_ids: number;
  /** Whether a malformed partial final line was ignored. */
  ignored_partial_tail: boolean;
}

/** In-memory run state derived live or by replaying `journal.jsonl`. */
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
  /** Claude CLI version string captured at run start via `claude --version` (FR-E49). */
  claude_cli_version?: string;
  /** FR-E99: one-based engine invocation counter — 1 for the fresh run, +1
   * per resume. Absent in states replayed from journals written before the
   * counter existed; readers treat absence as 1. */
  attempt?: number;
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
  /** FR-E99 run context: the outcome of the graph and the invocation counter.
   * Present whenever the engine builds the context; absent in the bare
   * literals unit tests construct, where `{{run.*}}` then fails clearly
   * rather than resolving to a guess. `outcome` reads `pending` until the
   * graph has finished, so a node inside the graph cannot read its own
   * verdict. */
  run?: {
    /** Graph verdict: `pending` while the graph runs, then its result. */
    outcome: "pending" | "success" | "failure";
    /** One-based engine invocation counter for this run. */
    attempt: number;
  };
  /** Loop context; only present for nodes executing inside a loop body. */
  loop?: {
    /** Zero-based iteration counter of the enclosing loop. */
    iteration: number;
  };
  /** FR-E95 branch context; only present for a node running inside one branch
   * of a fork group. */
  branch?: {
    /** Zero-based position of this branch in the source list. */
    index: number;
    /** The branch's own item — a string for a scalar list, an object for a
     * record list. Addressed as `{{branch.value}}` or `{{branch.value.<field>}}`. */
    value: unknown;
    /** This branch's name, and its artifact-directory name. */
    key: string;
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
  /** Optional embedding-host callback invoked after node lifecycle mutations.
   * The callback is awaited. Rejection fails the run clearly. */
  onNodeLifecycle?: NodeLifecycleCallback;
  /** Runtime adapter substituted for every agent invocation of this run
   * (FR-E86) — top-level agent nodes, loop-body nodes, and HITL resume
   * turns alike. Omit in production: the engine then resolves the real
   * adapter per node from `resolveRuntimeConfig`. Tests inject
   * `createFakeRuntime()` (`src/testing/fake-runtime.ts`) to exercise the
   * whole run without an agent; embedding hosts may inject their own
   * adapter implementation. */
  runtimeAdapter?: RuntimeAdapter;
}
