import type {
  EngineOptions,
  NodeConfig,
  NodeSettings,
  PipelineConfig,
  RunState,
  TemplateContext,
} from "./types.ts";
import { loadConfig } from "./config.ts";
import { buildLevels } from "./dag.ts";
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
  markNodeWaiting,
  markRunAborted,
  markRunCompleted,
  markRunFailed,
  saveState,
} from "./state.ts";
import { runAgent } from "./agent.ts";
import { saveAgentLog } from "./log.ts";
import { detectHitlRequest, runHitlLoop } from "./hitl.ts";
import { runLoop } from "./loop.ts";
import { runHuman, terminalInput } from "./human.ts";
import type { UserInput } from "./human.ts";
import { OutputManager } from "./output.ts";
import type { RunSummary, VerboseInput } from "./output.ts";

/** Main pipeline engine. Orchestrates node execution across DAG levels. */
export class Engine {
  private config!: PipelineConfig;
  private state!: RunState;
  private output: OutputManager;
  private options: EngineOptions;
  private userInput: UserInput;
  private startTime = 0;

  constructor(options: EngineOptions, userInput: UserInput = terminalInput) {
    this.options = options;
    this.output = new OutputManager(options.verbosity);
    this.userInput = userInput;
  }

  /** Run the pipeline. Main entry point. */
  async run(): Promise<RunState> {
    this.startTime = Date.now();

    // Load config
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
      this.output.dryRunPlan(levels, labels);
      return this.createDryRunState(levels);
    }

    // Initialize or resume state
    if (this.options.resume && this.options.run_id) {
      this.state = await loadState(this.options.run_id);
      this.state.status = "running";
    } else {
      const runLabel = this.options.args.prompt?.slice(0, 20) ?? undefined;
      const runId = this.options.run_id ?? generateRunId(runLabel);
      const allNodeIds = Object.keys(this.config.nodes);
      this.state = createRunState(
        runId,
        this.options.config_path,
        allNodeIds,
        this.options.args,
        env,
      );
    }

    // Create run directory structure
    await this.ensureRunDirs(levels);
    await saveState(this.state);

    // Identify run_always nodes (e.g., Meta-Agent) — execute after all levels
    const runAlwaysNodeIds = collectRunAlwaysNodes(this.config.nodes);

    // Filter run_always nodes out of regular DAG levels
    const filteredLevels = levels
      .map((level) => level.filter((id) => !runAlwaysNodeIds.includes(id)))
      .filter((level) => level.length > 0);

