/**
 * @module
 * Main workflow engine: orchestrates node execution across DAG levels.
 * Handles config loading, worktree setup, state management, lock
 * acquisition, post-workflow hooks, and final summary output.
 * Entry point: {@link Engine.run}.
 */

import type {
  EngineOptions,
  NodeConfig,
  RunState,
  TemplateContext,
  WorkflowConfig,
} from "./types.ts";
import type { AgentResult } from "./agent.ts";
import {
  collectAllNodeIds,
  extractWorktreeDisabled,
  findNodeConfig,
  loadConfig,
  resolveBudget,
} from "./config.ts";
import { resolveRuntimeConfig } from "@korchasa/ai-ide-cli/runtime";
import { buildLevels } from "./dag.ts";
import { terminalInput } from "./human.ts";
import type { UserInput } from "./human.ts";
import { acquireLock, defaultLockPath, releaseLock } from "./lock.ts";
import { onShutdown } from "./process-registry.ts";
import { OutputManager } from "./output.ts";
import type { RunSummary } from "./output.ts";
import {
  collectPostWorkflowNodes,
  executePostWorkflow,
  sortPostWorkflowNodes,
} from "./post-workflow.ts";
import {
  buildTaskPaths,
  createRunState,
  generateRunId,
  getNodeDir,
  getRunDir,
  getStatePath,
  isNodeCompleted,
  loadState,
  markNodeCompleted,
  markNodeFailed,
  markNodeSkipped,
  markNodeStarted,
  markRunCompleted,
  markRunFailed,
  saveState,
  setPhaseRegistry,
  workPath,
} from "./state.ts";
import { interpolate } from "./template.ts";
import type { EngineContext } from "./node-dispatch.ts";
import {
  executeAgentNode,
  executeHumanNode,
  executeLoopNode,
  executeMergeNode,
} from "./node-dispatch.ts";
import {
  copyToOriginalRepo,
  createWorktree,
  pinDetachedHead,
  removeWorktree,
  resolveExistingWorktreePath,
} from "./worktree.ts";

/** Main workflow engine. Orchestrates node execution across DAG levels. */
export class Engine {
  private config!: WorkflowConfig;
  private state!: RunState;
  private output: OutputManager;
  private options: EngineOptions;
  private userInput: UserInput;
  private startTime = 0;
  /** Working directory: worktree path or "." when worktree disabled. */
  private workDir = ".";
  /** Workflow folder = directory containing `workflow.yaml` (FR-S47).
   * Derived from `options.config_path` once at construction. Threaded into
   * every state-path call so runs land under `<workflowDir>/runs/<run-id>`
   * regardless of layout. */
  private workflowDir: string;

  /** Create an engine instance with the given options and optional user-input provider. */
  constructor(options: EngineOptions, userInput: UserInput = terminalInput) {
    this.options = options;
    this.output = new OutputManager(options.verbosity);
    this.userInput = userInput;
    this.workflowDir = deriveWorkflowDir(options.config_path);
  }

