/**
 * @module
 * Unified HITL orchestration handler for agent nodes.
 * Consolidates two paths: resume-from-waiting (node was persisted as "waiting")
 * and detect-after-run (HITL question found in agent output).
 * Delegates to {@link runHitlLoop} for the actual poll cycle.
 */

import type {
  HitlConfig,
  NodeConfig,
  NodeSettings,
  ProcessRegistry,
  ReasoningEffort,
  RunState,
  RuntimeId,
  TemplateContext,
} from "./types.ts";
import type {
  ExtraArgsMap,
  RuntimeAdapter,
} from "@korchasa/ai-ide-cli/runtime/types";
import type { AgentResult } from "./agent.ts";
import type { HitlQuestion } from "./hitl.ts";
import { runHitlLoop } from "./hitl.ts";
import { markNodeFailed, markNodeWaiting, workPath } from "./state.ts";
import { saveAgentLog } from "./log.ts";
import type { OutputManager } from "./output.ts";

/** Shared parameters for both HITL handler modes. */
interface HitlBaseParams {
  nodeId: string;
  hitlConfig: HitlConfig;
  state: RunState;
  saveState: () => Promise<void>;
  node: NodeConfig;
  ctx: TemplateContext;
  settings: Required<NodeSettings>;
  runtime?: RuntimeId;
  runtimeArgs?: ExtraArgsMap;
  permissionMode?: string;
  model?: string;
  /** Resolved reasoning-effort dial (FR-E42); forwarded to runtime on resume. */
  reasoningEffort?: ReasoningEffort;
  runtimeAdapter?: RuntimeAdapter;
  output: OutputManager;
  /** Working directory for subprocesses (worktree path or undefined for CWD). */
  cwd?: string;
  /** Resolved `budget.max_turns` (FR-E47). */
  maxTurns?: number;
  /** Resolved tool whitelist (FR-E48). */
  allowedTools?: string[];
  /** Resolved tool blacklist (FR-E48). */
  disallowedTools?: string[];
  /** Caller-supplied process tracker scope
   * (FR-E60). Forwarded to the runtime adapter
   * on the resume invocation that delivers the human reply. */
  processRegistry?: ProcessRegistry;
}

/** Resume-from-waiting mode: node was previously set to waiting state. */
export interface HitlResumeParams extends HitlBaseParams {
  mode: "resume";
}

/** Detect-after-run mode: HITL question detected in agent output. */
export interface HitlDetectParams extends HitlBaseParams {
  mode: "detect";
  hitlQuestion: HitlQuestion;
  agentSessionId: string;
}

/**
 * Discriminated union over the two HITL entry points.
 * Use `mode: "resume"` ({@link HitlResumeParams}) when the node was
 * persisted as `waiting` and the engine is rehydrating it from state.
 * Use `mode: "detect"` ({@link HitlDetectParams}) when a HITL question
 * was just detected in fresh agent output and additional fields
 * (`hitlQuestion`, `agentSessionId`) are required.
 */
export type HitlHandlerParams = HitlResumeParams | HitlDetectParams;

/**
 * Unified HITL orchestration handler for agent nodes.
 * Consolidates resume-from-waiting and detect-after-run paths.
 * Mutates state in place (markNodeFailed, markNodeWaiting, session_id update).
 * Returns AgentResult on success, null on failure (state already marked failed).
 */
export async function handleAgentHitl(
  params: HitlHandlerParams,
): Promise<AgentResult | null> {
  const {
    nodeId,
    hitlConfig,
    state,
    saveState,
    node,
    ctx,
    settings,
    runtime,
    runtimeArgs,
    permissionMode,
    model,
    reasoningEffort,
    runtimeAdapter,
    output,
    cwd,
    maxTurns,
    allowedTools,
    disallowedTools,
    processRegistry,
  } = params;
  // ctx.run_dir is workDir-relative (see TemplateContext); reconstruct
  // the cwd-correct path for FS access.
  const runDir = workPath(ctx.workDir, ctx.run_dir);

  if (params.mode === "resume") {
    const nodeState = state.nodes[nodeId];
    if (!nodeState.session_id || !nodeState.question_json) {
      markNodeFailed(
        state,
        nodeId,
        "Waiting node missing session_id or question_json",
        "unknown",
      );
      return null;
    }

    const question = JSON.parse(nodeState.question_json);
    const hitlResult = await runHitlLoop(
      {
        config: hitlConfig,
        nodeId,
        runId: state.run_id,
        runDir,
        env: state.env,
        sessionId: nodeState.session_id,
        question,
        node,
        ctx,
        settings,
        runtime,
        runtimeArgs,
        permissionMode,
        model,
        reasoningEffort,
        runtimeAdapter,
        output,
        cwd,
        maxTurns,
        allowedTools,
        disallowedTools,
        processRegistry,
      },
      true, /* skipAsk — question already delivered */
    );

    if (!hitlResult.success) {
      markNodeFailed(
        state,
        nodeId,
        hitlResult.error ?? "HITL resume failed",
        hitlResult.error_category ?? "unknown",
      );
      return null;
    }

    if (hitlResult.session_id) {
      state.nodes[nodeId].session_id = hitlResult.session_id;
    }
    if (hitlResult.output) {
      await saveAgentLog(runDir, nodeId, hitlResult.output);
    }
    return hitlResult;
  }

  // mode === "detect": question detected in agent output
  const { hitlQuestion, agentSessionId } = params;
  const questionJson = JSON.stringify(hitlQuestion);

  markNodeWaiting(state, nodeId, agentSessionId, questionJson);
  await saveState();

  const hitlResult = await runHitlLoop(
    {
      config: hitlConfig,
      nodeId,
      runId: state.run_id,
      runDir,
      env: state.env,
      sessionId: agentSessionId,
      question: hitlQuestion,
      node,
      ctx,
      settings,
      runtime,
      runtimeArgs,
      permissionMode,
      model,
      reasoningEffort,
      runtimeAdapter,
      output,
      cwd,
      maxTurns,
      allowedTools,
      disallowedTools,
      processRegistry,
    },
    false, /* skipAsk=false — deliver question */
  );

  if (!hitlResult.success) {
    markNodeFailed(
      state,
      nodeId,
      hitlResult.error ?? "HITL failed",
      hitlResult.error_category ?? "unknown",
    );
    return null;
  }

  if (hitlResult.session_id) {
    state.nodes[nodeId].session_id = hitlResult.session_id;
  }
  if (hitlResult.output) {
    await saveAgentLog(runDir, nodeId, hitlResult.output);
  }
  return hitlResult;
}
