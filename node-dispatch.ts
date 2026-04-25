/**
 * @module
 * Node executor functions for the engine.
 * Encapsulates all node-type-specific execution logic, keeping engine.ts as a
 * pure orchestrator (config loading, state management, level iteration).
 */
import type { AgentResult } from "./agent.ts";
import { resolveInputArtifacts, runAgent } from "./agent.ts";
import { resolveBudget, resolveToolFilter } from "./config.ts";
import { handleAgentHitl } from "./hitl-handler.ts";
import { detectHitlRequest, isHitlConfigured } from "./hitl.ts";
import { runHuman } from "./human.ts";
import type { UserInput } from "./human.ts";
import { saveAgentLog } from "./log.ts";
import { runLoop } from "./loop.ts";
import type { OutputManager } from "./output.ts";
import { resolveRuntimeConfig } from "@korchasa/ai-ide-cli/runtime";
import {
  getNodeDir,
  getRunDir,
  markNodeFailed,
  markRunAborted,
  workPath,
} from "./state.ts";
import type {
  EngineOptions,
  NodeConfig,
  NodeSettings,
  RunState,
  TemplateContext,
  WorkflowConfig,
} from "./types.ts";

/** Parameter bag passed to every node executor function. */
export interface EngineContext {
  config: WorkflowConfig;
  state: RunState;
  output: OutputManager;
  options: EngineOptions;
  userInput: UserInput;
  /** Build template context for a given node (with optional loop iteration). */
  buildContext: (nodeId: string, loopIteration?: number) => TemplateContext;
  /** Persist current run state to disk. */
  saveState: () => Promise<void>;
  /** Working directory (worktree path or "."). All subprocesses and I/O use this. */
  workDir: string;
}

/** Run an agent node: invoke Claude CLI, handle HITL if triggered, save logs. */
export async function executeAgentNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
  wasWaiting = false,
): Promise<AgentResult | null> {
  const ctx = eng.buildContext(nodeId);
  const settings = node.settings as Required<NodeSettings>;
  const hitlConfig = isHitlConfigured(eng.config.defaults?.hitl)
    ? eng.config.defaults.hitl
    : undefined;
  const runtimeConfig = resolveRuntimeConfig({
    defaults: eng.config.defaults,
    node,
  });
  const toolFilter = resolveToolFilter(node, eng.config.defaults);
  const cwd = eng.workDir !== "." ? eng.workDir : undefined;

  // Resume path: node was waiting for human reply
  if (wasWaiting) {
    if (!hitlConfig) {
      markNodeFailed(
        eng.state,
        nodeId,
        "HITL detected but defaults.hitl not configured in workflow.yaml",
        "unknown",
      );
      return null;
    }
    return await handleAgentHitl({
      mode: "resume",
      nodeId,
      hitlConfig,
      state: eng.state,
      saveState: eng.saveState,
      node,
      ctx,
      settings,
      runtime: runtimeConfig.runtime,
      runtimeArgs: runtimeConfig.args,
      permissionMode: runtimeConfig.permissionMode,
      model: runtimeConfig.model,
      allowedTools: toolFilter.allowedTools,
      disallowedTools: toolFilter.disallowedTools,
      output: eng.output,
      cwd,
      maxTurns: resolveBudget(node, eng.config.defaults)?.max_turns,
    });
  }

  // Normal path: run agent
  // Verbose: resolve and show input artifacts
  const inputArtifacts = await resolveInputArtifacts(ctx.input);
  eng.output.verboseInputs(nodeId, inputArtifacts);

  const streamLogPath = `${workPath(ctx.workDir, ctx.node_dir)}/stream.log`;

  const result = await runAgent({
    node,
    ctx,
    settings,
    runtime: runtimeConfig.runtime,
    runtimeArgs: runtimeConfig.args,
    permissionMode: runtimeConfig.permissionMode,
    model: runtimeConfig.model,
    allowedTools: toolFilter.allowedTools,
    disallowedTools: toolFilter.disallowedTools,
    hitlConfig,
    output: eng.output,
    nodeId,
    streamLogPath,
    verbosity: eng.options.verbosity,
    cwd,
    maxTurns: resolveBudget(node, eng.config.defaults)?.max_turns,
  });

  if (!result.success) {
    markNodeFailed(
      eng.state,
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
          eng.state,
          nodeId,
          "Agent requested HITL (AskUserQuestion) but defaults.hitl not configured in workflow.yaml",
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
        state: eng.state,
        saveState: eng.saveState,
        node,
        ctx,
        settings,
        runtime: runtimeConfig.runtime,
        runtimeArgs: runtimeConfig.args,
        permissionMode: runtimeConfig.permissionMode,
        model: runtimeConfig.model,
        allowedTools: toolFilter.allowedTools,
        disallowedTools: toolFilter.disallowedTools,
        output: eng.output,
        cwd,
        maxTurns: resolveBudget(node, eng.config.defaults)?.max_turns,
      });
    }
  }

  if (result.session_id) {
    eng.state.nodes[nodeId].session_id = result.session_id;
  }
  eng.state.nodes[nodeId].continuations = result.continuations;

  // Save agent log (JSON output + JSONL transcript)
  if (result.output) {
    const runDir = workPath(eng.workDir, getRunDir(eng.state.run_id));
    await saveAgentLog(runDir, nodeId, result.output);
  }

  return result;
}