  /** Run the workflow. Main entry point. */
  async run(): Promise<RunState> {
    this.startTime = Date.now();

    // Phase 1: Minimal YAML pre-parse — extract worktree_disabled
    const rawYaml = await Deno.readTextFile(this.options.config_path);
    const worktreeDisabled = extractWorktreeDisabled(rawYaml);

    // Dry-run: load config from CWD (no worktree needed), print plan, exit
    if (this.options.dry_run) {
      this.config = await loadConfig(this.options.config_path);
      const levels = buildLevels(this.config);
      const labels: Record<string, string> = {};
      for (const [id, node] of Object.entries(this.config.nodes)) {
        labels[id] = node.label;
      }
      const rawPostWorkflowIds = collectPostWorkflowNodes(this.config.nodes);
      const postWorkflowNodeIds = sortPostWorkflowNodes(
        rawPostWorkflowIds,
        this.config.nodes,
      );
      const filteredLevels = levels
        .map((level) => level.filter((id) => !postWorkflowNodeIds.includes(id)))
        .filter((level) => level.length > 0);
      const runOnMap: Record<string, string> = {};
      for (const id of postWorkflowNodeIds) {
        const node = this.config.nodes[id];
        if (node.run_on) runOnMap[id] = node.run_on;
      }
      this.output.dryRunPlan(
        filteredLevels,
        labels,
        postWorkflowNodeIds,
        runOnMap,
      );
      return this.createDryRunState(levels);
    }

    // Phase 2: Set up workDir (worktree or CWD)
    // Generate runId once — shared between worktree path and run state
    const runLabel = this.options.args.prompt?.slice(0, 20) ?? undefined;
    const runId = this.options.run_id ?? generateRunId(runLabel);

    // FR-E57: a workflow.yaml passed without a directory prefix collapses
    // workflowDir to "." and would put the worktree at repo-root
    // ./runs/<id>/worktree, not covered by .gitignore. The mandatory
    // positional <workflow> argument introduced by FR-S47/FR-E53 makes
    // this combination obsolete in normal use; refuse it explicitly.
    if (!worktreeDisabled && this.workflowDir === ".") {
      throw new Error(
        "worktree mode requires workflow.yaml to live inside a workflow folder " +
          "(FR-S47/FR-E53); pass `<workflow>` positional argument or set " +
          "worktree_disabled: true",
      );
    }

    if (this.options.resume && this.options.run_id) {
      // Resume: reuse existing worktree if it exists. Honours the FR-E57
      // legacy-resume fallback so an in-flight run on the old layout
      // survives a binary upgrade.
      const existing = !worktreeDisabled
        ? resolveExistingWorktreePath(this.options.run_id, this.workflowDir)
        : undefined;
      if (existing) {
        this.workDir = existing.path;
        if (existing.legacy) {
          this.output.warn(
            `legacy worktree layout at ${existing.path}; new runs use ` +
              `${this.workflowDir}/runs/<id>/worktree (FR-E57)`,
          );
        }
        this.output.status("engine", `RESUME worktree: ${this.workDir}`);
      } else {
        this.workDir = ".";
      }
    } else if (!worktreeDisabled) {
      // New run: create worktree
      this.output.status("engine", "Creating worktree...");
      this.workDir = await createWorktree(runId, this.workflowDir);
      this.output.status("engine", `Worktree: ${this.workDir}`);
    } else {
      this.workDir = ".";
    }

    // Phase 3: Load config from workDir
    const configPath = this.workDir === "."
      ? this.options.config_path
      : `${this.workDir}/${this.options.config_path}`;
    this.config = await loadConfig(
      configPath,
      this.workDir === "." ? undefined : this.workDir,
    );
    // Merge env overrides
    const env = { ...this.config.env, ...this.options.env_overrides };

    // Build execution levels
    const levels = buildLevels(this.config);

    // Initialize or resume state
    if (this.options.resume && this.options.run_id) {
      this.state = await loadState(
        this.options.run_id,
        this.workDir,
        this.workflowDir,
      );
      this.state.status = "running";
    } else {
      const allNodeIds = collectAllNodeIds(this.config);
      this.state = createRunState(
        runId,
        this.options.config_path,
        allNodeIds,
        this.options.args,
        env,
      );
    }

    // Acquire per-workflow lock (FR-E54) — serializes runs against the same
    // workflow folder; distinct workflow folders run in parallel.
    const lockPath = this.options.lock_path ??
      defaultLockPath(this.workflowDir);
    await acquireLock(lockPath, this.state.run_id);

    // Register shutdown callbacks for signal-initiated cleanup;
    // disposers remove them after normal completion to prevent leak in loops
    const disposers = [
      onShutdown(() => releaseLock(lockPath)),
      onShutdown(async () => {
        if (this.state.status === "running") {
          markRunFailed(this.state);
          await saveState(this.state, this.workDir, this.workflowDir);
        }
      }),
    ];

    try {
      return await this.runWithLock(levels, lockPath);
    } finally {
      for (const dispose of disposers) dispose();
      await releaseLock(lockPath);
    }
  }

