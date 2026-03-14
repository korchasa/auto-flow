import type {
  NodeConfig,
  NodeSettings,
  PipelineConfig,
  RunState,
  TemplateContext,
  Verbosity,
} from "./types.ts";
import type { AgentResult } from "./agent.ts";
import { runAgent } from "./agent.ts";
import {
  getNodeDir,
  getRunDir,
  markNodeFailed,
  markNodeWaiting,
  markRunAborted,
} from "./state.ts";
import { topoSort } from "./dag.ts";
import { runHuman } from "./human.ts";
import type { UserInput } from "./human.ts";
import { detectHitlRequest, runHitlLoop } from "./hitl.ts";
import { saveAgentLog } from "./log.ts";
import { runLoop } from "./loop.ts";
import type { OutputManager } from "./output.ts";
import type { VerboseInput } from "./output.ts";

/** Shared execution context passed to extracted node executor free functions. */
export interface NodeExecutionContext {
  state: RunState;
  config: PipelineConfig;
  output: OutputManager;
  verbosity: Verbosity;
  buildContext: (nodeId: string, loopIteration?: number) => TemplateContext;
  saveState: () => Promise<void>;
  userInput: UserInput;
}

/** Execute an agent node. Handles normal run, HITL, and resume-from-waiting paths. */
export async function executeAgentNode(
  execCtx: NodeExecutionContext,
  nodeId: string,
  node: NodeConfig,
  wasWaiting = false,
): Promise<AgentResult | null> {
  const ctx = execCtx.buildContext(nodeId);
  const settings = node.settings as Required<NodeSettings>;
  const hitlConfig = execCtx.config.defaults?.hitl;
  const effectiveModel = node.model ?? execCtx.config.defaults?.model;

  // Resume path: node was waiting for human reply
  if (wasWaiting) {
    const nodeState = execCtx.state.nodes[nodeId];
    if (!nodeState.session_id || !nodeState.question_json) {
      markNodeFailed(
        execCtx.state,
        nodeId,
        "Waiting node missing session_id or question_json",
        "unknown",
      );
      return null;
    }
    if (!hitlConfig) {
      markNodeFailed(
        execCtx.state,
        nodeId,
        "HITL detected but defaults.hitl not configured in pipeline.yaml",
        "unknown",
      );
      return null;
    }

    const question = JSON.parse(nodeState.question_json);
    const hitlResult = await runHitlLoop({
      config: hitlConfig,
      nodeId,
      runId: execCtx.state.run_id,
      runDir: getRunDir(execCtx.state.run_id),
      env: execCtx.state.env,
      sessionId: nodeState.session_id,
      question,
      node,
      ctx,
      settings,
      claudeArgs: execCtx.config.defaults?.claude_args,
      model: effectiveModel,
      output: execCtx.output,
    }, true /* skipAsk — question already delivered */);

    if (!hitlResult.success) {
      markNodeFailed(
        execCtx.state,
        nodeId,
        hitlResult.error ?? "HITL resume failed",
        hitlResult.error_category ?? "unknown",
      );
      return null;
    }

    if (hitlResult.session_id) {
      execCtx.state.nodes[nodeId].session_id = hitlResult.session_id;
    }
    if (hitlResult.output) {
      const runDir = getRunDir(execCtx.state.run_id);
      await saveAgentLog(runDir, nodeId, hitlResult.output);
    }
    return hitlResult;
  }

  // Normal path: run agent
  // Verbose: resolve and show input artifacts
  const inputArtifacts = await resolveInputArtifacts(ctx.input);
  execCtx.output.verboseInputs(nodeId, inputArtifacts);

  const streamLogPath = `${ctx.node_dir}/stream.log`;

  const result = await runAgent({
    node,
    ctx,
    settings,
    claudeArgs: execCtx.config.defaults?.claude_args,
    model: effectiveModel,
    output: execCtx.output,
    nodeId,
    streamLogPath,
    verbosity: execCtx.verbosity,
  });

  if (!result.success) {
    markNodeFailed(
      execCtx.state,
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
      // Fail fast if hitl config absent
      if (!hitlConfig) {
        markNodeFailed(
          execCtx.state,
          nodeId,
          "Agent requested HITL (AskUserQuestion) but defaults.hitl not configured in pipeline.yaml",
          "unknown",
        );
        return null;
      }

      const sessionId = result.output.session_id;
      const questionJson = JSON.stringify(hitlQuestion);

      // Mark node as waiting and persist
      markNodeWaiting(execCtx.state, nodeId, sessionId, questionJson);
      await execCtx.saveState();

      // Enter HITL poll loop
      const hitlResult = await runHitlLoop({
        config: hitlConfig,
        nodeId,
        runId: execCtx.state.run_id,
        runDir: getRunDir(execCtx.state.run_id),
        env: execCtx.state.env,
        sessionId,
        question: hitlQuestion,
        node,
        ctx,
        settings,
        claudeArgs: execCtx.config.defaults?.claude_args,
        model: effectiveModel,
        output: execCtx.output,
      }, false /* skipAsk=false — deliver question */);

      if (!hitlResult.success) {
        markNodeFailed(
          execCtx.state,
          nodeId,
          hitlResult.error ?? "HITL failed",
          hitlResult.error_category ?? "unknown",
        );
        return null;
      }

      if (hitlResult.session_id) {
        execCtx.state.nodes[nodeId].session_id = hitlResult.session_id;
      }
      if (hitlResult.output) {
        const runDir = getRunDir(execCtx.state.run_id);
        await saveAgentLog(runDir, nodeId, hitlResult.output);
      }
      return hitlResult;
    }
  }

  if (result.session_id) {
    execCtx.state.nodes[nodeId].session_id = result.session_id;
  }
  execCtx.state.nodes[nodeId].continuations = result.continuations;

  // Save agent log (JSON output + JSONL transcript)
  if (result.output) {
    const runDir = getRunDir(execCtx.state.run_id);
    await saveAgentLog(runDir, nodeId, result.output);
  }

  return result;
}

