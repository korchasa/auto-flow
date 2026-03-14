import type {
  HitlConfig,
  NodeConfig,
  NodeSettings,
  RunState,
  TemplateContext,
} from "./types.ts";
import type { AgentResult } from "./agent.ts";
import type { HitlQuestion } from "./hitl.ts";
import { runHitlLoop } from "./hitl.ts";
import { getRunDir, markNodeFailed, markNodeWaiting } from "./state.ts";
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
  claudeArgs?: string[];
  model?: string;
  output: OutputManager;
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
    claudeArgs,
    model,
    output,
  } = params;
  const runDir = getRunDir(state.run_id);

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
        claudeArgs,
        model,
        output,
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
      claudeArgs,
      model,
      output,
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
