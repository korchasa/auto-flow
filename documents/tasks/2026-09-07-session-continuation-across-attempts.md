---
date: "2026-09-07"
status: in progress
implements: [FR-E100, FR-E1]
tags: [engine, session, loop, fork, continuation]
related_tasks: []
---

# Session continuation across attempts

## Goal

A node that fixes work after a review keeps the session that produced the
work. Today every invocation of an agent node starts a fresh runtime session,
including the second iteration of the Developer+QA loop (Developer re-reads
the decision, SRS/SDS and the code before it can act on the QA report) and
ratatoskr's `revise` branch (rewrites a text without the session that wrote
it). The engine already resumes a session inside one attempt when validation
fails (FR-E1); this task extends the same mechanism across attempts.

## Overview

### Context

- The runtime adapter accepts `resumeSessionId` on any invoke
  (`@korchasa/ai-ide-cli@0.8.13`, the pinned and locked version;
  `runtime/adapter-types.ts:102`). The engine uses ACP only
  (`agent.ts:415`): the handshake routes `session/load` instead of
  `session/new`, gated on the front advertising
  `agentCapabilities.loadSession`; without it `adapter.invoke()` throws
  `AcpUnsupportedOptionError` (`runtime/acp/handshake.ts:93-134`,
  `runtime/acp/adapter.ts:503-511`). Verified live per
  `documents/requirements-engine/04-runtime-and-hooks.md:402-406`:
  claude-agent-acp 0.37.0 and opencode 1.16.2 advertise `loadSession`;
  the codex front is unverified. On a resumed session the model, effort
  and system prompt are those of the session's first turn.
- The engine uses that path only inside `runAgent`'s validation loop
  (`src/engine/agent.ts:616-642`): the resume invoke carries the task prompt,
  extra args, permission mode, model, effort, tool filters, MCP servers, HITL
  observer, timeouts, `onEvent`, cwd, process registry and the FR-E80 signal,
  but no system prompt and no `agent`.
- `AgentRunOptions` (`src/engine/agent.ts:113-172`) has no field through which
  a caller can hand in a session to continue; `initialInvokeOptions`
  (`agent.ts:411-440`) always opens a new session.
- The loop re-invokes every body node per iteration with a fresh session
  (`src/engine/loop.ts:428-448`). The only continuity is the text
  `This is iteration {{loop.iteration}}` plus the QA report path in the
  Developer prompt (`.flowai-workflow/github-inbox/agents/agent-developer.md:67-80`).
- `session_id` persistence is uneven. A top-level agent node stores it in
  state after the run (`src/engine/node-dispatch.ts:314-315`); a loop body
  node stores it only in the journal (`attempt_completed`, replayed into
  `node.session_id` by `src/state/run-journal.ts:398-403`) and, after a HITL
  round, through `src/hitl/hitl-handler.ts:192-193,245-246`. During a live
  loop `state.nodes[<body>].session_id` is therefore stale or empty.
- Fork branches (FR-E95) are keyed by `branchTreeKey(group, branch)`; the
  branch set is durable through the `branches_expanded` journal record
  (`documents/design-engine/08-fork-join.md:121-126`). The template exposes
  `{{branch.key}}`, `{{branch.index}}`, `{{branch.value}}`
  (`src/types.ts` `TemplateContext.branch`).
- Runtime fallback (FR-E43) is specified, not implemented (index status
  `[ ]`; no `fallback` handling in `agent.ts`), so no carve-out is needed
  today. The SRS already states that sessions are runtime-scoped
  (`documents/requirements-engine/02-nodes-and-models.md:270-272`).
- ratatoskr (`/Users/korchasa/www/sandbox/ratatoskr`, engine pin
  `jsr:@korchasa/flowai-workflow@^0.10.0`, `runtime: codex`) runs the tail
  `write → audit → revise` as three fork nodes, one branch per text
  (`.flowai-workflow/news/workflow.yaml:399-700`). `revise` starts fresh and
  is handed "everything the first attempt had" plus the audit's complaints.
  Decision D69 measured the tail at 3.3 minutes with nothing refused and
  5.6-6.3 minutes when one text is; D67 called the serial chain "the price
  of the attempt". A `revise` branch that continued the `write` branch's
  session would skip re-reading the plan and the sources.

### Current State

- Fresh session per invocation for: every loop body node on iteration > 1,
  every node that follows a review node in a chain, and every node re-run by
  `--resume <run-id>` after a failure.
- Same session reused for: validation-failure continuations inside one
  attempt (FR-E1) and HITL rounds (FR-E8).
- Tests pin the current call sequence: `src/engine/agent_runtime_test.ts:92-93`
  (initial invoke has no `resumeSessionId`, the continuation carries it),
  `src/engine/engine_test.ts:1714-1715`, and the fake adapter's own contract
  in `src/testing/fake-runtime_test.ts:27-32`.

### Constraints

- Opt-in. A workflow that says nothing keeps fresh sessions: cost grows with
  the resumed context, and a session is bound to one machine and one runtime.
- Fail fast, no silent fallback (AGENTS.md). When a node asks to continue a
  session and none is recorded, or the runtime front does not advertise
  `loadSession`, the node fails with a clear message. A fallback to a fresh
  session is added only if the user asks for it.