  /** Execute the workflow after lock is acquired. */
  private async runWithLock(
    levels: string[][],
    _lockPath: string,
  ): Promise<RunState> {
    // Initialize phase registry before creating any node dirs (FR-E9)
    setPhaseRegistry(this.config);

    // Create run directory structure
    await this.ensureRunDirs(levels);
    await saveState(this.state, this.workDir, this.workflowDir);

    // FR-E47: pre-execution budget check (applies to fresh and resumed runs)
    this.checkWorkflowBudget("resume");
    // FR-E47: one-time warnings before the level loop
    this.warnBudgetCaveats();

    // Run prepare_command before level loop (skip on resume)
    const prepareCmd = this.config.defaults?.prepare_command ?? "";
    const cwd = this.workDir !== "." ? this.workDir : undefined;
    if (!this.options.resume && prepareCmd) {
      await runPrepareCommand(
        prepareCmd,
        getRunDir(this.state.run_id, this.workflowDir),
        this.state.run_id,
        this.state.env,
        this.state.args,
        this.output,
        cwd,
        this.workflowDir,
      );
    }

    // Identify post-workflow nodes (run_on set) — execute after all DAG levels
    // Sort topologically so dependencies within post-workflow subset are respected
    const rawPostWorkflowIds = collectPostWorkflowNodes(this.config.nodes);
    const postWorkflowNodeIds = sortPostWorkflowNodes(
      rawPostWorkflowIds,
      this.config.nodes,
    );

    // Filter post-workflow nodes out of regular DAG levels
    const filteredLevels = levels
      .map((level) => level.filter((id) => !postWorkflowNodeIds.includes(id)))
      .filter((level) => level.length > 0);

    // Ensure post-workflow node dirs exist
    for (const nodeId of postWorkflowNodeIds) {
      await Deno.mkdir(
        workPath(
          this.workDir,
          getNodeDir(this.state.run_id, nodeId, this.workflowDir),
        ),
        { recursive: true },
      );
    }

    // Execute regular levels
    let workflowSuccess = true;
    try {
      for (const level of filteredLevels) {
        const success = await this.executeLevel(level);
        if (!success) {
          workflowSuccess = false;
          break;
        }
      }
    } catch (err) {
      workflowSuccess = false;
      this.output.error((err as Error).message);
    }

    // Execute post-workflow nodes (filtered by run_on condition)
    await executePostWorkflow({
      nodeIds: postWorkflowNodeIds,
      nodes: this.config.nodes,
      state: this.state,
      workflowSuccess,
      failureScript: this.config.defaults?.on_failure_script,
      output: this.output,
      executeNode: (nodeId) => this.executeNode(nodeId),
      cwd,
      workDir: this.workDir,
      workflowDir: this.workflowDir,
    });

    // Finalize run state
    if (workflowSuccess) {
      markRunCompleted(this.state);
    } else {
      markRunFailed(this.state);
    }
    await saveState(this.state, this.workDir, this.workflowDir);

    // Worktree cleanup: copy state to original repo on success, then remove
    if (this.workDir !== ".") {
      const statePath = getStatePath(this.state.run_id, this.workflowDir);
      try {
        await copyToOriginalRepo(this.workDir, statePath);
      } catch (err) {
        this.output.warn(
          `Failed to copy state to original repo: ${(err as Error).message}`,
        );
      }
      if (workflowSuccess) {
        // FR-E51: pin detached HEAD as rescue branch BEFORE removal so any
        // commits made during the run survive worktree teardown.
        try {
          const rescue = await pinDetachedHead(
            this.workDir,
            this.state.run_id,
          );
          if (rescue !== undefined) {
            this.output.status(
              "engine",
              `Detached HEAD pinned: branch=${rescue} worktree=${this.workDir}`,
            );
          }
        } catch (err) {
          this.output.warn(
            `Failed to pin detached HEAD: ${(err as Error).message}`,
          );
        }
        try {
          await removeWorktree(this.workDir);
          this.output.status("engine", "Worktree removed (success)");
        } catch (err) {
          this.output.warn(
            `Failed to remove worktree: ${(err as Error).message}`,
          );
        }
      } else {
        this.output.status(
          "engine",
          `Worktree preserved for resume: ${this.workDir}`,
        );
      }
    }

    this.printSummary();
    return this.state;
  }

