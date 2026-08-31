---
date: "2026-08-30"
status: done
implements: [FR-E11, FR-E34, FR-E89, FR-E97, FR-E99]
tags: [engine, scheduling, resume, post-workflow]
related_tasks:
  - 2026-08-30-explicit-fork-join.md
  - 2026-08-16-borrowed-graph-features.md
---
# One scheduler, and the run outcome as a value

## Goal

Make a post-workflow node an ordinary node. Today the engine has two
schedulers: `runNodes` (readiness-driven, FR-E97) for the graph, and
`executePostWorkflow` for everything carrying `run_on`. The second one
duplicates topological sorting, duplicates the completed-node check,
skips `gateNode` entirely — so FR-E89's `when:` is silently inert on a
post-workflow node — and swallows node errors unconditionally. Every
defect in this class is a consequence of the duplication, not of
`run_on` itself. Collapse the two schedulers into one and express what
`run_on` says as data the one scheduler already understands: the run's
outcome, available as a value.

## Overview

### Context

Reported from the `ratatoskr` project against engine 0.9.1: a node with
`run_on: always` did not run on `--resume` after the run had failed and
been restarted. `src/engine/post-workflow.ts:119` reads
`isNodeCompleted(state, nodeId)` before it reads `run_on`, so a node
completed in an earlier attempt is skipped whatever its `run_on` says.
The peer proposed a `rerunCompletedAlways` flag through the same call
path.

That flag is a point fix and it is unsafe here. Our own bundled
workflow carries `run_on: always` on `tech-lead-review`
(`.flowai-workflow/github-inbox/workflow.yaml:191`), whose prompt merges
the pull request. Re-running it on every resume attempts a second merge.
So "always" cannot mean "every attempt" for that node, and it must mean
something like it for a node that only reports. One boolean cannot
carry both, which is the signal that the field is being asked to hold a
concern it does not own.

