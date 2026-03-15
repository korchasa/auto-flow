import type {
  EngineOptions,
  NodeConfig,
  NodeSettings,
  PipelineConfig,
  RunState,
  TemplateContext,
} from "./types.ts";
import type { AgentResult } from "./agent.ts";
import { resolveInputArtifacts, runAgent } from "./agent.ts";
import {
  collectAllNodeIds,
  extractPreRun,
  findNodeConfig,
  loadConfig,
} from "./config.ts";
import { buildLevels } from "./dag.ts";
import { handleAgentHitl } from "./hitl-handler.ts";
import { detectHitlRequest } from "./hitl.ts";
import { runHuman, terminalInput } from "./human.ts";
import type { UserInput } from "./human.ts";
import { acquireLock, defaultLockPath, releaseLock } from "./lock.ts";
import { saveAgentLog } from "./log.ts";
import { runLoop } from "./loop.ts";
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
  markRunAborted,
  markRunCompleted,
  markRunFailed,
  saveState,
  setPhaseRegistry,
} from "./state.ts";

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

    try {
      return await this.runWithLock(levels, lockPath);
    } finally {
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

      switch (node.type) {
        case "agent": {
          lastAgentResult = await this.executeAgentNode(
            nodeId,
            node,
            wasWaiting,
          );
          success = lastAgentResult?.success === true;
          break;
        }
        case "merge":
          success = await this.executeMergeNode(nodeId, node);
          break;
        case "loop":
          success = await this.executeLoopNode(nodeId, node);
          break;
        case "human":
          success = await this.executeHumanNode(nodeId, node);
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

  /** Run an agent node: invoke Claude CLI, handle HITL if triggered, save logs. */
  private async executeAgentNode(
    nodeId: string,
    node: NodeConfig,
    wasWaiting = false,
  ): Promise<AgentResult | null> {
    const ctx = this.buildContext(nodeId);
    const settings = node.settings as Required<NodeSettings>;
    const hitlConfig = this.config.defaults?.hitl;
    const effectiveModel = node.model ?? this.config.defaults?.model;

    // Resume path: node was waiting for human reply
    if (wasWaiting) {
      if (!hitlConfig) {
        markNodeFailed(
          this.state,
          nodeId,
          "HITL detected but defaults.hitl not configured in pipeline.yaml",
          "unknown",
        );
        return null;
      }
      return await handleAgentHitl({
        mode: "resume",
        nodeId,
        hitlConfig,
        state: this.state,
        saveState: () => saveState(this.state),
        node,
        ctx,
        settings,
        claudeArgs: this.config.defaults?.claude_args,
        model: effectiveModel,
        output: this.output,
      });
    }

    // Normal path: run agent
    // Verbose: resolve and show input artifacts
    const inputArtifacts = await resolveInputArtifacts(ctx.input);
    this.output.verboseInputs(nodeId, inputArtifacts);

    const streamLogPath = `${ctx.node_dir}/stream.log`;

    const result = await runAgent({
      node,
      ctx,
      settings,
      claudeArgs: this.config.defaults?.claude_args,
      model: effectiveModel,
      output: this.output,
      nodeId,
      streamLogPath,
      verbosity: this.options.verbosity,
    });

    if (!result.success) {
      markNodeFailed(
        this.state,
        nodeId,
        result.error ?? "Agent failed",
        result.error_category ?? "unknown",
      );
      return result;
    }

    // Check for HITL request in permission_denials
    if (result.output) {
      const hitlQuestion = detectHitlRequest(result.output);
      if (hitlQuestion) {
        if (!hitlConfig) {
          markNodeFailed(
            this.state,
            nodeId,
            "Agent requested HITL (AskUserQuestion) but defaults.hitl not configured in pipeline.yaml",
            "unknown",
          );
          return null;
        }
        return await handleAgentHitl({
          mode: "detect",
          nodeId,
          hitlQuestion,
          agentSessionId: result.output.session_id,
          hitlConfig,
          state: this.state,
          saveState: () => saveState(this.state),
          node,
          ctx,
          settings,
          claudeArgs: this.config.defaults?.claude_args,
          model: effectiveModel,
          output: this.output,
        });
      }
    }

    if (result.session_id) {
      this.state.nodes[nodeId].session_id = result.session_id;
    }
    this.state.nodes[nodeId].continuations = result.continuations;

    // Save agent log (JSON output + JSONL transcript)
    if (result.output) {
      const runDir = getRunDir(this.state.run_id);
      await saveAgentLog(runDir, nodeId, result.output);
    }

    return result;
  }

  /** Merge inputs by copying each input directory into the merge node's output dir. */
  private async executeMergeNode(
    nodeId: string,
    node: NodeConfig,
  ): Promise<boolean> {
    const nodeDir = getNodeDir(this.state.run_id, nodeId);
    await Deno.mkdir(nodeDir, { recursive: true });

    // Copy input directories as subdirectories
    for (const inputId of node.inputs ?? []) {
      const inputDir = getNodeDir(this.state.run_id, inputId);
      const targetDir = `${nodeDir}/${inputId}`;
      try {
        await copyDir(inputDir, targetDir);
      } catch {
        // Input may not have produced files
      }
    }

    return true;
  }

  /** Delegate to runLoop(), then record iteration count and failure state. */
  private async executeLoopNode(
    nodeId: string,
    _node: NodeConfig,
  ): Promise<boolean> {
    const result = await runLoop({
      loopNodeId: nodeId,
      config: this.config,
      state: this.state,
      buildCtx: (bodyNodeId, iteration) =>
        this.buildContext(bodyNodeId, iteration),
      onNodeStart: (id, iteration) =>
        this.output.status(id, `STARTED (iteration ${iteration})`),
      onNodeComplete: (id, iteration, result) => {
        if (result.success) {
          this.output.status(id, "COMPLETED");
          if (result.output) {
            this.output.nodeResult(id, result.output);
            if (id in this.state.nodes) {
              this.state.nodes[id].result = extractResultExcerpt(
                result.output.result,
              );
            }
          }
        } else {
          this.output.nodeFailed(id, result.error ?? "Failed");
        }

        // Save agent log for successful loop body nodes (iteration-qualified)
        if (result.success && result.output) {
          const runDir = getRunDir(this.state.run_id);
          const iterNodeId = `${id}-iter-${iteration}`;
          saveAgentLog(runDir, iterNodeId, result.output).catch((err) => {
            this.output.warn(
              `Failed to save log for ${iterNodeId}: ${(err as Error).message}`,
            );
          });
        }
      },
      onIteration: (iteration, maxIterations) =>
        this.output.loopIteration(nodeId, iteration, maxIterations),
      output: this.output,
      verbosity: this.options.verbosity,
      saveState: () => saveState(this.state),
    });

    if (!result.success) {
      markNodeFailed(
        this.state,
        nodeId,
        result.error ?? "Loop failed",
        result.error_category ?? "unknown",
      );
    }
    this.state.nodes[nodeId].iteration = result.iterations;

    return result.success;
  }

  /** Prompt the user for input and abort the run if response matches abort_on. */
  private async executeHumanNode(
    nodeId: string,
    node: NodeConfig,
  ): Promise<boolean> {
    const ctx = this.buildContext(nodeId);
    const result = await runHuman(node, ctx, this.userInput);

    if (result.aborted) {
      markRunAborted(this.state);
      markNodeFailed(
        this.state,
        nodeId,
        `Aborted by user (response: ${result.response})`,
        "aborted",
      );
      return false;
    }

    return result.success;
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

/** Recursively copy a directory. */
async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}