  /** Execute a single level (set of independent nodes). */
  private async executeLevel(nodeIds: string[]): Promise<boolean> {
    // Filter out completed nodes (for resume)
    const toRun = nodeIds.filter(
      (id) => !isNodeCompleted(this.state, id),
    );

    // Filter skip/only nodes
    const filtered = toRun.filter((id) => {
      if (this.options.skip_nodes?.includes(id)) {
        markNodeSkipped(this.state, id);
        this.output.nodeSkipped(id, "skipped by --skip");
        return false;
      }
      if (
        this.options.only_nodes &&
        this.options.only_nodes.length > 0 &&
        !this.options.only_nodes.includes(id)
      ) {
        markNodeSkipped(this.state, id);
        this.output.nodeSkipped(id, "not in --only");
        return false;
      }
      return true;
    });

    if (filtered.length === 0) return true;

    // Respect max_parallel
    const maxParallel = this.config.defaults?.max_parallel ?? 0;
    if (maxParallel > 0 && filtered.length > maxParallel) {
      // Execute in chunks
      for (let i = 0; i < filtered.length; i += maxParallel) {
        const chunk = filtered.slice(i, i + maxParallel);
        const results = await Promise.allSettled(
          chunk.map((id) => this.executeNode(id)),
        );
        for (const r of results) {
          if (
            r.status === "rejected" || (r.status === "fulfilled" && !r.value)
          ) {
            return false;
          }
        }
        // FR-E47: check after each chunk to short-circuit mid-level
        this.checkWorkflowBudget("runtime");
      }
      return true;
    }

    // Execute all in parallel
    const results = await Promise.allSettled(
      filtered.map((id) => this.executeNode(id)),
    );

    for (const r of results) {
      if (r.status === "rejected" || (r.status === "fulfilled" && !r.value)) {
        return false;
      }
    }
    // FR-E47: workflow-wide budget check after each level completes
    this.checkWorkflowBudget("runtime");
    return true;
  }

  /** Execute a single node based on its type. Returns true on success. */
  private async executeNode(nodeId: string): Promise<boolean> {
    const node = this.config.nodes[nodeId];
    // Capture waiting state before markNodeStarted overwrites status
    const wasWaiting = this.state.nodes[nodeId]?.status === "waiting";
    markNodeStarted(this.state, nodeId);
    await saveState(this.state, this.workDir, this.workflowDir);

    const extra = node.type === "loop"
      ? `loop, max ${node.max_iterations ?? 3} iterations`
      : node.inputs && node.inputs.length > 1
      ? "parallel"
      : undefined;
    this.output.nodeStarted(nodeId, extra);

    try {
      let success: boolean;
      let lastAgentResult: AgentResult | null = null;

      const eng: EngineContext = {
        config: this.config,
        state: this.state,
        output: this.output,
        options: this.options,
        userInput: this.userInput,
        buildContext: (nId, loopIteration?) =>
          this.buildContext(nId, loopIteration),
        saveState: () => saveState(this.state, this.workDir, this.workflowDir),
        workDir: this.workDir,
        workflowDir: this.workflowDir,
      };

      switch (node.type) {
        case "agent": {
          lastAgentResult = await executeAgentNode(
            eng,
            nodeId,
            node,
            wasWaiting,
          );
          success = lastAgentResult?.success === true;
          break;
        }
        case "merge":
          success = await executeMergeNode(eng, nodeId, node);
          break;
        case "loop":
          success = await executeLoopNode(eng, nodeId, node);
          break;
        case "human":
          success = await executeHumanNode(eng, nodeId, node);
          break;
        default:
          throw new Error(`Unknown node type: ${(node as NodeConfig).type}`);
      }

      if (success) {
        markNodeCompleted(
          this.state,
          nodeId,
          lastAgentResult?.output?.total_cost_usd,
          lastAgentResult?.output
            ? (lastAgentResult.output.result ?? "")
              .split("\n")
              .filter((l) => l.trim())
              .slice(0, 3)
              .join(" | ")
              .slice(0, 400)
            : undefined,
        );

        // FR-E47: per-node budget check. Demote to failed if cost cap exceeded.
        // Only applies to top-level nodes; loop body nodes are checked inside runLoop.
        const resolvedBudget = resolveBudget(node, this.config.defaults);
        const nodeCost = this.state.nodes[nodeId].cost_usd ?? 0;
        if (
          resolvedBudget?.max_usd !== undefined &&
          nodeCost > resolvedBudget.max_usd
        ) {
          const msg = `Node budget exceeded: $${nodeCost.toFixed(4)} > $${
            resolvedBudget.max_usd.toFixed(4)
          }`;
          markNodeFailed(this.state, nodeId, msg, "aborted");
          this.output.nodeFailed(nodeId, msg);
          if (lastAgentResult?.output) {
            this.output.nodeResult(nodeId, lastAgentResult.output);
          }
          const onError = node.settings?.on_error ?? "fail";
          await saveState(this.state, this.workDir, this.workflowDir);
          return onError === "continue";
        }

        const duration = this.state.nodes[nodeId].duration_ms ?? 0;
        this.output.nodeCompleted(nodeId, duration);
        if (lastAgentResult?.output) {
          this.output.nodeResult(nodeId, lastAgentResult.output);
        }
      } else {
        const error = this.state.nodes[nodeId].error ?? "Unknown error";
        this.output.nodeFailed(nodeId, error);
        if (lastAgentResult?.output) {
          this.output.nodeResult(nodeId, lastAgentResult.output);
        }

        // Check on_error policy
        const onError = node.settings?.on_error ?? "fail";
        if (onError === "continue") {
          this.output.status(
            "engine",
            `node ${nodeId}: failure suppressed by on_error: continue`,
          );
          return true;
        }
      }

      await saveState(this.state, this.workDir, this.workflowDir);
      return success;
    } catch (err) {
      markNodeFailed(this.state, nodeId, (err as Error).message, "unknown");
      await saveState(this.state, this.workDir, this.workflowDir);
      this.output.nodeFailed(nodeId, (err as Error).message);
      return false;
    }
  }

