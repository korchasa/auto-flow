import type {
  EngineOptions,
  NodeConfig,
  PipelineConfig,
  RunState,
  TemplateContext,
} from "./types.ts";
import type { AgentResult } from "./agent.ts";
import {
  collectAllNodeIds,
  extractPreRun,
  findNodeConfig,
  loadConfig,
} from "./config.ts";
import { buildLevels } from "./dag.ts";
import { terminalInput } from "./human.ts";
import type { UserInput } from "./human.ts";
import { acquireLock, defaultLockPath, releaseLock } from "./lock.ts";
import { onShutdown } from "./process-registry.ts";
import { extractResultExcerpt, OutputManager } from "./output.ts";
import type { RunSummary } from "./output.ts";
import {
  collectPostPipelineNodes,
  executePostPipeline,
  sortPostPipelineNodes,
} from "./post-pipeline.ts";
import {
  createRunState,
  generateRunId,
  getNodeDir,
  getRunDir,
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
} from "./state.ts";
import type { EngineContext } from "./node-dispatch.ts";
import {
  executeAgentNode,
  executeHumanNode,
  executeLoopNode,
  executeMergeNode,
} from "./node-dispatch.ts";

/** Main pipeline engine. Orchestrates node execution across DAG levels. */
export class Engine {
  private config!: PipelineConfig;
  private state!: RunState;
  private output: OutputManager;
  private options: EngineOptions;
  private userInput: UserInput;
  private startTime = 0;

  /** Create an engine instance with the given options and optional user-input provider. */
  constructor(options: EngineOptions, userInput: UserInput = terminalInput) {
    this.options = options;
    this.output = new OutputManager(options.verbosity);
    this.userInput = userInput;
  }

