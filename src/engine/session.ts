/**
 * @module
 * FR-E100: which runtime session an agent node's attempt re-enters.
 *
 * Config decides the policy (`session: fresh | continue | <node-id>`, see
 * `resolveSession` in `config.ts`); this module reads the run state to turn
 * that policy into a concrete session id — or into a clear reason why none
 * exists. It is pure: no I/O, so the eligibility rule is unit-tested on its
 * own and shared by the loop executor and the node dispatcher.
 *
 * Eligibility is strict on purpose. Only a COMPLETED attempt's session is
 * continued: a failed attempt's session is left alone, so `--resume` after a
 * failure starts the node fresh instead of re-entering the conversation that
 * failed. Inside a fork group the record is per branch key, because every
 * branch runs under one node id and a single `session_id` would keep
 * whichever branch finished last.
 * Entry point: {@link resolveSessionToContinue}.
 */

import type { NodeState, RunState } from "../types.ts";

/** Outcome of {@link resolveSessionToContinue}. */
export type SessionResolution =
  /** Re-enter `sessionId`; `owner` names who recorded it (`id` or `id[key]`). */
  | { sessionId: string; owner: string }
  /** Open a new session. */
  | { fresh: true }
  /** The node asked for a session that does not exist; fail the node. */
  | { error: string };

/**
 * Resolve the session an attempt of `nodeId` should re-enter.
 *
 * @param setting the node's resolved `session` value.
 * @param branchKey the `branch.key` the attempt runs for, when the node runs
 *   once per branch of a fork group.
 */
export function resolveSessionToContinue(
  state: RunState,
  nodeId: string,
  setting: string,
  branchKey?: string,
): SessionResolution {
  if (setting === "fresh") return { fresh: true };

  if (setting === "continue") {
    const own = eligibleSession(state.nodes[nodeId], branchKey);
    return own === undefined
      ? { fresh: true }
      : { sessionId: own, owner: ownerLabel(nodeId, branchKey) };
  }

  const target = eligibleSession(state.nodes[setting], branchKey);
  if (target !== undefined) {
    return { sessionId: target, owner: ownerLabel(setting, branchKey) };
  }
  return {
    error: branchKey === undefined
      ? `Node '${nodeId}' asks to continue the session of '${setting}' (session: ${setting}), but '${setting}' has no completed attempt that recorded one`
      : `Node '${nodeId}' asks to continue the session of '${setting}' for branch '${branchKey}' (session: ${setting}), but no completed attempt of '${setting}' recorded one for that branch`,
  };
}

/**
 * The session a node's record offers, or undefined.
 *
 * A branch session is written only on success, so its presence is the
 * eligibility. A plain `session_id` is also written for failed attempts (it
 * is what a HITL resume and the logs correlate on), so it counts only while
 * the node stands `completed`.
 */
function eligibleSession(
  node: NodeState | undefined,
  branchKey: string | undefined,
): string | undefined {
  if (node === undefined) return undefined;
  if (branchKey !== undefined) return node.branch_sessions?.[branchKey];
  return node.status === "completed" ? node.session_id : undefined;
}

function ownerLabel(nodeId: string, branchKey: string | undefined): string {
  return branchKey === undefined ? nodeId : `${nodeId}[${branchKey}]`;
}