  /** Build template context for a node (searches top-level and loop body nodes). */
  private buildContext(
    nodeId: string,
    loopIteration?: number,
  ): TemplateContext {
    const node = findNodeConfig(this.config, nodeId);
    if (!node) {
      throw new Error(`Node '${nodeId}' not found in workflow config`);
    }

    // Path fields are workDir-relative — see TemplateContext JSDoc.
    // Engine internal FS callers wrap them with workPath(ctx.workDir, …).
    const paths = buildTaskPaths(
      this.state.run_id,
      nodeId,
      node.inputs ?? [],
      this.workflowDir,
    );

    // Merge node-level env with global env (node overrides global)
    const env = node.env ? { ...this.state.env, ...node.env } : this.state.env;

    return {
      ...paths,
      run_id: this.state.run_id,
      workDir: this.workDir,
      workflow_dir: this.workflowDir,
      args: this.state.args,
      env,
      loop: loopIteration !== undefined
        ? { iteration: loopIteration }
        : undefined,
    };
  }

  /** Ensure all node directories exist. */
  private async ensureRunDirs(levels: string[][]): Promise<void> {
    const runDir = workPath(
      this.workDir,
      getRunDir(this.state.run_id, this.workflowDir),
    );
    await Deno.mkdir(`${runDir}/logs`, { recursive: true });

    for (const level of levels) {
      for (const nodeId of level) {
        await Deno.mkdir(
          workPath(
            this.workDir,
            getNodeDir(this.state.run_id, nodeId, this.workflowDir),
          ),
          { recursive: true },
        );
      }
    }

    // Also create dirs for loop body nodes (from inline nodes sub-object)
    for (const [_, node] of Object.entries(this.config.nodes)) {
      if (node.type === "loop" && node.nodes) {
        for (const bodyId of Object.keys(node.nodes)) {
          await Deno.mkdir(
            workPath(
              this.workDir,
              getNodeDir(this.state.run_id, bodyId, this.workflowDir),
            ),
            { recursive: true },
          );
        }
      }
    }
  }

  /**
   * FR-E47 workflow-wide budget enforcement.
   * Throws when `state.total_cost_usd` strictly exceeds `options.budget_usd`.
   * No-op when `budget_usd` is unset.
   * @param phase — "resume" produces a resume-specific error message; "runtime"
   * uses the generic runtime-abort message.
   */
  private checkWorkflowBudget(phase: "resume" | "runtime"): void {
    const cap = this.options.budget_usd;
    if (cap === undefined) return;
    const total = this.state.total_cost_usd ?? 0;
    if (total > cap) {
      const prefix = phase === "resume"
        ? "Budget exceeded on resume: "
        : "Budget exceeded: ";
      throw new Error(`${prefix}$${total.toFixed(4)} > $${cap.toFixed(4)}`);
    }
  }