/** Execute a loop node. Delegates to runLoop() with callbacks wired to execCtx. */
export async function executeLoopNode(
  execCtx: NodeExecutionContext,
  nodeId: string,
): Promise<boolean> {
  const loopResult = await runLoop({
    loopNodeId: nodeId,
    config: execCtx.config,
    state: execCtx.state,
    buildCtx: (bodyNodeId, iteration) =>
      execCtx.buildContext(bodyNodeId, iteration),
    onNodeStart: (id, iteration) =>
      execCtx.output.status(id, `STARTED (iteration ${iteration})`),
    onNodeComplete: (id, iteration, result) => {
      if (result.success) {
        execCtx.output.status(id, "COMPLETED");
        if (result.output) {
          execCtx.output.nodeResult(id, result.output);
        }
      } else {
        execCtx.output.nodeFailed(id, result.error ?? "Failed");
      }

      // Save agent log for successful loop body nodes (iteration-qualified)
      if (result.success && result.output) {
        const runDir = getRunDir(execCtx.state.run_id);
        const iterNodeId = `${id}-iter-${iteration}`;
        saveAgentLog(runDir, iterNodeId, result.output).catch((err) => {
          execCtx.output.warn(
            `Failed to save log for ${iterNodeId}: ${(err as Error).message}`,
          );
        });
      }
    },
    onIteration: (iteration, maxIterations) =>
      execCtx.output.loopIteration(nodeId, iteration, maxIterations),
    output: execCtx.output,
    verbosity: execCtx.verbosity,
    saveState: execCtx.saveState,
  });

  if (!loopResult.success) {
    markNodeFailed(
      execCtx.state,
      nodeId,
      loopResult.error ?? "Loop failed",
      loopResult.error_category ?? "unknown",
    );
  }
  execCtx.state.nodes[nodeId].iteration = loopResult.iterations;

  return loopResult.success;
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

/** Execute a merge node: copies each input directory as a subdirectory. */
export async function executeMergeNode(
  execCtx: NodeExecutionContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const nodeDir = getNodeDir(execCtx.state.run_id, nodeId);
  await Deno.mkdir(nodeDir, { recursive: true });

  for (const inputId of node.inputs ?? []) {
    const inputDir = getNodeDir(execCtx.state.run_id, inputId);
    const targetDir = `${nodeDir}/${inputId}`;
    try {
      await copyDir(inputDir, targetDir);
    } catch {
      // Input may not have produced files
    }
  }

  return true;
}

/** Execute a human node: prompts for user input via userInput interface. */
export async function executeHumanNode(
  execCtx: NodeExecutionContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const ctx = execCtx.buildContext(nodeId);
  const result = await runHuman(node, ctx, execCtx.userInput);

  if (result.aborted) {
    markRunAborted(execCtx.state);
    markNodeFailed(
      execCtx.state,
      nodeId,
      `Aborted by user (response: ${result.response})`,
      "aborted",
    );
    return false;
  }

  return result.success;
}

/**
 * Collect node IDs with `run_on` set from pipeline config.
 * These nodes execute in a final post-pipeline step after all DAG levels complete.
 */
export function collectPostPipelineNodes(
  nodes: Record<string, NodeConfig>,
): string[] {
  return Object.entries(nodes)
    .filter(([_, node]) => node.run_on !== undefined)
    .map(([id]) => id);
}

/**
 * Sort post-pipeline nodes topologically using their `inputs` field.
 * Only considers dependencies within the post-pipeline subset.
 * Guarantees e.g. post-B (inputs: [post-A]) runs after post-A.
 */
export function sortPostPipelineNodes(
  postPipelineIds: string[],
  nodes: Record<string, NodeConfig>,
): string[] {
  const subset = new Set(postPipelineIds);
  const deps = new Map<string, Set<string>>();
  for (const id of postPipelineIds) {
    const node = nodes[id];
    const internalInputs = (node.inputs ?? []).filter((inp) => subset.has(inp));
    deps.set(id, new Set(internalInputs));
  }
  const levels = topoSort(deps);
  return levels.flat();
}

/**
 * Find a NodeConfig by ID, searching both top-level nodes and loop body nodes.
 * Returns undefined if not found.
 */
export function findNodeConfig(
  config: PipelineConfig,
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
export function collectAllNodeIds(config: PipelineConfig): string[] {
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

/**
 * Execute the on_failure_script hook (domain-agnostic).
 * Swallows errors — failure hook must not crash the engine.
 */
export async function runFailureHook(
  script: string | undefined,
  output: OutputManager,
): Promise<void> {
  if (!script) return;
  try {
    const cmd = new Deno.Command(script, {
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();
    if (stdout) output.status("engine", `Hook stdout: ${stdout}`);
    if (stderr) output.warn(`Hook stderr: ${stderr}`);
    if (!result.success) {
      output.warn(`Failure hook exited with code ${result.code}`);
    } else {
      output.status("engine", "Failure hook completed");
    }
  } catch (err) {
    output.warn(`Failure hook error: ${(err as Error).message}`);
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