- Engine stays domain- and workflow-agnostic: no node names, no artifact
  names, no "developer/QA" vocabulary in engine code.
- The resumed invoke follows the existing resume shape (`agent.ts:616-642`):
  no system prompt, no `agent`, same runtime and cwd. A continued node's
  `system_prompt` is therefore not delivered; the prompt is.
- Same runtime only. A node whose resolved runtime differs from the session
  owner's runtime is a config error at load time when the owner is static,
  and a node failure at run time otherwise.
- Journal replay stays the source of truth on `--resume <run-id>`
  (FR-E69): whatever the engine records in memory must also be in the
  `attempt_completed` record it already writes.
- `src/testing/fake-runtime.ts` is the test surface; no mocks of engine
  internals.

### Affected Surface

Scout report (`surface-scout`, collected 2026-09-07), verbatim:

```
## Surface

- `src/engine/loop.ts:426-448` (body-node dispatch inside `runLoop`) — this is where a loop's body node (e.g. `build`/developer) is re-invoked on every iteration. Each iteration calls `runAgent({...})` with no `resumeSessionId`, so it is always a brand-new session — the exact behavior the user wants to change. `{{loop.iteration}}` (line 140 in the dogfood workflow) is currently the only continuity signal, and it is textual, not a real session resume.
- `src/engine/agent.ts:411-440` (`initialInvokeOptions` in `runAgent`) — the initial `adapter.invoke()` call has no parameter for an externally supplied `resumeSessionId`; the function only ever builds `resumeSessionId` internally at line 619 for its own validation-continuation loop. Any cross-iteration resume needs a new input path here (e.g. an `AgentRunOptions.resumeSessionId` field consumed at the top of `runAgent`, distinct from the existing internal continuation resume).
- `src/engine/agent.ts:226-237` (doc comment "Why reuse the same session_id across continuations") — states the existing rationale only for within-node validation continuations; needs a parallel doc note (or an update) once the concept extends across loop iterations.
- `src/engine/node-dispatch.ts:314-315` — after a normal (non-loop) agent node finishes, `eng.state.nodes[nodeId].session_id` is persisted. `runLoop` never does this for loop body nodes (`opts.nodeCompleted`/`markNodeCompleted` calls in loop.ts pass no `session_id`), so there is currently no persisted place to read "last iteration's session_id" from even if the loop wanted to reuse it — this state gap is itself part of the surface.
- `src/types.ts` `NodeState.session_id` (~line 496/523) and `NodeState.iteration` (~line 491/527) — existing per-node state fields; a cross-iteration continuation feature will read/write `session_id` here per loop body node, and must decide how it survives `--resume <run-id>` (state replay) across iterations.
- `src/state/run-journal.ts:399-520` (`attempt_completed`/`loop_iteration_*` journal event handling, `session_id` field ~line 735) — the durable replay path for resumed runs; must correctly restore the "last known session_id per body node" across a crash/resume of a loop in progress.
- `src/config/config.ts` (defaults block ~line 40-44, `RESOLVED_SETTINGS`-style keys ~line 968-988, `resolveRuntimeConfig`/`ResolvedNodeSettings` machinery) — the natural place to add an opt-in config knob (e.g. `continue_session` on a loop or loop body node), following the existing pattern for `max_continuations`/`max_retries`/`on_error`.
- `src/config/validate.ts` — loop/loop-body node validation; would need a rule for the new config knob (type checking, allowed placement — loop-level vs. per-body-node).
- `documents/requirements-engine/01-execution-model.md:8-11` and `documents/requirements-engine/00-meta.md:24,58` — SRS glossary/definition of "Continuation" is explicitly scoped to "re-invoking an agent within the same session… to fix issues detected by validation" — this text will need to be extended or a new FR-E<N> added for cross-iteration continuation, since it currently describes a different (already-implemented) mechanism.
- `documents/requirements-engine/02-nodes-and-models.md:264-282` (loop node fields, and the runtime-fallback note "fresh session (cross-runtime resume is not supported — sessions are runtime-scoped)") — documents that session resume is runtime-scoped; a cross-iteration continuation feature must respect this constraint (fresh session unless the body node's runtime stays the same across iterations) and this section is the natural place to record that constraint.
- `documents/design-engine/04-data-and-logic.md:51,289` and `documents/design-engine/02-engine-modules-flow.md:282,343` — SDS sections describing session_id handling and continuation flow; need updates describing the new cross-iteration path.
- `documents/design-engine/07-graph-and-isolation.md:107,365` — explicitly notes command-body-nodes have "no session, no continuation loop" and calls out `runHitlLoop`'s divergence around session — adjacent design text that a reviewer would expect to stay consistent with any session-continuation change.
- `.flowai-workflow/github-inbox/workflow.yaml:113-166` (the `implementation` loop: `build` developer node + `verify` QA node) — the primary consumer/beneficiary of this feature: this is the exact "fixes after review" loop the user described (`build` re-runs per iteration, driven by QA `verify` failing). Enabling the new continuation option would touch this workflow's node config.
- `.flowai-workflow/github-inbox-opencode/workflow.yaml:105+` — a parallel copy of the same Dev/QA loop pattern, running under the OpenCode runtime instead of Claude. AGENTS.md explicitly flags workflow-folder duplication as an area to keep in sync or document divergence; OpenCode's session-resume mechanism (`opencode run --session`, per requirements-engine/01-execution-model.md:8) differs from Claude's `--resume`, so this is a second, separately-adapted implementation surface, not just a mirror.
- `.flowai-workflow/autonomous-sdlc/workflow.yaml` and `.flowai-workflow/github-inbox-opencode-test/workflow.yaml` — checked directly, contain no `type: loop` node at all (autonomous-sdlc merges Dev+QA into one agent by design) — not affected by this change.
- `src/engine/loop_test.ts`, `src/engine/agent_test.ts`, `src/engine/agent_runtime_test.ts`, `src/engine/agent_effort_test.ts`, `src/engine/agent_tool_filter_test.ts`, `src/engine/engine_test.ts` (`session_id`/`resumeSessionId` assertions, e.g. `engine_test.ts:1714-1715`, `agent_runtime_test.ts:92-93`) — existing tests assert the current fresh-session-per-invoke / resume-only-on-internal-continuation behavior; a cross-iteration continuation feature changes these call sequences and these tests are the parallel/consumer surface that will need new cases (and possibly assertion updates) under the project's TDD rule.
- `src/testing/fake-runtime.ts:43,164` and `src/testing/fake-runtime_test.ts` — the fake runtime adapter used by engine tests; it already tracks `sessionId` per call and asserts `resumeSessionId` propagation (`fake-runtime_test.ts:27-32`), so it is both a consumer of the `resumeSessionId` contract and the tool a new continuation feature would be tested through.
- `src/output.ts:165-173` (`verboseContinuation`) — existing verbose diagnostic for within-node continuation; a parallel "resuming session from previous loop iteration" verbose line would likely belong next to it, and is a natural sibling surface even if not strictly required.
- External sibling repo `@korchasa/ai-ide-cli` (`/Users/korchasa/www/flowai/ai-ide-cli`, per AGENTS.md "Runtime-layer ownership") — `RuntimeInvokeOptions.resumeSessionId` and per-runtime session semantics live there. Any change to how the engine offers/validates `resumeSessionId` on the *initial* invoke (rather than only mid-continuation) should be checked against that package's contract; per AGENTS.md this is explicitly "your responsibility, not a third-party dependency."
- `documents/design-sdlc/03-init-data-logic.md:181-187` and `documents/requirements-sdlc/00-meta.md:32,62` — SDLC-scope docs also define "Continuation" via `--resume`/session-id, mirroring the engine SRS definition; if the engine-level concept is extended, these SDLC-scope glossary entries reference the same mechanism and may need a consistency check (though the loop feature itself is engine-scope, per `scope: engine` in AGENTS.md).

## Queries used

- `ls`, directory survey of repo root, `src/`, `src/engine/`, `documents/requirements-engine/`, `documents/design-engine/`
- `grep -rn "session" -i src --include='*.ts'` (module-level hit list)
- `grep -rn "continuation|continueSession|sessionId|resumeSessionId" -ri src/`
- Full read of `src/engine/loop.ts` and `src/engine/agent.ts`
- `grep -n "session_id|iteration" src/types.ts`
- `grep -n "session_id" src/state/state.ts`
- `grep -rn "resumeSessionId|session_id" src/engine/node-dispatch.ts`
- `grep -n "session_id|nodeCompleted|onAttemptCompleted|attempt_completed" src/engine/engine.ts`
- `grep -ln "loop|continuation|session" documents/requirements-engine/*.md documents/design-engine/*.md`
- `grep -rn "session" documents/requirements-engine*.md documents/design-engine*.md documents/requirements-sdlc*.md documents/design-sdlc*.md`
- `ls .flowai-workflow`, `grep -n "loop|type: loop" .flowai-workflow/github-inbox/workflow.yaml`, then targeted `sed -n` reads of the `implementation` loop block
- `grep -n "type: loop" .flowai-workflow/autonomous-sdlc/workflow.yaml .flowai-workflow/github-inbox-opencode-test/workflow.yaml`
- `grep -rn "session_id|sessionId|resumeSessionId" src/engine/*_test.ts src/testing/*.ts`
- `sed -n` reads of `engine_test.ts` (798-860) and `loop_test.ts` (190-240, 450-490) for existing session-id-bearing test fixtures
- `grep -rln "session" documents/tasks/` and `ls documents/tasks/2026/09` (checked for a pre-existing task file on this topic — none found)
- `grep -n "max_continuations|max_retries|ResolvedNodeSettings|on_error|resolveRuntimeConfig" src/config/config.ts`

## Not examined (budget)

- `src/config/validate.ts` — not opened in full; only confirmed it exists as the validation module for loop/body nodes. Have not located the exact function that would need a new rule for a `continue_session`-style config key.
- Sibling repo `/Users/korchasa/www/flowai/ai-ide-cli` — not opened at all. `RuntimeInvokeOptions`/`RuntimeAdapter.invoke` contract for `resumeSessionId` on a first invoke (vs. only on resume) was inferred from this repo's usage, not verified against the published package source.
- `src/hitl/hitl.ts`, `src/hitl/hitl-handler.ts` — grepped but not fully read; these also juggle `session_id`/`resumeSessionId` for HITL answer delivery inside loop bodies (`carriesHitlQuestion`, `hitlFailure` in loop.ts interact with this). Have not fully traced whether HITL-during-a-loop-iteration and cross-iteration session continuation can conflict (e.g., which session id "wins" when a HITL pause happens on iteration 2).
- `documents/requirements-engine/04-runtime-and-hooks.md` (full file) — grepped for "session" hits only; did not read the full HITL/session sections (lines ~12-64, 360-420) end-to-end.
- `.flowai-workflow/github-inbox-opencode/agents/*.md` and `.flowai-workflow/github-inbox/agents/agent-developer.md` — not opened; may contain agent-authored prose referencing "fresh start" assumptions that would become stale once cross-iteration continuation exists.
- `scripts/` directory — not searched for any dashboard/reporting script that displays or depends on per-iteration `session_id` (e.g. `.flowai-workflow/*/scripts/run-dashboard.sh` referenced in the workflow YAML `after:` hook).
- CI workflows (`.github/workflows/*.yml`) — not checked for any assumption about loop-iteration session freshness.

## Could not rule out

- `src/mcp/` (grepped, zero hits for "session") — plausible that MCP tools like `get_state`/`tail_artifacts` used by the `supervisor` agent (per AGENTS.md dispatch-graph description) surface per-node state including `session_id`; a schema/behavior change there is possible but unconfirmed since the module was only grep-checked, not read.
- Whether `ResolvedNodeSettings` (config.ts) is the right/only place for a new opt-in flag, or whether it belongs on the loop node type (`NodeConfig` loop-specific fields) instead — both `types.ts` areas (loop fields ~264-282 and body-node `ResolvedNodeSettings`) are plausible homes and I did not read enough of `config.ts`'s full node-settings resolution chain to be certain which pattern the maintainers would prefer.
- Interaction with the `fallback` runtime mechanism (`documents/requirements-engine/02-nodes-and-models.md:250-290`): "on continuation (`--resume`)… do NOT re-trigger fallback" — a cross-iteration continuation is a new kind of "resume" not covered by that existing rule, and I did not verify whether `agent.ts`'s fallback-dispatch logic (not shown in the excerpt read) needs an explicit carve-out.
```

Dispositions (union of the scout's rows and the planner's own pass, for
the selected variant):

- `src/engine/loop.ts:426-448` body-node dispatch — covered-by Solution step 5.
- `src/engine/agent.ts:411-440` initial invoke has no external session input — covered-by Solution step 4.
- `src/engine/agent.ts:226-237` "why reuse session" comment — covered-by Solution step 4.
- `src/engine/node-dispatch.ts:314-315` top-level `session_id` persistence vs. none for loop bodies — covered-by Solution steps 5 and 6.
- `src/engine/engine.ts:922-931` fork branches run under the parent node id — covered-by Solution steps 1, 6 and 7 (`branch_sessions`).
- `src/types.ts` `NodeState.session_id` / `iteration` — covered-by Solution step 1.
- `src/state/run-journal.ts:398-403` replay of `attempt_completed.session_id` — not affected — inspected: `appendAttemptCompleted` already records `result.session_id ?? result.output?.session_id` for loop attempts (`run-journal.ts:504-519`) and replay writes it into `node.session_id`; the in-memory gap is in `loop.ts`, not in the journal.
- `src/config/config.ts` config knob — covered-by Solution step 2.
- `src/config/validate.ts` — not affected — inspected: the module holds artifact validation rules (`allPassed`, `formatFailures`, `runValidations`); node-shape validation lives in `src/config/config.ts` (`validateNode`, `validateSettings`), which is the deferred row above.
- `documents/requirements-engine/01-execution-model.md` FR-E1 glossary scope — covered-by DoD item "FR-E1 cross-references FR-E100" and Solution step 9.
- `documents/requirements-engine/02-nodes-and-models.md:264-282` runtime-scoped sessions — covered-by Solution step 9 (same-runtime rule recorded under FR-E100).
- `documents/design-engine/04-data-and-logic.md`, `02-engine-modules-flow.md`, `08-fork-join.md` session flow — covered-by Solution step 9.
- `documents/design-engine/07-graph-and-isolation.md:107,365` command bodies have no session — not affected — inspected: `runCommandBodyNode` projects a command onto `AgentResult` without `session_id` (`loop.ts:85`); a command node cannot own or continue a session and the new field is rejected on it at load time.
- `.flowai-workflow/github-inbox/workflow.yaml:113-166` Developer+QA loop — covered-by Solution step 10 and the live-run DoD item.
- `.flowai-workflow/github-inbox-opencode/workflow.yaml:105+` OpenCode mirror — covered-by Solution step 10 and the live-run DoD item.
- `.flowai-workflow/autonomous-sdlc/workflow.yaml`, `github-inbox-opencode-test/workflow.yaml` — not affected — inspected by the scout: no `type: loop` node.
- `src/engine/loop_test.ts`, `agent_test.ts`, `agent_runtime_test.ts`, `agent_effort_test.ts`, `agent_tool_filter_test.ts`, `engine_test.ts` — covered-by Solution "Tests" (existing assertions on `calls[0].resumeSessionId === undefined` stay valid because the default is fresh).
- `src/testing/fake-runtime.ts`, `fake-runtime_test.ts` — not affected — inspected: the fake already records `resumeSessionId` per call and echoes a configurable `sessionId` (`fake-runtime.ts:43-60,158-170`), which is all the new tests need.
- `src/output.ts:165-173` `verboseContinuation` — not affected — the continuation line is emitted through the existing `output.status` in Solution step 5; no new `OutputManager` method.
- External `@korchasa/ai-ide-cli` — not affected — inspected against the published 0.8.13 source: `resumeSessionId` is a plain field on `RuntimeInvokeOptions` for "initial or resume" invokes (`runtime/adapter-types.ts:77-103`), the ACP handshake routes it to `session/load` with a capability gate, and the unsupported case is a THROWN `AcpUnsupportedOptionError` whose class is not exported (Solution step 4 duck-types it). No runtime-layer change is required now; a typed guard export is a Follow-up.
- `documents/design-sdlc/03-init-data-logic.md:181-187`, `documents/requirements-sdlc/00-meta.md:32,62` SDLC glossary — not affected — inspected: they describe FR-E1's within-attempt continuation, which keeps its meaning; a cross-reference is optional.
- `src/mcp/` state exposure — not affected — inspected: `get_state` returns the persisted `RunState` as-is; `session_id` is already an optional field of `NodeState`, so filling it for body nodes changes no schema.
- `.flowai-workflow/*/agents/agent-developer.md` prose ("Read QA report FIRST") — covered-by Solution step 10.
- `scripts/`, CI workflows — not affected — inspected: `grep -rn "session_id" scripts/ .github/` returns no consumer of per-iteration session ids.
- ratatoskr `write → audit → revise` chain (`/Users/korchasa/www/sandbox/ratatoskr/.flowai-workflow/news/workflow.yaml:399-700`) — deferred — human choice (engine support ships here via `session: <node-id>`; adoption is a Follow-up in that repo).

## Definition of Done

- [x] FR-E100 — A loop body node that opts in continues, on iteration N+1, the session recorded for it after iteration N; the resumed invoke carries `resumeSessionId` and no system prompt. Test: `src/engine/loop_test.ts::loop body node — continues the previous iteration's session when opted in`. Evidence: `deno task check 2>&1 | grep "continues the previous iteration"`.
- [x] FR-E100 — A node that does not opt in keeps a fresh session on every attempt (existing assertions stay green). Test: `src/engine/agent_runtime_test.ts::runAgent — continuation uses runtime adapter resume session` (existing, asserts `calls[0].resumeSessionId === undefined` at `agent_runtime_test.ts:92`). Evidence: `deno task check 2>&1 | grep "continuation uses runtime adapter resume session"`.
- [x] FR-E100 — After a failed attempt, `--resume <run-id>` starts the node fresh (a failed attempt's session is never continued), while a crash between loop iterations still continues iteration N's completed session. Test: `src/engine/loop_test.ts::loop body node — a replayed failed attempt is not continued`. Evidence: `deno task check 2>&1 | grep "replayed failed attempt"`.
- [x] FR-E100 — `session: <node-id>` is rejected at load time when the two nodes cannot share one tree (`isolation: worktree`, or a fork branch with `allowed_paths`). Test: `src/config/config_isolation_test.ts::session target in another worktree is rejected`. Evidence: `deno task check 2>&1 | grep "another worktree is rejected"`.
- [x] FR-E100 — A fork branch that answered a HITL question still records its branch session and can be continued. Test: `src/engine/engine_test.ts::fork branch records branch_sessions after a HITL round`. Evidence: `deno task check 2>&1 | grep "after a HITL round"`.
- [x] FR-E100 — A node that opts in but has no recorded session, or whose front rejects `session/load`, fails with a message naming the node and the reason; no silent fresh session. Test: `src/engine/loop_test.ts::loop body node — fails clearly when the session to continue is missing`. Evidence: `deno task check 2>&1 | grep "session to continue is missing"`.
- [x] FR-E100 — The session recorded for a loop body node is visible in `state.json` after each attempt and survives `--resume <run-id>` through journal replay. Test: `src/engine/engine_test.ts::executeLoopNode — records the body node session id in state after each attempt`. Evidence: `deno task check 2>&1 | grep "records the body node session id"`.
- [x] FR-E100 — Config validation rejects the new field on nodes that cannot own a session (command, merge, human, hitl, loop), on a target that is not an agent ancestor via `inputs`, on a node id in `defaults.session`, on unequal static branch key sets, and on a runtime mismatch that is static at load time; node-level `continue` outside a loop body is a WARN, not an error. Test: `src/config/config_test.ts::validateNode — session field placement and runtime match`. Evidence: `deno task check 2>&1 | grep "session field placement"`.
- [x] FR-E100 — `defaults.session: continue` applies to every agent node that says nothing, and `session: fresh` on a node overrides it. Test: `src/config/config_test.ts::resolveSession — node overrides defaults`. Evidence: `deno task check 2>&1 | grep "resolveSession"`.
- [x] FR-E100 — A fork node records one session per branch key, and a downstream fork node with `session: <node-id>` continues the branch with the same key; a key without a counterpart fails with a message naming node, target and key. Test: `src/engine/engine_test.ts::session: <node> on a fork node continues the same-key branch session`. Evidence: `deno task check 2>&1 | grep "same-key branch session"`.
- [x] FR-E100 — Journal replay restores per-branch sessions from `attempt_completed.branch_key`. Test: `src/state/lifecycle-replay_test.ts::attempt_completed with branch_key restores branch_sessions`. Evidence: `deno task check 2>&1 | grep "restores branch_sessions"`.
- [x] FR-E100 — `runAgent` with `resumeSessionId` sends the resume shape on the first invoke (no system prompt, no `agent`), and a front that did not advertise `session/load` yields `config_error` with a message naming the node and runtime. Test: `src/engine/agent_runtime_test.ts::runAgent — resumeSessionId on the initial invoke uses the resume shape`. Evidence: `deno task check 2>&1 | grep "resume shape"`.
- [x] FR-E100 — SDS and README describe the field, the resume shape and `branch_sessions`. Test: `manual — korchasa`. Evidence: `grep -n "session" README.md documents/design-engine/04-data-and-logic.md documents/design-engine/08-fork-join.md`.
- [x] FR-E100 — Add the FR-E100 section to the SRS (`documents/requirements-engine/13-session-continuation.md` + index row in `documents/requirements-engine.md`) with the `**Acceptance:**` field filled. Test: `manual — korchasa`. Evidence: `grep -n "FR-E100" documents/requirements-engine.md documents/requirements-engine/13-session-continuation.md`.
- [x] FR-E1 — FR-E1's description cross-references FR-E100 so "continuation" reads as within-attempt and "session continuation" as across attempts. Test: `manual — korchasa`. Evidence: `grep -n "FR-E100" documents/requirements-engine/01-execution-model.md`.
- [ ] FR-E100 — The dogfood `github-inbox` and `github-inbox-opencode` loops opt the Developer node in, and one live run of each shows iteration 2 resuming iteration 1's session in `stream.log`. Test: `manual — korchasa`. Evidence: `grep -n "resume" .flowai-workflow/github-inbox/runs/<run-id>/*/build/stream.log`.

## Solution

Selected: Variant 2 with a workflow-level default — a `session:` field on
agent nodes and in `defaults:`. Opt-in per node; `defaults.session` flips the
default for the whole workflow and a node opts out with `session: fresh`.

### Config surface

```yaml
defaults:
  session: fresh | continue          # optional; default fresh

nodes:
  build:
    type: agent
    session: continue                # continue own last recorded session
  revise:
    type: agent
    session: write                   # continue the session of input node `write`
```

Semantics:

- `fresh` — new session on every attempt (today's behaviour).
- `continue` — the node continues the session of its own last SUCCESSFUL
  attempt in this run. Only a loop body node has one (iteration N after
  iteration N completed), so on a top-level node the value has no effect
  today: the node starts fresh, and an explicit node-level `session:
  continue` outside a loop body earns a load-time WARN ("no effect outside a
  loop body"), not an error. That is what makes `defaults.session: continue`
  safe on a workflow with top-level nodes before the loop. A failed attempt's
  session is never eligible, so `--resume <run-id>` after a failure starts
  fresh (resume-after-fail stays deferred, see Follow-ups), while `--resume`
  after a crash between iterations still continues iteration N's completed
  session.
- `<node-id>` — the node continues the session recorded for that node's
  completed attempt. The target must be an ancestor through `inputs`
  (direct or transitive), an agent node, and share the node's tree: a
  session is bound to one cwd, so the field is rejected when either node
  carries `isolation: worktree` or sits in a fork branch that declares
  `allowed_paths` (per-branch trees, FR-E91). In a fork branch the target's
  branch with the same `branch.key` is used, so `revise` branch `k`
  continues `write` branch `k` even across different groups; when both
  `fork.branches` are static lists the key sets are compared at load time,
  and for dynamic lists a key without a counterpart fails that branch at
  run time with a message naming node, target and key.
- Resolution order: `node.session ?? defaults.session ?? "fresh"`. The loop
  node is not a cascade level (it cannot own a session; the field is
  rejected on it). `defaults.session` accepts `fresh` and `continue` only —
  a node id in `defaults` is a load-time error.
- Resumed invoke shape = the existing continuation shape
  (`agent.ts:616-642`): `resumeSessionId`, task prompt, no `systemPrompt` /
  `systemPromptFile` / `agent`. The node's own `system_prompt` is not
  delivered; documented under FR-E100.
- Fail fast, no fallback: no recorded session, a branch key with no
  counterpart, or a front that did not advertise `session/load` fails the
  node with a message naming the node, the field and the reason.

### Files to modify

1. `src/types.ts`
   - `NodeConfig.session?: string` (`"fresh" | "continue" | <node-id>`),
     `WorkflowDefaults.session?: "fresh" | "continue"`.
   - `NodeState.branch_sessions?: Record<string, string>` — session id per
     `branch.key` for a fork node. Needed because every branch runs
     `executeAgentNode` under the parent node id (`engine.ts:922-931`) and
     `state.nodes[id].session_id` would keep whichever branch finished last.
   - `attempt_completed` journal payload gains `branch_key?: string`.
2. `src/config/config.ts`
   - Add `session` to `NODE_CONFIG_KEYS` and to the accepted `defaults` keys.
   - `validateNode`: value is a non-empty string; only on `type: agent`
     (loop, command, merge, human, hitl reject it); node-level `continue`
     outside a loop body → load-time WARN through the `ConfigWarnSink`; a
     node id must exist in `allNodeIds`, be an agent node and be an ancestor
     via `inputs` (compute with `buildDependencies` from `src/engine/dag.ts`
     and walk upward); if both nodes resolve a static runtime
     (`resolveRuntimeConfig`) and they differ, reject; if either node has
     `isolation: worktree` or is a fork node whose branches declare
     `allowed_paths`, reject ("different trees"); if both nodes fork over
     static lists, the key sets must be equal. Loop body nodes may name a
     node outside the loop only if it is an input of the loop node.
   - `validateSettings`/defaults path: `defaults.session ∈ {fresh, continue}`.
   - `export function resolveSession(node, defaults): "fresh" | "continue" | string`
     next to `resolveBudget` (`config.ts:1144`).
3. `src/engine/session.ts` (new, small) — `resolveSessionToContinue(state,
   nodeId, setting, branchKey?)`: returns `{ sessionId }`, `{ fresh: true }`
   or `{ error }`. Eligibility: a plain node's `session_id` counts only while
   `state.nodes[<owner>].status === "completed"` (a failed or waiting owner
   is not continued); a branch session counts when
   `branch_sessions[branchKey]` exists (it is written only on success).
   `continue` with no eligible own session → `{ fresh: true }` (first
   attempt); `<node-id>` with no eligible target session → `{ error }`.
   Error strings name node, target, branch and reason. Unit-tested on its
   own, including the replayed-failed-attempt case.
4. `src/engine/agent.ts`
   - `AgentRunOptions.resumeSessionId?: string`. When set, the initial invoke
     uses the resume shape: skip `prepareSystemPromptDelivery`, omit `agent`,
     set `resumeSessionId`. Everything else (extraArgs, model, effort, tool
     filters, MCP servers, HITL observer, `onEvent`, cwd, registry, signal)
     stays identical to the continuation invoke.
   - Wrap the invoke: when `resumeSessionId` is set, the library THROWS
     `AcpUnsupportedOptionError` from `adapter.invoke()` when the front did
     not advertise `loadSession` (`runtime/acp/adapter.ts:503-511,681-688`
     in 0.8.13; the class is not in the package `exports`, so it cannot be
     imported). Catch every throw from that invoke, recognise the ACP case
     by the stable `name` the constructor sets
     (`runtime/acp/errors.ts:33`: `this.name = "AcpUnsupportedOptionError"`)
     together with the documented `fields` property
     (`fields.includes("resumeSessionId")`) and return `{ success: false,
     error_category: "config_error", error: "Node '<id>' asks to continue a
     session, but runtime '<r>' did not advertise session/load" }`; any
     other throw is re-thrown unchanged. Same precedent as comparing
     `error_category` string literals (AGENTS.md). A typed guard export
     upstream is a Follow-up.
   - Extend the "Why reuse the same session_id" comment (`agent.ts:227`) to
     cover cross-attempt continuation.
5. `src/engine/loop.ts`
   - After every body attempt (success or not), record
     `state.nodes[bodyId].session_id = result.session_id ?? result.output?.session_id`
     (the journal already carries it via `onAttemptCompleted`).
   - Before `runAgent` (`loop.ts:428`): `setting = resolveSession(bodyNode,
     config.defaults)`; when `setting !== "fresh"` and (`setting !==
     "continue"` or `iteration > 1`), call `resolveSessionToContinue`; on
     error fail the body node through the existing `nodeFailed` path with
     `error_category: "config_error"`; else pass `resumeSessionId` and emit
     `output.status(bodyId, "session: continuing <owner>")`.
   - `continue` on iteration 1 is a fresh session by definition (nothing
     recorded yet) — not an error.
6. `src/engine/node-dispatch.ts` (`executeAgentNode`)
   - Before `runAgent`: `setting = resolveSession(node, eng.config.defaults)`;
     for a node id, resolve with `ctx.branch?.key`; error → `eng.nodeFailed(
     nodeId, msg, "config_error")`, return null.
   - After `runAgent`: when `ctx.branch` is set and the result succeeded,
     write `state.nodes[nodeId].branch_sessions[ctx.branch.key]` instead of
     `session_id`; pass `branchKey` to `appendAttemptCompleted`.
   - HITL path (`node-dispatch.ts:284-311`): after `handleAgentHitl` returns
     a successful result, apply the same branch write and pass `branchKey`
     to the `appendAttemptCompleted` call at line 310, so a branch that went
     through a human round is still continuable. `hitl-handler.ts` keeps
     updating `session_id` for plain nodes.
7. `src/state/run-journal.ts`
   - `appendAttemptCompleted(..., iteration?, branchKey?)` writes
     `branch_key`; replay (`run-journal.ts:398-403`): with `branch_key` set
     AND `success === true`, restore `node.branch_sessions[branch_key]`;
     otherwise keep today's `node.session_id` replay untouched (the
     eligibility rule in step 3 reads the node status, so a replayed failed
     attempt is never continued).
8. `src/state/state.ts` — no new function; `branch_sessions` is created
   lazily by the writer. `markNodeStarted` must not clear `session_id` or
   `branch_sessions` (verify by test: it currently does not touch them).
9. Docs
   - SRS: new section file `documents/requirements-engine/13-session-continuation.md`
     with FR-E100 (description, config schema, semantics, failure contract,
     acceptance with tests); index row in `documents/requirements-engine.md`;
     FR-E1 description gains one sentence pointing at FR-E100 ("within-attempt
     continuation; across attempts see FR-E100").
   - SDS: `documents/design-engine/02-engine-modules-flow.md` (runAgent
     resume shape on initial invoke), `04-data-and-logic.md` (`NodeConfig.session`,
     `WorkflowDefaults.session`, `NodeState.branch_sessions`, journal field),
     `08-fork-join.md` (per-branch session record).
   - `README.md` → `## Configuration`: one bullet for `session`.
   - `AGENTS.md` Architecture → Continuation bullet: one sentence.
10. Dogfood: `.flowai-workflow/github-inbox/workflow.yaml` and
    `.flowai-workflow/github-inbox-opencode/workflow.yaml` — `build: session:
    continue`. `agents/agent-developer.md` (both copies) step 6: "On
    iteration > 1 you are in the same session as your previous attempt; read
    the QA report first, do not re-read the decision".

### Tests (RED first, then GREEN)

- `src/engine/session_test.ts` — `resolveSessionToContinue`: own session,
  target session, branch-keyed target, each missing case yields the
  documented message.
- `src/engine/loop_test.ts` — `loop body node — continues the previous
  iteration's session when opted in` (fake runtime; `calls[1].resumeSessionId
  === calls[0]` reply id, `calls[1].systemPrompt === undefined`);
  `loop body node — fails clearly when the session to continue is missing`;
  `loop body node — fresh by default` (existing assertions stay).
- `src/engine/engine_test.ts` — `executeLoopNode — records the body node
  session id in state after each attempt`; `fork branches record
  branch_sessions by key`; `session: <node> on a fork node continues the
  same-key branch session` (fake runtime hands out `ses-<key>` per branch).
- `src/engine/agent_runtime_test.ts` — `runAgent — resumeSessionId on the
  initial invoke uses the resume shape`; `runAgent — session/load not
  advertised fails with config_error`.
- `src/config/config_test.ts` — `validateNode — session field placement and
  runtime match` (non-agent node, unknown target, target not an ancestor,
  static runtime mismatch, `continue` outside a loop, `defaults.session`
  with a node id).
- `src/state/lifecycle-replay_test.ts` — `attempt_completed with branch_key
  restores branch_sessions`.

### Error handling

Every failure is a node failure with `error_category: "config_error"` and a
message that names the node, the `session:` value and the reason. No fallback
to a fresh session, no warning-and-continue.

### Verification

```bash
deno task check > "$SCRATCH/check.log" 2>&1; echo "EXIT: $?"
```

```bash
deno run -A --no-check src/cli.ts run .flowai-workflow/github-inbox --dry-run
```

Live evidence (after `git push`, because the worktree is checked out from
`origin/main`): one `deno task run` whose QA fails once, then

```bash
grep -n "session: continuing" .flowai-workflow/github-inbox/runs/<run-id>/*.log
```

and in `runs/<run-id>/<phase>/build/stream.log` the second attempt shows the
resume rather than a fresh `system/init`. Same run once under
`github-inbox-opencode`.

## Follow-ups

- Continuing a failed node's session on `--resume <run-id>` (resume-after-fail)
  is deferred — a separate concern with its own failure-repeat risk; not
  requested.
- A `--dry-run` probe of `agentCapabilities.loadSession` per front needs a
  handshake-without-prompt export in `@korchasa/ai-ide-cli`; deferred until
  a front is found that lacks it.
- ratatoskr adoption (`/Users/korchasa/www/sandbox/ratatoskr`): after this
  ships, raise the engine pin from `^0.10.0`, set `revise: session: write`,
  and verify on a real run that the codex ACP front advertises `session/load`
  — unknown today. Lives in that repo.
- Loop node as a cascade level for `session` (like `budget`) — not added;
  revisit if a workflow wants it on every body node.
- `@korchasa/ai-ide-cli`: export a typed guard (`isAcpUnsupportedOptionError`)
  from `runtime/types` so the engine stops duck-typing the `fields` property
  (Solution step 4); publish, bump the pin, replace the duck-type.
- Dynamic fork lists cannot be key-checked at load time; if a mismatch shows
  up in practice, add a `--dry-run` cross-check that expands both lists.