  /**
   * FR-E47 pre-run warnings. Emits at most two one-line warnings:
   * (1) `budget.max_turns` set on a node whose resolved runtime is not Claude
   *     — the flag is Claude CLI-only and other runtimes may reject it.
   * (2) `--budget` set while the default runtime does not report `cost_usd`
   *     — the workflow-wide cap will no-op because `total_cost_usd` stays 0.
   */
  private warnBudgetCaveats(): void {
    const defaults = this.config.defaults;

    // (1) max_turns on non-Claude runtime
    const nonClaudeWithMaxTurns = new Set<string>();
    const walk = (
      nodes: Record<string, NodeConfig>,
      parent?: NodeConfig,
    ): void => {
      for (const [id, node] of Object.entries(nodes)) {
        const resolvedBudget = resolveBudget(node, defaults, parent);
        if (resolvedBudget?.max_turns !== undefined) {
          const rc = resolveRuntimeConfig({ defaults, node, parent });
          if (rc.runtime !== "claude") {
            nonClaudeWithMaxTurns.add(`${id}:${rc.runtime}`);
          }
        }
        if (node.type === "loop" && node.nodes) {
          walk(node.nodes, node);
        }
      }
    };
    walk(this.config.nodes);
    for (const entry of nonClaudeWithMaxTurns) {
      const [nodeId, runtime] = entry.split(":");
      this.output.warn(
        `budget.max_turns ignored: runtime=${runtime} (node '${nodeId}')`,
      );
    }

    // (2) --budget with non-cost-reporting runtime (heuristic: non-claude default)
    if (this.options.budget_usd !== undefined) {
      const runtime = defaults?.runtime ?? "claude";
      if (runtime !== "claude") {
        this.output.warn(
          `--budget set but default runtime '${runtime}' may not report cost_usd — budget checks may no-op`,
        );
      }
    }
  }

  /** Create a dry-run state (no actual execution). */
  private createDryRunState(levels: string[][]): RunState {
    const allIds = levels.flat();
    return createRunState(
      "dry-run",
      this.options.config_path,
      allIds,
      this.options.args,
      {},
    );
  }

  /** Print final summary. */
  private printSummary(): void {
    const nodes = Object.values(this.state.nodes);
    const nodeResults: Record<string, string> = {};
    for (const [id, node] of Object.entries(this.state.nodes)) {
      if (node.result) {
        nodeResults[id] = node.result;
      }
    }
    const summary: RunSummary = {
      name: this.config.name,
      runId: this.state.run_id,
      status: this.state.status,
      durationMs: Date.now() - this.startTime,
      total: nodes.length,
      completed: nodes.filter((n) => n.status === "completed").length,
      failed: nodes.filter((n) => n.status === "failed").length,
      skipped: nodes.filter((n) => n.status === "skipped").length,
      nodeResults: Object.keys(nodeResults).length > 0
        ? nodeResults
        : undefined,
    };
    this.output.summary(summary);
  }
}

/**
 * Execute prepare_command once before the node level loop on fresh runs.
 * Supports template interpolation for run_dir, run_id, env.*, args.*.
 * node_dir and input.* resolve to empty string (not meaningful at workflow scope).
 * Throws on non-zero exit — caller saves state and workflow aborts (FR-E30).
 * Call site guards with !options.resume so this is skipped on resumed runs.
 */
export async function runPrepareCommand(
  cmd: string,
  runDir: string,
  runId: string,
  env: Record<string, string>,
  args: Record<string, string>,
  output: OutputManager,
  cwd?: string,
  workflowDir?: string,
): Promise<void> {
  const ctx: TemplateContext = {
    node_dir: "",
    run_dir: runDir,
    run_id: runId,
    workDir: cwd ?? ".",
    workflow_dir: workflowDir ?? "",
    args,
    env,
    input: {},
  };
  const interpolated = interpolate(cmd, ctx);
  output.status("engine", `PREPARE_COMMAND: ${interpolated}`);
  const proc = new Deno.Command("sh", {
    args: ["-c", interpolated],
    stdout: "piped",
    stderr: "piped",
    ...(cwd ? { cwd } : {}),
  });
  const result = await proc.output();
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (stdout) output.status("engine", stdout);
  if (!result.success) {
    const msg = `prepare_command failed: ${interpolated}${
      stderr ? `\n${stderr}` : ""
    }`;
    output.error(msg);
    throw new Error(msg);
  }
}

/** Derive workflow folder (the directory containing `workflow.yaml`) from a
 * config-file path. Pure helper; FR-S47 + FR-E9. Returns "." for bare
 * `workflow.yaml` so back-compat callers still operate cwd-relative. */
export function deriveWorkflowDir(configPath: string): string {
  const idx = Math.max(
    configPath.lastIndexOf("/"),
    configPath.lastIndexOf("\\"),
  );
  if (idx < 0) return ".";
  const dir = configPath.slice(0, idx);
  return dir.length > 0 ? dir : ".";
}