The concern it does not own is the run's outcome. `run_on: always |
success | failure` is a predicate over one value the engine computes and
never exposes: whether the graph passed. FR-E89 already gives every node
a predicate — `when:` — evaluated by `Engine.gateNode`. A post-workflow
node is not a phase; it is a node whose input is the run's outcome, and
it is only unreachable in the ordinary dependency map because that map
has no vertex for the outcome.

### Current State

- `Engine.runNodes` (`src/engine/engine.ts:481-491`) schedules by
  readiness (FR-E97) and calls `gateNode` (`:587`), which evaluates
  `when:` (`:617`). It stops when the run fails.
- `executePostWorkflow` (`src/engine/post-workflow.ts:97-152`) is the
  second scheduler: `collectPostWorkflowNodes` selects by presence of
  `run_on` (`:21`), `sortPostWorkflowNodes` re-implements the
  topological sort (`:30`), the completed check runs first (`:119`),
  `gateNode` is never called, and node errors are swallowed so the
  phase always continues.
- `Engine.runWithLock` (`:319-417`) calls it unconditionally after the
  graph, and `--dry-run` (`:172-190`) computes the post-workflow set a
  third time for the plan output.
- The outcome itself exists only as a local boolean passed into
  `executePostWorkflow`; no template, predicate or artifact can read it.
- `isNodeCompleted` (`src/state/state.ts:398-400`) is `status ===
  "completed"` with no notion of which attempt completed it.
- FR-E11 (`documents/requirements-engine/02-nodes-and-models.md:53-84`)
  says "execute regardless of workflow outcome" and says nothing about
  resume. FR-E89 says any node may carry `when:` — which is false for a
  post-workflow node.

### Constraints

- The engine stays domain-agnostic and workflow-independent.
- Existing workflows keep working unchanged. `run_on` and the legacy
  `run_always` stay accepted spellings.
- Resume must not re-run a node whose effects are not idempotent
  merely because it is a post-workflow node. Whatever "re-run on
  resume" means, the workflow author must be able to say it per node.
- TDD per AGENTS.md; every FR-tagged test name starts `FR-E<N> `.
- `deno task check` green before each commit.
- This task overlaps `2026-08-30-explicit-fork-join.md`, which is `in
  progress` in the same modules (`engine.ts` scheduling, `dag.ts`).
  Sequence, do not interleave.

### Affected Surface

Independent enumeration by `surface-scout`, verbatim:

````text
Now compiling the full surface report.

## Surface

- `src/engine/post-workflow.ts:119` — the exact reported line: `if (isNodeCompleted(state, nodeId)) continue;` runs before `run_on` is read, so any post-workflow node already `completed` in a prior attempt is skipped unconditionally on `--resume`, including `run_on: always` nodes — evidence: `src/engine/post-workflow.ts:97-152` (`executePostWorkflow`).
- `src/engine/post-workflow.ts:1-11` (module docstring) — describes post-workflow semantics without mentioning resume behavior; would need updating alongside any fix to state the intended `always` × resume contract.
- `src/state/state.ts:398-400` — `isNodeCompleted(state, nodeId)` is the single predicate both call sites share; its definition (`status === "completed"`) is the root of the ambiguity, since it carries no notion of "completed in a prior attempt" vs "completed in this attempt".
- `src/engine/engine.ts:481-491` (`runNodes`, resume-skip for regular DAG nodes) — parallel/sibling gating pattern: `if (isNodeCompleted(this.state, id)) satisfied.add(id);` treats a previously-completed node as satisfied without ever re-running it on resume, unconditionally, for ALL regular DAG nodes. This is architecturally the same completed→skip idiom as the post-workflow bug, but for regular nodes there is no `always` concept to reconcile against — flagged as a parallel implementation, not necessarily itself broken. Evidence for why it's a genuine sibling, not a false hit: it is the only other unconditional `isNodeCompleted(...) → skip` gate in the engine.
- `src/engine/engine.ts:319-417` (`runWithLock`) — sole caller/producer feeding `executePostWorkflow`: builds `postWorkflowNodeIds` (line 369-373), threads `this.state` (carrying resume history) into `executePostWorkflow` at line 407-417. Any change to the function's contract (e.g. adding a `rerunCompletedAlways`/resume flag) must be wired here.
- `src/engine/engine.ts:212-280` (resume state load) — populates `this.state` from `replayRunJournal` before `runWithLock` runs; this is the producer of the "already completed" status that `post-workflow.ts:119` reads. Any semantic change to what "completed" means for `always` nodes on resume touches this state hydration path, not just the consumer check.
- `src/engine/engine.ts:172-190` (`--dry-run` plan) — separately computes `postWorkflowNodeIds`/`runOnMap` and calls `this.output.dryRunPlan(...)`; a parallel/duplicated computation of the run_on grouping used only for the dry-run report, not gated by resume state (dry-run has no `--resume` state) — worth checking it doesn't also need a "will re-run on resume" annotation if the fix adds resume-aware semantics.
- `src/output.ts:220-226` (`dryRunPlan`) — consumer/renderer of the `run_on` map produced above; prints `(run_on: <condition>)` per post-workflow node. Would need updating if resume-vs-fresh distinction becomes visible in the dry-run plan output.
- `src/config/config.ts:1403-1409` (`mergeDefaults`, legacy normalization) — normalizes `run_always: true` → `run_on: "always"`. If the semantic fix redefines what `always` means (e.g. "always, including resume"), this is the single place that manufactures `run_on: "always"` from the legacy boolean, so the new semantics apply uniformly to both spellings.
- `src/config/config.ts:874-880` (`validateNode`) — validates the `run_on` enum values; not currently affected, but is the config-time gate any new value/flag on `NodeConfig` (e.g. `rerun_on_resume`) would need a matching entry in.
- `src/config/config.ts:385` — `run_on` listed among fields copied/allowed at node level (context for where a new sibling field like `rerunCompletedAlways` would need registering if expressed as YAML rather than only an internal engine flag).
- `src/types.ts:322-333` (`NodeConfig.run_on` / `run_always` JSDoc) — the type-level contract describing `run_on` semantics; doesn't mention resume at all today. A new field or redefinition of `always` needs a JSDoc update here, and `run_always` (legacy) needs the same resume semantics applied since it normalizes into `run_on`.
- `src/engine/loop.ts:349-395` (`runLoop`, body-node skip logic) — separate `markNodeSkipped` call site for loop body nodes gated by `when`/gated-input; does not use `isNodeCompleted`/`run_on` at all — checked and confirmed NOT part of this surface (loop bodies have no `run_on` concept), but was probed because it is a sibling "skip node" implementation in the same module family.
- `src/engine/node-lifecycle.ts:104-113` (`nodeSkipped`) — the shared async wrapper both `post-workflow.ts` (via `nodeSkipped: (nodeId) => this.nodeSkipped(nodeId)`) and the main scheduler use to mark+journal a skip; any change to how post-workflow nodes get skipped vs. re-run must still call through this for journal consistency.
- `.flowai-workflow/github-inbox/workflow.yaml:191` — bundled dogfood workflow's `run_on: always` node (`tech-lead-review` per requirements doc reference, and per the report the "account" node conceptually maps to this class) — a producer of the exact runtime condition described in the bug report.
- `.flowai-workflow/github-inbox-opencode/workflow.yaml:178` — same `run_on: always` pattern, duplicated per-variant workflow config (OpenCode variant).
- `.flowai-workflow/autonomous-sdlc/workflow.yaml:162` — same `run_on: always` pattern, duplicated in the third bundled workflow variant. All three are parallel/duplicated copies per `AGENTS.md`'s documented "Drift caveat" (agent prompts and workflow node config are intentionally duplicated per workflow folder).
- `.flowai-workflow/github-inbox/agents/agent-tech-lead-review.md:83`, `.flowai-workflow/github-inbox-opencode/agents/agent-tech-lead-review.md:83`, `.flowai-workflow/autonomous-sdlc/agents/agent-tech-lead-review.md:153` — three duplicated agent-prompt copies each documenting "`run_on: always`: This node runs regardless of ... outcome" without mentioning resume; consumers of the semantic contract that would go stale if `always` redefined.
- `scripts/generate-dashboard.ts:98-101,349,555-563` — dashboard consumer that independently re-derives "always" nodes by re-parsing `state.config_path` YAML and checking `nodeConfig?.run_on === "always"` (a second, parallel implementation of `run_on === "always"` detection, separate from `collectPostWorkflowNodes`/`executePostWorkflow` in the engine) — used only for badge/status grouping, but is a genuine duplicate of the `run_on` selection logic living outside `src/engine/`.
- `scripts/workflow-diagram.ts:98,201,340,719,865,1089` — a second, independent consumer/renderer of `run_on`, used for the visual DAG diagram (edge styling `class: "edge post"`, Mermaid dashed arrows `-.->` for post-workflow nodes, node trait labels `run on <value>`). Does not read run state/resume, but any redefinition of what counts as a "post-workflow" node changes what this renders.
- `scripts/workflow-diagram_test.ts` — tests for the diagram script; would need checking/updating if `run_on` collection/labeling logic changes shape.
- `documents/requirements-engine/02-nodes-and-models.md:53-84` (FR-E11) — SRS section defining `run_on` semantics; explicitly states "execute regardless of workflow outcome" for `always` with NO mention of resume behavior — this is the requirements-level gap matching the reported bug, and the natural place to record whatever "always × resume" semantics get chosen.
- `documents/requirements-engine/00-meta.md:44` — one-line summary "Post-workflow nodes with `run_on` config execute based on outcome" — same gap, higher-level doc.
- `documents/design-engine/01-engine-modules-core.md:19,54-57,111-113` — SDS describing `run_on` type, `validateNode` message, and `run_always` normalization; consumer of the same contract, needs to match any behavior change.
- `documents/design-engine/02-engine-modules-flow.md:102,128,318-325` — SDS describing `executePostWorkflow` filtering logic and the post-workflow section of the dry-run plan; the most detailed existing description of the mechanism the reported bug lives in — direct doc consumer of any fix.
- `documents/design-engine/04-data-and-logic.md:58-60,240-250,339` — SDS describing `collectPostWorkflowNodes()`, `sortPostWorkflowNodes()`, and the per-`run_on`-value filter algorithm (`"always"` → execute unconditionally, `"success"`/`"failure"` → conditional skip) — this is the algorithmic description that is now inaccurate w.r.t. resume and is the doc most directly falsified by the bug.
- `documents/design-engine/06-non-functional-and-constraints.md:9-11` — documents `on_failure_script` hook firing "only when `workflowSuccess === false`"; adjacent fault-tolerance doc for the same module, worth checking for resume-accuracy too (hook re-fires on resume of a failed prior attempt — not clearly specified either).
- `src/engine/engine_test.ts:1230-1400+` — existing `FR-E34`/post-workflow tests all construct `state` fresh via `createRunState(...)` with no node pre-marked `completed`; none of the current test suite exercises the resume scenario (state where the post-workflow node's status is already `"completed"` going into `executePostWorkflow`) — this is the coverage gap that let the reported bug through, and the natural RED-test location for a fix.
- `src/state/state_test.ts:238-244` — unit test for `isNodeCompleted` itself; would need a new case only if the predicate's contract changes (e.g. adding an "attempt" dimension) rather than just its call sites.
- `README.md` — contains `run_on` documentation (found via grep, not yet opened) for the public-facing overview; per Documentation Hierarchy rule 5 ("Derived from AGENTS.md + SRS + SDS"), likely needs a matching update if semantics change.
- `plugin-src/shared/skills/scaffold/references/workflow-schema.md` and `.claude/skills/flowai-workflow-setup/SKILL.md` — both contain `run_on` schema/usage documentation surfaced to end users scaffolding new workflows via the `scaffold` skill; independent consumer copies of the `run_on` contract, found by grep but not yet opened for exact line content.
- `documents/tasks/2026-08-16-borrowed-graph-features.md`, `documents/competitors.md`, `documents/rnd/workflow-report.md` — grep hits for `run_on`; not yet opened, likely background/competitive-research mentions rather than normative spec, but flagged as unexamined.
- `documents/requirements-sdlc/00-meta.md`, `01-workflow-stages.md`, `02-workflow-integration.md`, `05-dashboard-and-observability.md`, `06-quality-and-validation.md`, `documents/design-sdlc/00-intro.md`, `01-agents-and-hitl.md`, `02-dashboard-and-validation.md`, `03-init-data-logic.md` — grep hits for `run_on` in the SDLC-scope SRS/SDS; not yet opened. Relevant because the reported `account` node (which "counts what the run read/delivered") is itself an SDLC-workflow-level concern (dogfood workflow node), so the SDLC-scope docs describing dashboard/observability of `run_on: always` nodes may also need updates.
- `documents/tasks/2026/05/node-lifecycle-callback.md`, `documents/tasks/2026/05/config-split.md`, `documents/tasks/2026/05/engine-decomposition.md` — historical decision-task files mentioning `run_on`/post-workflow; not yet opened, candidates for containing prior design rationale relevant to "why the check is ordered this way" (worth reading before deciding a fix, per the peer's own uncertainty about whether `always` should just mean "every time including resume").

## Queries used
- `grep -rn "executePostWorkflow"` / `"run_on"` across `src`, `scripts`, `documents`, `.flowai-workflow`, root markdown files
- `grep -rn "isNodeCompleted\|markNodeSkipped"` across `src` (non-test and test)
- Read `src/engine/post-workflow.ts`, `src/engine/engine.ts` (full), `src/engine/node-lifecycle.ts` (full)
- Read `src/engine/loop.ts:350-400`, `src/state/state.ts:350-410` (definitions of `isNodeCompleted`/`markNodeSkipped`/`getResumableNodes`)
- `grep -n "run_on"` in `.flowai-workflow/*/workflow.yaml`, `.flowai-workflow/*/agents/agent-tech-lead-review.md`
- `grep -n "run_on"` in `scripts/workflow-diagram.ts`, `scripts/generate-dashboard.ts`, `src/config/config.ts`, `src/types.ts`, `src/output.ts`
- Read `src/types.ts:300-340`, `src/config/config.ts:1340-1415` (run_always normalization), `documents/requirements-engine/02-nodes-and-models.md` FR-E11 section, `documents/design-engine/*.md` run_on/post-workflow mentions
- Read `src/engine/engine_test.ts:1230-1400` (existing FR-E34 post-workflow tests)
- `grep -rln "run_on\|post-workflow\|PostWorkflow" documents/tasks/2026/*/*.md`
- `grep -n "isNodeCompleted" src/state/state_test.ts`
- `grep -n "post-workflow\|run_on\|FR-E11" CHANGELOG.md`

## Not examined (budget)
- `README.md` — grep-confirmed to mention `run_on` but not opened for exact lines/content.
- `plugin-src/shared/skills/scaffold/references/workflow-schema.md`, `.claude/skills/flowai-workflow-setup/SKILL.md` — grep-confirmed hits, not opened.
- `documents/tasks/2026-08-16-borrowed-graph-features.md`, `documents/competitors.md`, `documents/rnd/workflow-report.md` — grep hits, not opened.
- `documents/requirements-sdlc/*.md`, `documents/design-sdlc/*.md` (the 8 files listed above with `run_on` hits) — not opened, only confirmed present via grep.
- `documents/tasks/2026/05/node-lifecycle-callback.md`, `config-split.md`, `engine-decomposition.md` — not opened; may contain prior rationale for the check ordering.
- `scripts/workflow-diagram_test.ts` — not opened, only confirmed to exist via directory listing hit under the run_on grep.
- `src/config/config_test.ts` — grep-confirmed to reference `run_on` (regression tests per FR-E11 acceptance criteria) but not opened to see exact test cases, which is relevant for the "check remaining similar problems" ask.
- `scripts/generate-dashboard.ts` and `scripts/workflow-diagram.ts` beyond the grepped line numbers — not fully read; there may be additional resume-state-dependent rendering logic (e.g. how the dashboard currently renders a resumed `always` node's stale-looking status) not surfaced by the grep pattern alone.
- `src/mcp/` — not searched for `run_on`/post-workflow references; the MCP server exposes `get_state`/`tail_artifacts` which could surface post-workflow node status to the `supervisor` agent and merits a check for resume-semantics assumptions.

## Could not rule out
- Whether the MCP tool layer (`src/mcp/`) or the `resume_node`/`get_state` tools surface any resume-vs-run_on assumption to the `supervisor` agent (per AGENTS.md's MCP-first FR-E84/E85 description) — not grepped/read, flagged as a plausible consumer of post-workflow completion state that a fix could affect, given the supervisor polls `get_state` to decide whether a run's post-workflow phase is done.
- Whether `src/state/run-journal.ts` (`replayRunJournal`) reconstructs any per-attempt/per-invocation marker (distinct from plain `status`) that a resume-aware fix could reuse instead of adding a new flag — only its call sites were seen (`engine.ts:256`), not its internals.````

Dispositions over the union of that report and my own enumeration. DoD
item numbers refer to the list below; the Solution that will satisfy
them is chosen after variant selection.

- `src/engine/post-workflow.ts` (whole module: `collectPostWorkflowNodes`, `sortPostWorkflowNodes`, `executePostWorkflow`, the `:119` completed check, the module docstring) — covered-by DoD 1, 3, 4, 5.
- `src/engine/engine.ts:319-417` (`runWithLock`, the unconditional post-workflow call and the `postWorkflowNodeIds` it builds) — covered-by DoD 1.
- `src/engine/engine.ts:481-491` (`runNodes` readiness gate, the sibling `isNodeCompleted → satisfied` idiom) — covered-by DoD 1 and 4; it becomes the single scheduler, so its resume semantics are the ones under test.
- `src/engine/engine.ts:212-280` (resume state load, `replayRunJournal`) — covered-by DoD 4: it produces the "already completed" status the fix reinterprets.
- `src/engine/engine.ts:172-190` + `src/output.ts:220-226` (`--dry-run` plan and its renderer) — covered-by DoD 6.
- `src/engine/gateNode` / FR-E89 `when:` evaluation (`engine.ts:587,617`) — covered-by DoD 1; making it reachable from post-workflow nodes is the point of the change.
- `src/state/state.ts:398-400` (`isNodeCompleted`) and `src/state/state_test.ts:238-244` — covered-by DoD 4. Whether the predicate gains an attempt dimension or the caller does is a variant-level decision.
- `src/state/run-journal.ts` (`replayRunJournal` internals — scout could not rule it out) — covered-by DoD 4; the plan inspects it before choosing where the attempt boundary lives, because a per-attempt marker already in the journal would remove the need for a new one.
- `src/engine/node-lifecycle.ts:104-113` (`nodeSkipped`) — covered-by DoD 1: one scheduler means one skip-and-journal path.
- `src/config/config.ts:1403-1409` (`run_always` → `run_on: always`) and `:874-880`, `:385` (enum validation, node-key allowlist) — covered-by DoD 3: the legacy spelling desugars into the same general form as `run_on`, and `validateNode`'s enum gains `every_attempt`.
- `src/types.ts:322-333` (`NodeConfig.run_on` / `run_always` JSDoc) — covered-by DoD 3 and 8.
- `src/config/template.ts:279-354` (`validateTemplateVars`) and its call sites in `src/config/config.ts:623,653,707,838,854,864,1721` — covered-by DoD 2. Found by the critic, missed by both the scout and me: the prefix switch is closed and ends in `Unknown template variable prefix`, so `{{run.*}}` is a config-load error until the validator learns the prefix.
- The 17 `: TemplateContext = {` object literals under `src/` — covered-by DoD 2: a new required member of the interface breaks every full literal, the same blast radius AGENTS.md records for `RuntimeCapabilities`.
- `src/engine/loop.ts:349-395` (loop-body skip path) — not affected — loop bodies carry no `run_on` and are scheduled by `buildLoopBodyOrder`, a traversal the level executor never enters. Confirmed by the scout on the same evidence.
- `src/engine/human.ts`, `src/hitl/hitl.ts` — not affected — neither reads `run_on` nor the post-workflow set; they are scheduled by the same dependency map as any other node.
- `src/mcp/` (`get_state`, `tail_artifacts`, `resume_node` — scout could not rule out) — covered-by DoD 7. Inspected: `get_state` returns the whole `RunState` produced by `replayRunJournal` (`src/mcp/mcp-server.ts:11`), so it needs no tool-level change — but the new per-node outcome marker and the run attempt counter only reach it if they travel as journal facts, which is what DoD 7 requires.
- `src/engine/engine_test.ts:1230-1400+` (FR-E34 post-workflow tests, none exercising resume) — covered-by DoD 1-5; this is the RED location.
- `src/config/config_test.ts` (`run_on` regression tests per FR-E11) — covered-by DoD 3.
- `scripts/generate-dashboard.ts:98-101,349,555-563` — covered-by DoD 6: a second, independent `run_on === "always"` derivation outside the engine.
- `scripts/workflow-diagram.ts:98,201,340,719,865,1089` and `scripts/workflow-diagram_test.ts` — covered-by DoD 6: a third derivation, and the renderer whose "post-workflow" edge class stops matching if the selection rule moves.
- `.flowai-workflow/{github-inbox,github-inbox-opencode,autonomous-sdlc}/workflow.yaml` (`run_on: always` on `tech-lead-review`) — covered-by DoD 3 and 4. These are the nodes whose non-idempotent effect (merging a pull request) makes "re-run on every resume" unacceptable as a blanket rule.
- `.flowai-workflow/*/agents/agent-tech-lead-review.md` (three copies documenting `run_on: always`) — covered-by DoD 8.
- `documents/requirements-engine/02-nodes-and-models.md:53-84` (FR-E11) and `00-meta.md:44` — covered-by DoD 8.
- `documents/requirements-engine/08-graph-and-isolation.md` (FR-E89 "any node may carry `when:`") — covered-by DoD 1 and 8; the claim is false today and becomes true.
- `documents/requirements-engine/01-execution-model.md:151` (FR-E34 `on_error` vs `on_failure_script`) — covered-by DoD 5.
- `documents/design-engine/01-engine-modules-core.md`, `02-engine-modules-flow.md`, `04-data-and-logic.md`, `06-non-functional-and-constraints.md:9-11` — covered-by DoD 8. `04-data-and-logic.md:240-250` is the algorithm description the reported bug falsifies; `06`'s `on_failure_script` re-fire on resume is the same unspecified question and is decided with it.
- `README.md`, `plugin-src/shared/skills/scaffold/references/workflow-schema.md`, `.claude/skills/flowai-workflow-setup/SKILL.md` — covered-by DoD 8: user-facing copies of the `run_on` contract.
- `documents/requirements-sdlc/*.md`, `documents/design-sdlc/*.md` (8 files with `run_on` hits, unopened by the scout) — deferred — human choice. SDLC-scope docs describe dashboard observability of `always` nodes; whether this change reaches them is decided once the engine-side shape is picked.
- `documents/tasks/2026/05/{node-lifecycle-callback,config-split,engine-decomposition}.md` — not affected — inspected: none records a rationale for the completed-check ordering. `node-lifecycle-callback.md:38,181-183,209` only lists post-workflow skips as a lifecycle call site, `config-split.md:23,51` names the `run_always` normalization as one concern to split out, and `engine-decomposition.md:27,34,96` proposes moving post-workflow into its own collaborator.
- `documents/competitors.md`, `documents/rnd/workflow-report.md`, `documents/tasks/2026-08-16-borrowed-graph-features.md` — not affected — R&D references and a historical task record; grep hits on `run_on` are descriptive, not normative.
- `2026-08-30-explicit-fork-join.md` (in progress, same modules) — deferred — human choice: sequencing between the two tasks is a scheduling decision, recorded under Follow-ups.

## Definition of Done

- [x] **DoD 1** FR-E99 — a node carrying `run_on` is scheduled by `Engine.runNodes` and
      passes through `Engine.gateNode`, so `when:` (FR-E89) decides it like any
      other node. `executePostWorkflow` and `sortPostWorkflowNodes` are gone.
      Test: `src/engine/outcome-wave_test.ts::FR-E99 when gates a run_on node`.
      Evidence: `deno task check`.
- [x] **DoD 2** FR-E99 — the run outcome is a value: `{{run.outcome}}`
      (`pending | success | failure`) and `{{run.attempt}}` resolve in prompts
      and in `when:` predicates, and pass config-load validation.
      Test: `src/engine/outcome-wave_test.ts::FR-E99 run outcome resolves in a
      template and in a predicate`, `src/config/template_test.ts::FR-E99 run is
      a known template prefix`.
      Evidence: `deno task check`.
- [x] **DoD 3** FR-E11 — `run_on: always | success | failure` and the legacy
      `run_always: true` keep their present meaning, resume included; all are
      evaluated in `gateNode` against the outcome value. A fourth value,
      `run_on: every_attempt`, is accepted by `validateNode` and rejected
      nowhere else.
      Test: `src/engine/outcome-wave_test.ts::FR-E11 run_on filters against the
      run outcome`, `src/config/config_test.ts::FR-E11 run_always normalizes to
      run_on always`, `src/config/config_test.ts::FR-E11 every_attempt is a
      valid run_on value`.
      Evidence: `deno task check`.
- [x] **DoD 4** FR-E11 — resume: a node with `run_on: every_attempt` is reconsidered on
      every attempt and runs again whatever the outcome was last time; a node
      with `always`, `success` or `failure` that already completed is left
      alone, so `tech-lead-review` never attempts a second merge. A node that
      already completed in the CURRENT attempt is not re-entered.
      Test: `src/engine/outcome-wave_test.ts::FR-E11 resume re-runs an
      every_attempt node`, `src/engine/outcome-wave_test.ts::FR-E11 resume
      leaves a completed always node alone`, `src/engine/outcome-wave_test.ts::FR-E11
      an every_attempt node is not re-entered within one attempt`.
      Evidence: `deno task check`.
- [x] **DoD 4a** FR-E89 — an `every_attempt` node reaches `gateNode` on each attempt, so
      `when:` over `{{run.attempt}}` and `{{run.outcome}}` composes with it:
      `run_on: every_attempt` plus `when: '[ "{{run.outcome}}" = "failure" ]'`
      means "every attempt, but only while the run is failing".
      Test: `src/engine/outcome-wave_test.ts::FR-E89 when composes with
      every_attempt`.
      Evidence: `deno task check`.
- [x] **DoD 5** FR-E34 — a failing outcome-wave node is recorded as `node_failed` and
      named in the summary instead of being swallowed; it does not overwrite the
      run outcome the wave was gated on, and it does not stop its siblings.
      `on_failure_script` fires once per attempt, before the wave, when the
      outcome is failure — including in a workflow with no `run_on` node at all,
      which today returns before the hook (`post-workflow.ts:112`).
      Test: `src/engine/outcome-wave_test.ts::FR-E34 a failed outcome-wave node
      is journalled and does not stop its siblings`,
      `src/engine/outcome-wave_test.ts::FR-E34 the failure hook fires with no
      run_on nodes present`.
      Evidence: `deno task check`.
- [x] **DoD 5a** FR-E99 — the two gates an outcome-wave node did not pass through before
      now apply to it, and both are deliberate: `--skip` / `--only` select it
      like any other node, and a node whose input was `when:`-skipped is skipped
      rather than run against missing artifacts.
      Test: `src/engine/outcome-wave_test.ts::FR-E99 --only selects an
      outcome-wave node`, `src/engine/outcome-wave_test.ts::FR-E99 an
      outcome-wave node downstream of a skipped input is skipped`.
      Evidence: `deno task check`.
- [x] **DoD 6** FR-E99 — the post-workflow set is derived once. `--dry-run`, the dashboard
      and the diagram call `collectPostWorkflowNodes` instead of re-deriving it;
      ordering comes from `buildDependencies`, not from a second topological
      sort.
      Test: `scripts/generate-dashboard_test.ts::FR-E99 always-node set comes
      from the engine helper`, `scripts/workflow-diagram_test.ts::FR-E99
      post-workflow nodes come from the engine helper`.
      Evidence: `deno task check`.
- [x] **DoD 7** FR-E99 — the run attempt counter, the run's current outcome and the
      attempt in which each outcome-wave node last completed are journal facts,
      so `replayRunJournal` restores them and the MCP `get_state` tool tells
      "completed in an earlier attempt" apart from "already re-ran in this one".
      A journal written before this change replays with `attempt: 1`.
      Test: `src/state/lifecycle-replay_test.ts::FR-E99 attempt counter and
      per-node attempt stamp survive replay`,
      `src/mcp/mcp-server_test.ts::FR-E99 get_state distinguishes a re-run
      outcome-wave node` (a run on attempt 2 whose node last completed in
      attempt 1).
      Evidence: `deno task check`.
- [x] **DoD 8** Docs — FR-E99 added to the engine SRS as
      `documents/requirements-engine/12-run-outcome.md` with `Acceptance
      criteria`, matching the row already registered in `documents/index.md`;
      FR-E11 and `requirements-engine/00-meta.md:44` gain `every_attempt` and
      the resume semantics;
      FR-E89's "any node" claim becomes true; FR-E34 gains the outcome-wave
      precedence and the hook's independence from `run_on`; the SDS sections
      describing `executePostWorkflow` are rewritten, `01-engine-modules-core.md`
      and `06-non-functional-and-constraints.md` included; `README.md`, the three
      bundled agent prompts, the scaffold schema reference and
      `.claude/skills/flowai-workflow-setup/SKILL.md` match.
      Evidence: `deno task check` (`FR Canonical Field Set`, `Docs Token
      Budget`). Manual — korchasa.

## Solution

Variant 2, with the MCP surface included and the resume rule settled as
`run_on: every_attempt` — a fourth value on the existing field rather than a
new field, safe by default, and the thing that makes the `when:` escape hatch
reachable.

The design in one sentence: **a post-workflow node stops being a phase and
becomes a node whose gate reads the run's outcome.** There is one scheduler,
`runNodes`, run twice — once over the graph, once over the nodes that wait on
the outcome — and one gate, `gateNode`, which now evaluates `run_on` next to
`when:`. The outcome and the attempt number stop being locals and become
values a predicate or a prompt can read.

Each step is its own RED → GREEN → REFACTOR → CHECK cycle.

**Step 1 — the run attempt is a fact.** Add journal event
`run_attempt_started { attempt }`, emitted by `runWithLock` on every
invocation including the first, before the FR-E47 budget check. `run_started`
stays fresh-run only, so resume keeps emitting no bootstrap. Extend
`applyJournalEvents` (`src/state/run-journal.ts:325`) to set
`RunState.attempt`; a journal without the event replays as `attempt: 1`.
Add `attempt?: number` to `RunState` (`src/types.ts:760`).

**Step 2 — the outcome is a value.** Add
`run: { outcome: "pending" | "success" | "failure"; attempt: number }` to
`TemplateContext` (`src/types.ts:793`) and fill it in `Engine.buildContext`
(`src/engine/engine.ts:1321`) from a new private `this.runOutcome` and
`this.state.attempt`. It is always present, so `interpolate` never throws on
`{{run.*}}`; during the graph wave it reads `pending`. Two consequences the
first draft missed, both found by `plan-critic`: `validateTemplateVars`
(`src/config/template.ts:279-354`) switches on a closed prefix list and ends
in `Unknown template variable prefix`, so it must learn `run` with
`outcome`/`attempt` as its only properties, or every `{{run.*}}` is a
config-load error; and a new REQUIRED interface member would break all 17
`: TemplateContext = {` literals under `src/`. Resolved by making `run`
optional, the way `loop` and `branch` already are: the engine always fills it,
a bare literal does not, and `{{run.*}}` outside a run context throws
`used outside a run context` instead of resolving to a guess. The 17 literals
are untouched. `evaluateShellPredicate` needs no change — it interpolates the same
context.

**Step 3 — one gate.** Move the `run_on` filter into `Engine.gateNode`
(`:588`), after the `--skip`/`--only` and gated-input checks and before the
`when:` predicate, comparing `node.run_on` against `this.runOutcome`;
`always` and `every_attempt` pass any outcome, `success` and `failure` must
match. A
`run_on` node reached while the outcome is still `pending` is an engine bug
and throws rather than guessing. `gateNode` already records the skip through
`nodeSkipped`, so the bespoke `markNodeSkipped` branches disappear with the
old function.

**Step 4 — one scheduler, two waves.** Give `runNodes` an options argument
`{ continueOnFailure?: boolean; outcomeWave?: boolean }`. In `runWithLock`
(`:319`): run the graph wave as today, compute `workflowSuccess`, set
`this.runOutcome`, call `runFailureHook` when the outcome is failure, then
call `runNodes(postWorkflowNodeIds, { continueOnFailure: true, outcomeWave: true })`.
`continueOnFailure` makes a node's failure stop that node only — the `failed`
flag no longer ends the loop — which reproduces today's "post-workflow
failures do not block finalization" without swallowing the error message.
Delete `executePostWorkflow` and `sortPostWorkflowNodes`; ordering inside the
wave comes from the same `buildDependencies` map the graph wave uses, and a
post-workflow node naming a graph node in `inputs:` is already handled by the
existing `!scheduled.has(dep)` clause (`:519`).

Three behaviours change as a consequence, and each is intended rather than
incidental (DoD 5 and 5a): `--skip` / `--only` start applying to outcome-wave
nodes, which `executePostWorkflow` never consulted; the FR-E89 gated-input
rule starts applying to them, so one downstream of a `when:`-skipped node is
skipped instead of run against artifacts that do not exist; and
`on_failure_script` starts firing in a workflow that declares no `run_on`
node at all, because `post-workflow.ts:112` returns before the hook today —
which contradicts FR-E34, whose text ties the hook to the workflow outcome
and not to the presence of post-workflow nodes.

**Step 5 — the resume rule.** `run_on` gains a fourth value,
`every_attempt`. The three existing values keep meaning "once per run": a
completed node stays satisfied on resume, exactly as today, so nothing in any
existing workflow changes and `tech-lead-review` never merges twice.
`every_attempt` means "reconsidered on every engine invocation" — the literal
reading of the reported request, made opt-in so it cannot surprise a workflow
that did not ask for it.

Mechanically: add `completed_attempt?: number` to `NodeState`, stamped by
`Engine.nodeCompleted` (`:1263`) for outcome-wave nodes before the transition,
so the journal's node snapshot carries it and replay restores it (DoD 7).
`NodeLifecycleMetadata` needs no new member after all:
`buildNodeLifecycleEvent` writes the whole `NodeState` into the event
(`node-lifecycle.ts:141-152`) and replay assigns it back wholesale
(`run-journal.ts` `node_completed` case), so any new state field travels
already. The metadata map is a convenience projection for embedding hosts,
not the persistence path. In `runNodes`, the seeding at `:485` gains one clause for the
outcome wave: a completed node goes to `pending` instead of `satisfied` when
its `run_on` is `every_attempt` AND its `completed_attempt` is not the
current one. The second half of that condition is what stops a node from
re-entering itself inside a single invocation.

`every_attempt` carries no outcome filter of its own — it is `always` in the
outcome dimension. Narrowing it is `when:`'s job, and the two compose:
`run_on: every_attempt` with `when: '[ "{{run.outcome}}" = "failure" ]'`
reads "every attempt, while the run is failing". This is what makes the
escape hatch reachable: opting in is precisely what puts the node back in
front of `gateNode`, which the withdrawn staleness rule never did.

One consequence to document rather than prevent: a re-running node overwrites
its own artifact directory, so the previous attempt's output survives only in
the journal and in `stream.log`.

The first draft used a staleness rule instead — "a node whose consumed run
outcome differs from the current one re-runs" — and `plan-critic` falsified
it on three counts, each confirmed against the code. It re-ran
`tech-lead-review` in a harmful case, because that node decides on CI status
(`.flowai-workflow/github-inbox/workflow.yaml:189`), not on the run outcome,
so a failure-then-success sequence made it attempt a second merge on an
already-merged PR. It missed the reported symptom whenever the resumed run
failed again, since the outcome was then unchanged. And it left `when:`
unreachable, because `runNodes` puts a completed node straight into
`satisfied` (`src/engine/engine.ts:485-491`) and never calls `gateNode` for
it, so a predicate could only suppress a re-run, never cause one.

**Step 6 — one derivation.** `--dry-run` (`:172-190`) keeps
`collectPostWorkflowNodes` for the partition and drops the second sort.
`scripts/generate-dashboard.ts:555-563` and `scripts/workflow-diagram.ts`
import `collectPostWorkflowNodes` instead of re-testing `run_on` themselves.

**Step 7 — docs.** New SRS section file
`documents/requirements-engine/12-run-outcome.md` for FR-E99 — the existing
files sit near the 29 920-byte cap and take no more — registered in
`documents/index.md` at the anchor the row already points to. FR-E11 gains the fourth
`run_on` value and the resume rule chosen in Step 5; FR-E89 loses its false "any node" caveat;
FR-E34 gains the outcome-wave precedence and the hook's independence from
the presence of `run_on` nodes; `requirements-engine/00-meta.md:44` follows
FR-E11. On the SDS side `design-engine/02-engine-modules-flow.md` and
`04-data-and-logic.md` lose the `executePostWorkflow` narrative,
`01-engine-modules-core.md` follows the `run_on` type and the `run_always`
normalization, and `06-non-functional-and-constraints.md:9-11` states when
`on_failure_script` fires. User-facing copies: `README.md`, the three
`agents/agent-tech-lead-review.md` copies,
`plugin-src/shared/skills/scaffold/references/workflow-schema.md` and
`.claude/skills/flowai-workflow-setup/SKILL.md`.

**Verification.** `deno task check` after every step. Plus one end-to-end
check on a real fixture: run a two-node workflow whose graph fails and whose
`run_on: always` node writes a file, confirm the file is written; resume with
the graph fixed and confirm the node runs a second time; resume again with the
graph still failing and confirm it does not.

**Sequencing.** `2026-08-30-explicit-fork-join.md` is `in progress` in
`engine.ts` and `dag.ts`. This task starts after that one's DoD is closed.

## Follow-ups

- Sequencing against `2026-08-30-explicit-fork-join.md`, which is `in
  progress` in the same scheduling modules.
- `documents/requirements-sdlc/*.md` and `documents/design-sdlc/*.md` mention
  `run_on` in dashboard and observability sections; whether they need the new
  semantics is deferred until the engine change lands.