/** Merge inputs by copying each input directory into the merge node's output dir. */
export async function executeMergeNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const nodeDir = workPath(eng.workDir, getNodeDir(eng.state.run_id, nodeId));
  await Deno.mkdir(nodeDir, { recursive: true });

  // Copy input directories as subdirectories
  for (const inputId of node.inputs ?? []) {
    const inputDir = workPath(
      eng.workDir,
      getNodeDir(eng.state.run_id, inputId),
    );
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
export async function executeLoopNode(
  eng: EngineContext,
  nodeId: string,
  _node: NodeConfig,
): Promise<boolean> {
  const result = await runLoop({
    loopNodeId: nodeId,
    config: eng.config,
    state: eng.state,
    budgetUsd: eng.options.budget_usd,
    buildCtx: (bodyNodeId, iteration) =>
      eng.buildContext(bodyNodeId, iteration),
    onNodeStart: (id, iteration) =>
      eng.output.status(id, `STARTED (iteration ${iteration})`),
    onNodeComplete: (id, iteration, result) => {
      if (result.success) {
        eng.output.status(id, "COMPLETED");
        if (result.output) {
          eng.output.nodeResult(id, result.output);
          if (id in eng.state.nodes) {
            eng.state.nodes[id].result = (result.output.result ?? "")
              .split("\n")
              .filter((l) => l.trim())
              .slice(0, 3)
              .join(" | ")
              .slice(0, 400);
          }
        }
      } else {
        eng.output.nodeFailed(id, result.error ?? "Failed");
      }

      // Save agent log for successful loop body nodes (iteration-qualified)
      if (result.success && result.output) {
        const runDir = workPath(eng.workDir, getRunDir(eng.state.run_id));
        const iterNodeId = `${id}-iter-${iteration}`;
        saveAgentLog(runDir, iterNodeId, result.output).catch((err) => {
          eng.output.warn(
            `Failed to save log for ${iterNodeId}: ${(err as Error).message}`,
          );
        });
      }
    },
    onIteration: (iteration, maxIterations) =>
      eng.output.loopIteration(nodeId, iteration, maxIterations),
    output: eng.output,
    verbosity: eng.options.verbosity,
    saveState: eng.saveState,
    cwd: eng.workDir !== "." ? eng.workDir : undefined,
  });

  if (!result.success) {
    markNodeFailed(
      eng.state,
      nodeId,
      result.error ?? "Loop failed",
      result.error_category ?? "unknown",
    );
  }
  eng.state.nodes[nodeId].iteration = result.iterations;

  return result.success;
}

/** Prompt the user for input and abort the run if response matches abort_on. */
export async function executeHumanNode(
  eng: EngineContext,
  nodeId: string,
  node: NodeConfig,
): Promise<boolean> {
  const ctx = eng.buildContext(nodeId);
  const result = await runHuman(node, ctx, eng.userInput);

  if (result.aborted) {
    markRunAborted(eng.state);
    markNodeFailed(
      eng.state,
      nodeId,
      `Aborted by user (response: ${result.response})`,
      "aborted",
    );
    return false;
  }

  return result.success;
}

/** Recursively copy a directory. */
export async function copyDir(src: string, dest: string): Promise<void> {
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