    // Ensure run_always node dirs exist
    for (const nodeId of runAlwaysNodeIds) {
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

    // Execute run_always nodes (post-levels step, regardless of pipeline outcome)
    if (runAlwaysNodeIds.length > 0) {
      for (const nodeId of runAlwaysNodeIds) {
        if (isNodeCompleted(this.state, nodeId)) continue;
        try {
          await this.executeNode(nodeId);
        } catch (err) {
          this.output.warn(
            `run_always node ${nodeId} failed: ${(err as Error).message}`,
          );
        }
      }
    }

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

      switch (node.type) {
        case "agent":
          success = await this.executeAgentNode(nodeId, node, wasWaiting);
          break;
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
        markNodeCompleted(this.state, nodeId);
        const duration = this.state.nodes[nodeId].duration_ms ?? 0;
        this.output.nodeCompleted(nodeId, duration);
      } else {
        const error = this.state.nodes[nodeId].error ?? "Unknown error";
        this.output.nodeFailed(nodeId, error);

        // Check on_error policy
        const onError = node.settings?.on_error ?? "fail";
        if (onError === "continue") return true;
      }

      await saveState(this.state);
      return success;
    } catch (err) {
      markNodeFailed(this.state, nodeId, (err as Error).message);
      await saveState(this.state);
      this.output.nodeFailed(nodeId, (err as Error).message);
      return false;
    }
  }

  private async executeAgentNode(
    nodeId: string,
    node: NodeConfig,
    wasWaiting = false,
  ): Promise<boolean> {
    const ctx = this.buildContext(nodeId);
    const settings = node.settings as Required<NodeSettings>;
    const hitlConfig = this.config.defaults?.hitl;

    // Resume path: node was waiting for human reply
    if (wasWaiting) {
      const nodeState = this.state.nodes[nodeId];
      if (!nodeState.session_id || !nodeState.question_json) {
        markNodeFailed(
          this.state,
          nodeId,
          "Waiting node missing session_id or question_json",
        );
        return false;
      }
      if (!hitlConfig) {
        markNodeFailed(
          this.state,
          nodeId,
          "HITL detected but defaults.hitl not configured in pipeline.yaml",
        );
        return false;
      }

      const question = JSON.parse(nodeState.question_json);
      const hitlResult = await runHitlLoop({
        config: hitlConfig,
        nodeId,
        runId: this.state.run_id,
        runDir: getRunDir(this.state.run_id),
        env: this.state.env,
        sessionId: nodeState.session_id,
        question,
        node,
        ctx,
        settings,
        claudeArgs: this.config.defaults?.claude_args,
        output: this.output,
      }, true /* skipAsk — question already delivered */);

      if (!hitlResult.success) {
        markNodeFailed(
          this.state,
          nodeId,
          hitlResult.error ?? "HITL resume failed",
        );
        return false;
      }

      if (hitlResult.session_id) {
        this.state.nodes[nodeId].session_id = hitlResult.session_id;
      }
      if (hitlResult.output) {
        const runDir = getRunDir(this.state.run_id);
        await saveAgentLog(runDir, nodeId, hitlResult.output);
      }
      return true;
    }

    // Normal path: run agent
    // Verbose: resolve and show input artifacts
    const inputArtifacts = await resolveInputArtifacts(ctx.input);
    this.output.verboseInputs(nodeId, inputArtifacts);

    const result = await runAgent({
      node,
      ctx,
      settings,
      claudeArgs: this.config.defaults?.claude_args,
      output: this.output,
      nodeId,
    });

    if (!result.success) {
      markNodeFailed(this.state, nodeId, result.error ?? "Agent failed");
      return false;
    }

    // Check for HITL request in permission_denials
    if (result.output) {
      const hitlQuestion = detectHitlRequest(result.output);
      if (hitlQuestion) {
        // Fail fast if hitl config absent
        if (!hitlConfig) {
          markNodeFailed(
            this.state,
            nodeId,
            "Agent requested HITL (AskUserQuestion) but defaults.hitl not configured in pipeline.yaml",
          );
          return false;
        }

        const sessionId = result.output.session_id;
        const questionJson = JSON.stringify(hitlQuestion);

        // Mark node as waiting and persist
        markNodeWaiting(this.state, nodeId, sessionId, questionJson);
        await saveState(this.state);

        // Enter HITL poll loop
        const hitlResult = await runHitlLoop({
          config: hitlConfig,
          nodeId,
          runId: this.state.run_id,
          runDir: getRunDir(this.state.run_id),
          env: this.state.env,
          sessionId,
          question: hitlQuestion,
          node,
          ctx,
          settings,
          claudeArgs: this.config.defaults?.claude_args,
          output: this.output,
        }, false /* skipAsk=false — deliver question */);

        if (!hitlResult.success) {
          markNodeFailed(
            this.state,
            nodeId,
            hitlResult.error ?? "HITL failed",
          );
          return false;
        }

        if (hitlResult.session_id) {
          this.state.nodes[nodeId].session_id = hitlResult.session_id;
        }
        if (hitlResult.output) {
          const runDir = getRunDir(this.state.run_id);
          await saveAgentLog(runDir, nodeId, hitlResult.output);
        }
        return true;
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

    return true;
  }

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
      saveState: () => saveState(this.state),
    });

    if (!result.success) {
      markNodeFailed(this.state, nodeId, result.error ?? "Loop failed");
    }
    this.state.nodes[nodeId].iteration = result.iterations;

    return result.success;
  }

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
      );
      return false;
    }

    return result.success;
  }

  /** Build template context for a node. */
  private buildContext(
    nodeId: string,
    loopIteration?: number,
  ): TemplateContext {
    const node = this.config.nodes[nodeId];
    const input: Record<string, string> = {};

    // Map input node IDs to their output directories
    for (const inputId of node.inputs ?? []) {
      input[inputId] = getNodeDir(this.state.run_id, inputId);
    }

    return {
      node_dir: getNodeDir(this.state.run_id, nodeId),
      run_dir: getRunDir(this.state.run_id),
      run_id: this.state.run_id,
      args: this.state.args,
      env: this.state.env,
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

    // Also create dirs for loop body nodes
    for (const [_, node] of Object.entries(this.config.nodes)) {
      if (node.type === "loop" && node.body) {
        for (const bodyId of node.body) {
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
    const summary: RunSummary = {
      name: this.config.name,
      runId: this.state.run_id,
      status: this.state.status,
      durationMs: Date.now() - this.startTime,
      total: nodes.length,
      completed: nodes.filter((n) => n.status === "completed").length,
      failed: nodes.filter((n) => n.status === "failed").length,
      skipped: nodes.filter((n) => n.status === "skipped").length,
    };
    this.output.summary(summary);
  }
}

/**
 * Resolve input artifact file paths and sizes from input directories.
 * Walks each input directory (non-recursive), collects file path + size.
 */
export async function resolveInputArtifacts(
  inputs: Record<string, string>,
): Promise<VerboseInput[]> {
  const result: VerboseInput[] = [];
  for (const [_nodeId, dir] of Object.entries(inputs)) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile) continue;
        const filePath = `${dir}/${entry.name}`;
        try {
          const stat = await Deno.stat(filePath);
          result.push({ path: filePath, sizeBytes: stat.size });
        } catch {
          // File may have been removed between readDir and stat
        }
      }
    } catch {
      // Directory may not exist
    }
  }
  return result;
}

/**
 * Collect node IDs with `run_always: true` from pipeline config.
 * These nodes execute in a final post-levels step, regardless of pipeline outcome.
 */
export function collectRunAlwaysNodes(
  nodes: Record<string, NodeConfig>,
): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => node.run_always === true)
    .map(([id]) => id);
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
