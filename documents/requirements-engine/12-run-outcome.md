# SRS Section: Run Outcome

One scheduler for the whole graph, and the run's verdict as a value nodes can
read. Index: [requirements-engine.md](../requirements-engine.md).

---

### 3.99 FR-E99: Run Outcome as a Scheduling Value

- **Description:** A node carrying `run_on` (FR-E11) is not a phase — it is a
  node whose input is the run's outcome. The engine MUST schedule it with the
  same code that schedules every other node and gate it with the same
  `gateNode`, and MUST expose the outcome as a value rather than keeping it in
  a local variable.

  **One scheduler, two waves.** `Engine.runNodes` (FR-E97) runs twice: once
  over the graph, then — with the outcome known — over the nodes that wait on
  it. The second call passes `continueOnFailure`, so a failed node of that
  wave takes its own verdict down and not its siblings'. Ordering inside the
  wave comes from the shared dependency map, so no second topological sort
  exists. `on_failure_script` fires between the waves whenever the outcome is
  failure, independently of whether the workflow declares any `run_on` node.

  **A failed wave node skips its dependants.** Because the wave carries on
  past a failure, a node that takes the failed one as input would otherwise
  stay unreachable, and a ready set with nothing runnable in it makes the
  scheduler throw — taking down a run whose graph had already completed. The
  failed node therefore counts as finished for scheduling and marks its
  dependants untaken, so they are skipped for want of their input, exactly as
  a node downstream of an untaken `when` branch is (FR-E89). The run's status
  still comes from the graph, not from the wave.

  **The value.** `TemplateContext.run` carries `outcome`
  (`pending | success | failure`) and `attempt` (one-based engine invocation
  counter). Both are addressable as `{{run.outcome}}` and `{{run.attempt}}`
  in every place a template is interpolated, `when` predicates included.
  `outcome` reads `pending` while the graph runs, so a node inside the graph
  cannot read its own run's verdict.

  **The gate.** `run_on` is evaluated in `gateNode`, next to `when`: `always`
  and `every_attempt` pass any outcome, `success` and `failure` must match it.
  A node reached while the outcome is still `pending` is an engine defect and
  throws. Two gates therefore start applying to these nodes, and both are
  intended: `--skip` / `--only` select them like any other node, and a node
  whose input was skipped by `when` is skipped rather than run against
  artifacts that do not exist.

  **The attempt counter.** Every engine invocation over a run appends a
  `run_attempt_started` journal record (FR-E69), the fresh run included, and
  replay restores the count as `RunState.attempt`. A journal written before
  the record existed replays as attempt 1. A node of the outcome wave records
  the invocation that completed it in `NodeState.completed_attempt`, which is
  what lets `get_state` tell "completed in an earlier attempt" from "already
  re-ran in this one".

- **Tasks:** [one-scheduler-run-outcome](../tasks/2026-08-30-one-scheduler-run-outcome.md)

- **Motivation:** Reported against engine 0.9.1: a `run_on: always` node did
  not run on `--resume`. The cause was not `run_on` but the duplication
  around it — `executePostWorkflow` was a second scheduler with its own
  topological sort, its own completed-node check ahead of the `run_on` read,
  no `gateNode` call and unconditional error swallowing. `when` was therefore
  silently inert on these nodes although FR-E89 promises it on any node, a
  failing node vanished without a message, and the set of post-workflow nodes
  was derived independently in four places (engine, `--dry-run`, dashboard,
  diagram). Removing the second scheduler removes the whole class.

- **Dep:** FR-E11 (`run_on`), FR-E34 (`on_failure_script`), FR-E69 (journal),
  FR-E89 (`when`), FR-E97 (input-driven scheduling).

- **Acceptance criteria:**
  - **Tests:** `src/engine/outcome-wave_test.ts` (including a failed wave node
    whose dependant is skipped rather than stalling the scheduler, and the
    regression lock that an ordinary failed graph node outside any fork group
    still stops the run),
    `src/state/lifecycle-replay_test.ts`, `src/config/template_test.ts`,
    `src/mcp/mcp-server_test.ts`, `scripts/generate-dashboard_test.ts`,
    `scripts/workflow-diagram_test.ts` (FR-E99; regression-locked).
  - [x] `executePostWorkflow` and `sortPostWorkflowNodes` no longer exist;
    `post-workflow.ts` keeps only the selection rule and the failure hook.
    Evidence: `src/engine/post-workflow.ts:1-14`.
  - [x] The dashboard and the diagram call `collectPostWorkflowNodes` instead
    of re-deriving the set. Evidence:
    `scripts/generate-dashboard.ts:352`, `scripts/workflow-diagram.ts:865`.
