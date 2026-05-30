/**
 * @module
 * Unified run-control command layer (FR-E75).
 *
 * Single home for operations that must behave identically whether they are
 * triggered from the host IDE (MCP tools) or the terminal (CLI subcommands).
 * MCP (`mcp-server.ts`) and CLI (`cli.ts`) are THIN interfaces over these
 * functions — they parse/serialise, this module owns the logic. Keeps the
 * two surfaces from drifting and gives the behaviour one place to test.
 *
 * Exports:
 *   - {@link deliverHumanAnswer} — write a HITL reply into the run's local
 *     inbox file (transport-independent; the live poll loop reads it).
 *   - {@link resumeRun} — the sole `Engine({resume:true})` construction site.
 */

import { dirname, join } from "@std/path";

import type { Verbosity } from "./types.ts";
import { Engine } from "./engine.ts";
import { isRunLive } from "./lock.ts";
import { replayRunJournal } from "./run-journal.ts";
import { getHitlInboxPath, getRunDir } from "./state.ts";

/** Resolve a workflow folder to its `workflow.yaml` config path. */
function configPathOf(workflowDir: string): string {
  return join(workflowDir, "workflow.yaml");
}

/** Parameters for {@link deliverHumanAnswer}. */
export interface DeliverHumanAnswerParams {
  /** Workflow folder containing `workflow.yaml` and `runs/`. */
  workflowDir: string;
  /** Target run id (the waiting run). */
  runId: string;
  /** Target node id — ALWAYS explicit; no single-waiting-node auto-pick. */
  nodeId: string;
  /** Reply text delivered to the agent verbatim. */
  text: string;
}

/** Result of {@link deliverHumanAnswer}. */
export interface DeliverHumanAnswerResult {
  /** Absolute-or-relative path of the inbox file that was written. */
  inboxPath: string;
  /** True when an engine process holding the run lock is alive (it will
   * pick the file up on its next poll). False means the caller must resume
   * the run separately. */
  live: boolean;
}

/**
 * Deliver a HITL reply to a waiting run through the local inbox channel
 * (FR-E75). Write-only and non-blocking: it validates the target node is
 * `waiting`, writes the reply atomically to
 * `<runDir>/.hitl-inbox/<nodeId>.txt`, and reports engine liveness. It
 * NEVER resumes the engine — when `live === false`, the caller resumes
 * separately via {@link resumeRun}.
 *
 * Fail-fast (no silent fallbacks): empty text, an unknown node, or a node
 * that is not currently `waiting` all throw with a clear message and write
 * nothing.
 */
export async function deliverHumanAnswer(
  params: DeliverHumanAnswerParams,
): Promise<DeliverHumanAnswerResult> {
  const { workflowDir, runId, nodeId, text } = params;

  if (!text.trim()) {
    throw new Error("answer text is empty; a non-empty reply is required");
  }

  const runDir = getRunDir(runId, workflowDir);
  // Replay the journal to learn the node's live status. A missing journal
  // throws here — surfaced to the caller as a clear "no such run" error.
  const { state } = await replayRunJournal(runDir);
  const node = state.nodes[nodeId];
  if (!node) {
    throw new Error(
      `unknown node '${nodeId}' in run '${runId}'`,
    );
  }
  if (node.status !== "waiting") {
    throw new Error(
      `node '${nodeId}' is not waiting for human input ` +
        `(status: ${node.status}); nothing to answer`,
    );
  }

  const inboxPath = getHitlInboxPath(runDir, nodeId);
  // Atomic write: stage a sibling tmp file then rename into place so the
  // live poll loop never observes a half-written inbox file.
  await Deno.mkdir(dirname(inboxPath), { recursive: true });
  const tmpPath = `${inboxPath}.tmp`;
  await Deno.writeTextFile(tmpPath, text);
  await Deno.rename(tmpPath, inboxPath);

  const live = await isRunLive(workflowDir, runId);
  return { inboxPath, live };
}

/** Parameters for {@link resumeRun}. */
export interface ResumeRunParams {
  /** Workflow folder containing `workflow.yaml`. */
  workflowDir: string;
  /** Run id to resume. */
  runId: string;
  /** Output verbosity for the resumed engine run (default `quiet`). */
  verbosity?: Verbosity;
}

/** Summary triple returned by {@link resumeRun}. */
export interface ResumeRunResult {
  run_id: string;
  status: string;
  total_cost_usd?: number;
}

/**
 * Resume a previously-started run from its journal state (FR-E75). This is
 * the SINGLE `Engine({resume:true})` construction site in the codebase —
 * MCP `resume_node` and CLI `run --resume` both delegate here so the resume
 * behaviour cannot drift between the two surfaces. Blocks until the engine
 * run completes (may take minutes).
 */
export async function resumeRun(
  params: ResumeRunParams,
): Promise<ResumeRunResult> {
  const { workflowDir, runId, verbosity = "quiet" } = params;
  const engine = new Engine({
    config_path: configPathOf(workflowDir),
    run_id: runId,
    resume: true,
    dry_run: false,
    verbosity,
    args: {},
    env_overrides: {},
  });
  const state = await engine.run();
  return {
    run_id: state.run_id,
    status: state.status,
    total_cost_usd: state.total_cost_usd,
  };
}
