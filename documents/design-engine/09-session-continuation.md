<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Session Continuation (FR-E100)

How one attempt's runtime session reaches the next. Index:
[design-engine.md](../design-engine.md).

---

## Where the decision is made

Three layers, each with one job:

- **Config** (`config.ts`): `resolveSession(node, defaults)` returns
  `node.session ?? defaults.session ?? "fresh"`. The loop node is not a
  cascade level — it owns no session. `validateSessionField` checks the
  per-node shape (non-empty string, `agent` only); `validateSessionGraph`,
  run from `mergeDefaults` after `validateRuntimeCompatibility`, checks the
  meaning of a node id against the whole graph: the target exists, is an
  agent, is an ancestor through `inputs` (`isSessionAncestor` — a loop body
  node also walks its loop's inputs), resolves to the same runtime, shares
  the tree (neither end has `isolation: worktree` or belongs to a fork branch
  with `allowed_paths`), and inside a fork group both ends run branch by
  branch with equal static branch names. Node-level `continue` outside a loop
  body goes to the `ConfigWarnSink`.
- **State** (`engine/session.ts`): `resolveSessionToContinue(state, nodeId,
  setting, branchKey?)` is pure. It returns `{ sessionId, owner }`,
  `{ fresh: true }` or `{ error }`. Eligibility: a plain `session_id` counts
  only while the owner stands `completed` (it is also written for failed
  attempts, for HITL resume and log correlation); a branch session counts
  when `branch_sessions[branchKey]` exists, because it is written only on
  success. `continue` with nothing eligible is a fresh start; a node id with
  nothing eligible is an error naming node, target, branch and reason.
- **Runtime** (`agent.ts`): `AgentRunOptions.resumeSessionId` makes the
  INITIAL invoke take the continuation shape — `resumeSessionId`, task
  prompt, no `systemPrompt`/`systemPromptFile`, no `agent` — so a resumed
  attempt and a validation continuation are one code path for the runtime.
  `adapter.invoke()` THROWS `AcpUnsupportedOptionError` when the front did
  not advertise `session/load`; the class is not exported, so
  `rejectsResumeSession` duck-types it (`name` plus `fields` containing
  `resumeSessionId`) and maps it to `config_error`; any other throw is
  re-thrown.

## Where the session is recorded

- **Loop body** (`loop.ts`): the resolution runs BEFORE `markNodeStarted`,
  because eligibility reads the status the previous iteration left. After
  every attempt (success or not) `state.nodes[body].session_id` is set from
  the result — the journal already carried it; the live state did not. A
  resolution error becomes a failed `AgentResult` (`config_error`) before any
  runtime turn, and flows through the loop's ordinary failure path.
- **Top-level and fork nodes** (`node-dispatch.ts` `executeAgentNode`): the
  resolution uses `ctx.branch?.key`. `recordSession` writes
  `session_id` for a plain node and `branch_sessions[key]` for a branch —
  on success only, and also after `handleAgentHitl` returns, so a branch
  that went through a human round stays continuable. Every
  `appendAttemptCompleted` call passes the branch key.
- **Journal** (`run-journal.ts`): `attempt_completed.branch_key`; replay
  restores `branch_sessions[branch_key]` when `success === true`, and leaves
  `session_id` replay untouched otherwise. A `node_completed` snapshot
  carries the live `branch_sessions`, so the crash-mid-fork case is the one
  replay must rebuild from attempts alone.

## Observability

`output.status(nodeId, "session: continuing <owner>")` where `<owner>` is
`<node>` or `<node>[<branch-key>]` — the line the live-run evidence greps.