  /** Run the pipeline. Main entry point. */
  async run(): Promise<RunState> {
    this.startTime = Date.now();

    // Two-phase config loading:
    // 1. Read raw YAML, extract pre_run script path
    // 2. If pre_run exists, execute it (e.g. reset to stable branch)
    // 3. Re-read and fully parse config (now from potentially updated files)
    const rawYaml = await Deno.readTextFile(this.options.config_path);
    const preRun = extractPreRun(rawYaml);
    if (preRun) {
      await runPreRunScript(preRun, this.output);
    }

    // Load config (re-reads file after pre_run may have changed it)
    this.config = await loadConfig(this.options.config_path);

    // Merge env overrides
    const env = { ...this.config.env, ...this.options.env_overrides };

    // Build execution levels
    const levels = buildLevels(this.config);

    // Handle dry-run
    if (this.options.dry_run) {
      const labels: Record<string, string> = {};
      for (const [id, node] of Object.entries(this.config.nodes)) {
        labels[id] = node.label;
      }
      const rawPostPipelineIds = collectPostPipelineNodes(this.config.nodes);
      const postPipelineNodeIds = sortPostPipelineNodes(
        rawPostPipelineIds,
        this.config.nodes,
      );
      const filteredLevels = levels
        .map((level) => level.filter((id) => !postPipelineNodeIds.includes(id)))
        .filter((level) => level.length > 0);
      const runOnMap: Record<string, string> = {};
      for (const id of postPipelineNodeIds) {
        const node = this.config.nodes[id];
        if (node.run_on) runOnMap[id] = node.run_on;
      }
      this.output.dryRunPlan(
        filteredLevels,
        labels,
        postPipelineNodeIds,
        runOnMap,
      );
      return this.createDryRunState(levels);
    }

    // Initialize or resume state
    if (this.options.resume && this.options.run_id) {
      this.state = await loadState(this.options.run_id);
      this.state.status = "running";
    } else {
      const runLabel = this.options.args.prompt?.slice(0, 20) ?? undefined;
      const runId = this.options.run_id ?? generateRunId(runLabel);
      const allNodeIds = collectAllNodeIds(this.config);
      this.state = createRunState(
        runId,
        this.options.config_path,
        allNodeIds,
        this.options.args,
        env,
      );
    }

    // Acquire pipeline lock (prevents parallel runs)
    const lockPath = this.options.lock_path ?? defaultLockPath();
    await acquireLock(lockPath, this.state.run_id);

    // Register shutdown callbacks for signal-initiated cleanup;
    // disposers remove them after normal completion to prevent leak in loops
    const disposers = [
      onShutdown(() => releaseLock(lockPath)),
      onShutdown(async () => {
        if (this.state.status === "running") {
          markRunFailed(this.state);
          await saveState(this.state);
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

  /** Execute the pipeline after lock is acquired. */
  private async runWithLock(
    levels: string[][],
    _lockPath: string,
  ): Promise<RunState> {
    // Initialize phase registry before creating any node dirs (FR-E9)
    setPhaseRegistry(this.config);

    // Create run directory structure
    await this.ensureRunDirs(levels);
    await saveState(this.state);

    // Identify post-pipeline nodes (run_on set) — execute after all DAG levels
    // Sort topologically so dependencies within post-pipeline subset are respected
    const rawPostPipelineIds = collectPostPipelineNodes(this.config.nodes);
    const postPipelineNodeIds = sortPostPipelineNodes(
      rawPostPipelineIds,
      this.config.nodes,
    );

    // Filter post-pipeline nodes out of regular DAG levels
    const filteredLevels = levels
      .map((level) => level.filter((id) => !postPipelineNodeIds.includes(id)))
      .filter((level) => level.length > 0);

    // Ensure post-pipeline node dirs exist
    for (const nodeId of postPipelineNodeIds) {
      await Deno.mkdir(getNodeDir(this.state.run_id, nodeId), {
        recursive: true,
      });
    }

    // Execute regular levels
    let pipelineSuccess = true;
    try {
      for (const level of filteredLevels) {
        const success = await this.executeLevel(level);
        if (!success) {
          pipelineSuccess = false;
          break;
        }
      }
    } catch (err) {
      pipelineSuccess = false;
      this.output.error((err as Error).message);
    }

    // Execute post-pipeline nodes (filtered by run_on condition)
    await executePostPipeline({
      nodeIds: postPipelineNodeIds,
      nodes: this.config.nodes,
      state: this.state,
      pipelineSuccess,
      failureScript: this.config.defaults?.on_failure_script,
      output: this.output,
      executeNode: (nodeId) => this.executeNode(nodeId),
    });

    // Finalize run state
    if (pipelineSuccess) {
      markRunCompleted(this.state);
    } else {
      markRunFailed(this.state);
    }
    await saveState(this.state);
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
    return true;
  }

  /** Execute a single node based on its type. Returns true on success. */
  private async executeNode(nodeId: string): Promise<boolean> {
    const node = this.config.nodes[nodeId];
    // Capture waiting state before markNodeStarted overwrites status
    const wasWaiting = this.state.nodes[nodeId]?.status === "waiting";
    markNodeStarted(this.state, nodeId);
    await saveState(this.state);

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
        saveState: () => saveState(this.state),
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
            ? extractResultExcerpt(lastAgentResult.output.result)
            : undefined,
        );
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
        if (onError === "continue") return true;
      }

      await saveState(this.state);
      return success;
    } catch (err) {
      markNodeFailed(this.state, nodeId, (err as Error).message, "unknown");
      await saveState(this.state);
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
      throw new Error(`Node '${nodeId}' not found in pipeline config`);
    }
    const input: Record<string, string> = {};

    // Map input node IDs to their output directories
    for (const inputId of node.inputs ?? []) {
      input[inputId] = getNodeDir(this.state.run_id, inputId);
    }

    // Merge node-level env with global env (node overrides global)
    const env = node.env ? { ...this.state.env, ...node.env } : this.state.env;

    return {
      node_dir: getNodeDir(this.state.run_id, nodeId),
      run_dir: getRunDir(this.state.run_id),
      run_id: this.state.run_id,
      args: this.state.args,
      env,
      input,
      loop: loopIteration !== undefined
        ? { iteration: loopIteration }
        : undefined,
    };
  }

  /** Ensure all node directories exist. */
  private async ensureRunDirs(levels: string[][]): Promise<void> {
    const runDir = getRunDir(this.state.run_id);
    await Deno.mkdir(`${runDir}/logs`, { recursive: true });

    for (const level of levels) {
      for (const nodeId of level) {
        await Deno.mkdir(getNodeDir(this.state.run_id, nodeId), {
          recursive: true,
        });
      }
    }

    // Also create dirs for loop body nodes (from inline nodes sub-object)
    for (const [_, node] of Object.entries(this.config.nodes)) {
      if (node.type === "loop" && node.nodes) {
        for (const bodyId of Object.keys(node.nodes)) {
          await Deno.mkdir(getNodeDir(this.state.run_id, bodyId), {
            recursive: true,
          });
        }
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
 * Execute the pre_run shell script before full config loading.
 * Enables self-healing workflows (e.g. reset to stable branch).
 * Throws on script failure — pipeline cannot start from unstable state.
 */
export async function runPreRunScript(
  scriptPath: string,
  output: OutputManager,
): Promise<void> {
  output.status("engine", `PRE_RUN: ${scriptPath}`);
  const cmd = new Deno.Command("sh", {
    args: ["-c", scriptPath],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (stdout) output.status("engine", stdout);
  if (!result.success) {
    const msg = `pre_run script failed: ${scriptPath}${
      stderr ? `\n${stderr}` : ""
    }`;
    output.error(msg);
    throw new Error(msg);
  }
}
