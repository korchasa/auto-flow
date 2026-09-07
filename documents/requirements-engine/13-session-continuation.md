<!-- section file — index: [documents/requirements-engine.md](../requirements-engine.md) -->

# SRS Engine — Session Continuation

The session of one attempt carried into the next: a loop body fixing what a
reviewer found, or a node rewriting what an ancestor wrote, no longer starts
from nothing. Index: [requirements-engine.md](../requirements-engine.md).

---

### 3.100 FR-E100: Session Continuation Across Attempts

- **Description:** An agent node MAY declare which runtime session its
  attempt runs in, through a `session` field on the node or a workflow-wide
  `defaults.session`. FR-E1 continues a session INSIDE one attempt (validation
  failed, same node, same turn of the workflow); this requirement continues a
  session ACROSS attempts — the next loop iteration, or a later node.

  **Config schema.**

  ```yaml
  defaults:
    session: fresh | continue          # optional; default fresh

  nodes:
    build:
      type: agent
      session: continue                # own last successful attempt
    revise:
      type: agent
      session: write                   # the session input node `write` recorded
  ```

  Resolution order: `node.session ?? defaults.session ?? "fresh"`. The field
  is valid on `agent` nodes only; `defaults.session` takes `fresh` or
  `continue`, never a node id.

  **Semantics.**
  - `fresh` — a new session on every attempt.
  - `continue` — the node re-enters the session of its own last SUCCESSFUL
    attempt in this run. Only a loop body node has one (iteration N+1 after
    iteration N completed); on a top-level node the value has no effect, and
    an explicit node-level `continue` outside a loop body is a load-time
    warning, not an error — which is what keeps `defaults.session: continue`
    usable on a workflow with nodes before its loop. A failed attempt's
    session is never eligible, so `--resume <run-id>` after a failure starts
    the node fresh, while `--resume` after a crash between iterations still
    continues the completed iteration's session.
  - `<node-id>` — the node re-enters the session that node recorded for its
    completed attempt. The target MUST be an agent node, an ancestor through
    `inputs` (direct or transitive; a loop body node also inherits its loop's
    inputs), on the same resolved runtime, and in the same tree: the field is
    rejected at load when either node carries `isolation: worktree` or sits in
    a fork branch that declares `allowed_paths` (FR-E91). Inside a fork group
    (FR-E95) both ends MUST run branch by branch, and a branch continues the
    target's branch with the same `branch.key`; two static branches with
    different names are rejected at load, and a runtime branch with no
    counterpart fails that branch at run time naming node, target and key.

  **Engine behaviour.** The resumed invoke takes the shape FR-E1's
  continuation already uses: `resumeSessionId` and the task prompt, no system
  prompt and no `agent` — a resumed session keeps the system prompt of its
  first turn, so a continued node's own `system_prompt` is not delivered. A
  loop body node records its session in run state after every attempt; a
  fork node records one session per branch key in `NodeState.branch_sessions`
  (written only for a successful branch, a branch that answered a HITL
  question included), because every branch runs under one node id. The
  `attempt_completed` journal record carries `branch_key`, and replay (FR-E69)
  restores `branch_sessions` from successful branch attempts.

  **Failure contract.** No fallback to a fresh session. A node that asks for a
  session nobody recorded, a branch key with no counterpart, or a runtime
  front that did not advertise `session/load` (`AcpUnsupportedOptionError`
  from `@korchasa/ai-ide-cli`) fails the node with `error_category:
  "config_error"` and a message naming the node, the `session` value and the
  reason.

- **Tasks:** [session-continuation-across-attempts](../tasks/2026-09-07-session-continuation-across-attempts.md)

- **Motivation:** Every invocation of an agent node opened a fresh session,
  including the second iteration of the Developer+QA loop — the Developer
  re-read the decision, the SRS/SDS and the code before it could act on the
  QA report — and ratatoskr's `revise` branch, which rewrote a text without
  the session that wrote it. The engine already had the mechanism (FR-E1's
  resume invoke); it had no way to hand one attempt's session to the next.

- **Dep:** FR-E1, FR-E69, FR-E95

- **Acceptance criteria:**
  - **Tests:** `config_test.ts`, `config_isolation_test.ts`,
    `session_test.ts`, `loop_test.ts`, `engine_test.ts`,
    `agent_runtime_test.ts`, `lifecycle-replay_test.ts` (FR-E100;
    regression-locked).
  - [x] SDS and README describe the field, the resume shape and
    `branch_sessions`. Evidence: `documents/design-engine/09-session-continuation.md:1`,
    `README.md` (`## Configuration`, `session` bullet).
  - [x] The dogfood `github-inbox` and `github-inbox-opencode` loops opt the
    Developer node in (`build: session: continue`). Evidence:
    `.flowai-workflow/github-inbox/workflow.yaml` (`build:` node),
    `.flowai-workflow/github-inbox-opencode/workflow.yaml` (`build:` node).
  - [x] A live `github-inbox` (claude) run shows iteration 2 resuming
    iteration 1's session. Evidence: run `20260907T032306` (2026-09-07):
    the journal records `session_id 019da1fc-…` for `build` iteration 1,
    the run log prints `build session: continuing build` at iteration 2
    start, and `build/stream.log` replays iteration 1's turns 2 s later
    (a fresh session could not have produced them).
  - [ ] A live `github-inbox-opencode` run shows the same. Not exercised
    yet: run `20260907T032722` (2026-09-07) recorded `build`'s session
    (`ses_…`) but QA passed on iteration 1, so no resume happened.
