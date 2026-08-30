---
date: "2026-08-30"
status: in progress
implements: [FR-E95, FR-E96, FR-E97, FR-E37, FR-E90, FR-E91]
tags: [engine, graph, parallelism, isolation]
related_tasks:
  - 2026-08-16-borrowed-graph-features.md
  - 2026/05/config-split.md
---
# Explicit fork/join with captured answers

## Goal

Make splitting and merging of execution flows something the workflow author
writes down, instead of something the engine infers from edges. Take the
Claude Code Workflow tool as the model: the barrier is authored, a branch
returns an answer, and a failed branch does not necessarily kill its
siblings. Keep one worktree per run as the default isolation unit, make the
split expressible by an agent at runtime, and make the whole thing work for
branches that edit code, not only for branches that judge.

## Overview

### Context

`documents/competitors.md` compared this engine against its peers by what
each isolates. The finding: no orchestrator in this class merges branch
filesystems automatically. Peers whose branches produce data isolate only
the agent context; peers whose branches produce source edits isolate the
tree and pay for an authored join — git merge plus gates in Bernstein, a
declared-effects transaction in pi-taskflow, a pull request in Baton.

Four gaps follow for this engine:

- Fork and join have no syntax. A fork is two nodes sharing an `inputs:`
  value; a join is a node listing several inputs. Neither is named, so
  neither can carry a failure mode, a member list, or a write contract.
- The barrier is not authored. `executeLevel` waits for the whole DAG
  level, so a one-node branch waits for a three-node sibling. In the CC
  Workflow model that is `parallel()` where `pipeline()` was wanted, and it
  is unavoidable today.
- A node's product is always files. The agent's final answer is truncated
  to 400 characters by `resultExcerpt` and is not addressable from a
  template, so a branch that only needs to return a verdict must invent a
  file for it.
- The split is authored, not discovered. `for_each` (FR-E90, one day old)
  reads a list of strings an earlier node wrote, but every item runs the
  same single node, and an item cannot carry its own instructions.

This work is the direct successor of `2026-08-16-borrowed-graph-features.md`,
which landed FR-E87..FR-E93. It resolves proposal P2 in
`documents/requirements-engine/00-meta.md`, whose phase 3 ("merge
semantics") listed disjoint `allowed_paths` enforcement with fail-fast
overlap detection as one of three options — the option chosen here.

### Decisions taken before planning

1. Flat graph. `fork` and `join` are per-node fields; node ids stay bare.
2. Input-driven scheduling lands in the same task as the syntax, not after.
3. Inside a fork group the `allowed_paths` default is inverted, and
   overlapping write scopes are refused before any branch starts.
4. A branch's product is its captured answer. The engine does not parse it:
   a verdict and a unified diff travel the same way. Applying patches is a
   `command` node the workflow author writes. The engine documents
   `git add -A -N . && git diff` as the capture command for a code-editing
   branch, because a bare `git diff` reports tracked modifications only and
   drops every file the branch created — `src/isolation/scope-check.ts:36-38`
   needs a second `git ls-files --others` command for exactly that reason.
5. No new git call sites in the engine. Engine-side patch harvesting and
   applying was rejected — it is strictly more engine code and saves only
   workflow lines, so the "if it substantially simplifies the
   implementation" condition is not met. `2026/05/remove-git-from-engine.md`
   stays in force.
6. `for_each` is removed; `fork` is the only branching construct, and a
   group without a join is a config-load error.
7. Isolation is derived, not configured: a branch that declares
   `allowed_paths` gets a worktree of its own, a branch without one writes
   nothing and runs in the shared tree.
8. No `type: worker`. Answer capture is a property of every node; the
   no-write contract comes from fork-group membership.

### Target syntax

```yaml
  # static branch — declared once, on the branch's entry node
  refactor:
    type: agent
    inputs: [plan]
    fork: work.refactor          # "<group>.<branch>"
    allowed_paths: ["src/api/**"]
    prompt: "..."
    # `-N` stages new files as intent-to-add, so `git diff` reports them too;
    # a bare `git diff` would silently drop every file the branch created.
    after: "git add -A -N . && git diff"   # stdout becomes this node's answer

  refactor-check:
    type: command
    inputs: [refactor]           # branch inherited through the edge
    command: "deno task check"

  # dynamic branches — one node expands into N, list produced at runtime
  do:
    type: agent
    inputs: [split]
    fork:
      group: work
      branches: "{{input.split}}/tasks.json"   # JSON array of objects
      key: value.id
      max_concurrent: 3
    allowed_paths: ["{{branch.value.paths}}"]
    prompt: "{{branch.value.prompt}}"
    after: "git add -A -N . && git diff"

  integrate:
    type: command
    join: work
    failure_mode: collect
    command: |
      for p in {{node_dir}}/branches/*/*.answer; do git apply --3way "$p"; done
```

### Current State

- `src/engine/dag.ts` — `buildLevels` topologically sorts into levels;
  `topoSort` returns `string[][]`.
- `src/engine/engine.ts` — `executeLevel` runs one level and waits for all
  of it. `executeLevelWithLevelGuardrail` wraps a concurrent level in one
  FR-E50 bracket (FR-E91). `executeForEach` fans out one node and reports a
  single verdict; item answers are collected nowhere.
- `src/engine/for-each.ts` — `parseForEachSource` accepts a JSON array of
  strings or numbers and rejects objects; `itemContext` composes
  `<node_dir>/<key>`; `ForEachItem.value` is a string.
- `src/engine/agent.ts` — the `after` hook runs through `runShellCommand`
  and its stdout is discarded (`agent.ts:607-621`). `allowed_paths` drives
  the FR-E37 scope check only when the field is present (`agent.ts:300`);
  absent means no check at all.
- `src/config/config.ts` — `NODE_CONFIG_KEYS` allowlist plus `validateNode`;
  `validateForEach` and `validateIsolation` are the pattern to follow.
- `src/isolation/worktree.ts` — `createNodeWorktree` keys a worktree by node
  id (`worktreeKey(nodeId, itemKey?)`), so a two-node branch would get two
  trees and the second could not see the first's edits.
- `type: merge` copies input artifact directories into subdirectories. Used
  by no workflow, only by engine tests. `merge_strategy` is declared
  (`src/types.ts:284`) and never read by the engine, but IS read by the
  untracked `scripts/workflow-diagram.ts:332`.
- No workflow uses `for_each` — verified across all four folders under
  `.flowai-workflow/`. All three production graphs are chains that set
  `max_parallel: 2` and never run anything concurrently.
- The agent's full final message survives only inside the per-runtime agent
  log under `<run_dir>/logs/`; `NodeState.result` holds a 3-line excerpt.

### Constraints

- The engine stays domain-agnostic and adds no new `git` invocation. Merging
  source edits is a `command` node the workflow author writes.
- Default isolation unit is the whole workflow — one worktree per run
  (FR-E24). Per-branch trees are derived from `allowed_paths`, not
  configured.
- Node ids stay flat. `--skip`, `--only`, `phases:`, resume, the dashboard
  and the MCP tools all address nodes by bare id.
- `config.ts` is scheduled to be split (`2026/05/config-split.md`, still
  `to do`). New validators go into `validateNode` and move with it.
- `documents/` files are capped at 29 920 bytes.
  `requirements-engine/08-graph-and-isolation.md` is at 21 934 and
  `design-engine/07-graph-and-isolation.md` at 21 149, so the new FRs need
  their own section files.
- A graph with no `fork:` and no `join:` must behave exactly as it does
  today.

### Affected Surface

Independent enumeration by `surface-scout`, verbatim:

````text
Confirmed: none of the bundled workflows currently use `isolation: worktree`, and the new (untracked) `scripts/workflow-diagram.ts` already renders `isolation`/`merge` traits — it will need to reflect any redesign of the split/merge model.

I have enough surface coverage. Final report below.

## Surface

- `src/isolation/node-isolation.ts` — derives the per-node/per-item isolated `TemplateContext` (workDir vs nodeWorkDir split); this is the core "split" mechanic (`isolatedContext`) that a redesign toward workflow-level default isolation and explicit split/merge nodes would rewrite — evidence: referenced from `documents/design-engine/07-graph-and-isolation.md:290-339` (`Engine.maybeIsolated`).
- `src/isolation/worktree.ts` — per-node worktree lifecycle (`getNodeWorktreePath`, `createNodeWorktree`, `worktreeKey`), the mechanism giving a node its own tree today; a "whole-workflow default isolation" change would touch how/when trees are created — evidence: `documents/design-engine/07-graph-and-isolation.md:295-299`.
- `src/isolation/guardrail.ts` — level/node-scoped leak-attribution bracket (`GuardrailOptions.scopeKind`); its `"node" | "level"` scoping is coupled to whichever unit ("node" vs "workflow"/"branch") becomes the isolation boundary — evidence: `documents/design-engine/07-graph-and-isolation.md:256-289`.
- `src/config/config.ts` — `defaults.worktree_disabled` (whole-run worktree default, `config.ts:63,85-94`), `defaults.max_parallel` (`config.ts:70,274-280`), and node-level `isolation` validation (`config.ts:373,398-416`) — the exact three knobs the request's "default isolation = whole workflow" and "explicit split/merge" would redefine.
- `src/types.ts` — `NodeConfig.type` union (`agent | command | merge | loop | human | hitl`, `types.ts:201`), `isolation?: "worktree"` (`types.ts:337`), `defaults.worktree_disabled`/`max_parallel` (`types.ts:134,136`) — the type surface any new `split`/reworked `merge` node or new isolation value must extend.
- `src/engine/node-dispatch.ts` — `executeMergeNode` (`node-dispatch.ts:321-360+`) currently merges by **copying directories verbatim** from each input node, not by consuming a structured "worker response"; this is the concrete gap against "worker format without writes — response only."
- `src/engine/engine.ts` — level dispatch table (`case "merge": executeMergeNode`, `engine.ts:847-848`), `executeLevel`/`executeLevelWithLevelGuardrail` concurrency-vs-guardrail-scope decision (per `documents/design-engine/07-graph-and-isolation.md:268-282`) — the place a new split/fork branch type would be wired in alongside `agent`/`command`/`merge`/`loop`/`human`/`hitl`.
- `src/engine/agent.ts` — `runAgent`/`invokeClaudeCli` invocation contract: today an agent node writes files directly to the shared/isolated worktree via its tool use, it does not return a constrained "response-only" payload. Implementing "worker format without writes, only response" is a change to this module's I/O contract.
- `src/engine/for-each.ts` — data-driven fan-out (`resolveForEachItems`, `itemContext`, per-item worktree via `worktreeKey(nodeId, item.key)`); this is the closest existing analogue to an explicit "split", and any new split primitive needs to be reconciled with it (same `max_concurrent`, `isolation: worktree` composition) — evidence: `documents/design-engine/07-graph-and-isolation.md:184-248,299-311`.
- `src/config/validate.ts` — validation-rule dispatch used by agent/command/loop-body results; would need a rule/branch for a "response artifact" contract if workers stop writing directly.
- `documents/requirements-engine/08-graph-and-isolation.md` — SRS section owning FR-E87..FR-E93 (`until`, `command`, `when`, `for_each`, node-scoped isolation, journal chain, `hitl` node) — the direct requirements home for split/merge-explicitness and default-isolation-scope changes.
- `documents/design-engine/07-graph-and-isolation.md` — SDS section documenting the exact mechanics above (`§5 Node-Scoped Isolation`, `§4 for_each`) that the request targets.
- `documents/requirements-engine/04b-worktree-isolation.md` — SRS for FR-E24/E50/E51/E52/E54/E57/E58 (per-run worktree default, guardrail, rescue branch, cwd-relative paths, per-workflow lock/worktree co-location, gitignored-file mirror) — this is where "default isolation = whole workflow" is currently specified (FR-E24: one worktree per run) and would need updating if the default model changes.
- `documents/requirements-engine/02-nodes-and-models.md` — node-type/model SRS section; a new explicit split node type or a redefined `merge` contract belongs here.
- `documents/design-engine/02-engine-modules-flow.md` — likely holds the DAG/level-executor design narrative (not yet opened in full) that would need updating alongside `07-graph-and-isolation.md`.
- `documents/competitors.md` — explicitly cited by the user as "образец" (Claude Code Workflow tool row/description, subagent isolation model, `agent`/`parallel`/`pipeline`/`phase` JS script) — the reference document the plan must reconcile against; also holds the "Isolation"/"Parallelism" comparison row (`competitors.md:141-142`) that becomes stale once the model changes.
- `documents/ides-difference/claude-code.md` — documents Claude Code's actual subagent contract (`agent` tool frontmatter: `isolation: worktree/remote`, fork vs isolated subagent, `context: inline/fork`) — the concrete "образец" being copied; lines 9, 27, 42, 84, 102, 123.
- `README.md` — three places describing the current model that a redesign must update: Engine Architecture mermaid diagram (`README.md:126-145`, `merge` node box), Core Concepts prose on shared-worktree default + opt-in `isolation: worktree` (`README.md:154,179`), and node-type bullet list (`README.md:160`).
- `AGENTS.md` (root, symlinked from `CLAUDE.md`) — "Execution" bullet under Architecture describes the current default (shared worktree, opt-in `isolation: worktree`, FR-E91 level-guardrail bracket) — must stay in sync per project rule ("review all project documents... to ensure they reflect current state").
- `scripts/workflow-diagram.ts` (untracked, new) — already renders `isolation`/`merge_strategy` node traits (`workflow-diagram.ts:100,202,332,352,724`) and a `merge` CSS class; a redesigned split/merge/isolation model changes what this visualizer must draw. Its companion test `scripts/workflow-diagram_test.ts` is in the same boat.
- `documents/tasks/2026-08-16-borrowed-graph-features.md` (untracked) — the permanent task record that introduced FR-E87..E93, including FR-E91 (node-scoped isolation) and the `merge`-adjacent design; the new request is effectively a follow-on redesign of that same task's FR-E91 decision, and this file records the original rationale/constraints ("shared worktree is how one node's edits reach the next... opt-in").
- `documents/design-engine/01-engine-modules-core.md`, `documents/design-engine/03-subsystems.md` — not yet opened; core-module and subsystem design sections plausibly reference the DAG executor / isolation subsystem boundary and may need cross-reference updates (flagged for follow-up, not confirmed).
- `src/mcp/mcp-server.ts`, `src/mcp/commands.ts` — MCP tool surface (`get_state`, `tail_artifacts`) that a supervisor polls; if worker nodes stop writing artifacts directly and instead return structured responses, the artifact-tailing/state contract these tools expose may need to change (not confirmed by content, flagged).
- `plugin-src/shared/agents/supervisor.md`, `plugin-src/shared/agents/orchestrator.md` — the plugin's own "supervisor drives the engine, orchestrator delegates" split is itself an explicit split/merge pattern between two subagents; worth checking for consistency with any new engine-level split/merge/worker-response vocabulary (not opened, flagged).

## Queries used

- `ls`, `find src -name '*.ts'`, `find documents -type f`, `find .flowai-workflow -maxdepth 3 -type d`
- Read: `documents/tasks/2026-08-16-borrowed-graph-features.md`, `documents/requirements-engine/08-graph-and-isolation.md`, `documents/design-engine/07-graph-and-isolation.md`, `documents/requirements-engine/04b-worktree-isolation.md`, `documents/index.md`
- `grep -n "merge"` in `src/types.ts`, `src/engine/*.ts`, `src/config/*.ts`
- `grep -n "worktree_disabled|defaults.worktree|max_parallel|isolation"` in `src/config/config.ts`, `src/types.ts`
- `grep -n "isolation|worktree|split|merge|subagent"` in `README.md`
- `grep -n "subagent|Task tool|isolation|fork|worker"` in `documents/ides-difference/claude-code.md`, `documents/competitors.md`
- `sed -n` reads of `documents/competitors.md:1-100`, `src/engine/agent.ts:1-80`, `src/engine/node-dispatch.ts:300-360`, `README.md:100-200`
- `grep -rn "isolation:|for_each:|type: merge"` in `.flowai-workflow/*/workflow.yaml`
- `grep -n "isolation|split|merge|worker|subagent"` in `documents/requirements-engine/02-nodes-and-models.md`
- `grep -n "isolation|merge|split|worktree"` in `scripts/workflow-diagram.ts`

## Not examined (budget)

- `documents/design-engine/01-engine-modules-core.md`, `documents/design-engine/02-engine-modules-flow.md`, `documents/design-engine/03-subsystems.md`, `documents/design-engine/04-data-and-logic.md` — not opened in full; likely reference the DAG/level-executor and isolation subsystem boundaries and may need alignment.
- `plugin-src/shared/agents/supervisor.md`, `plugin-src/shared/agents/orchestrator.md`, `plugin-src/shared/skills/*` — not opened; the plugin's own dispatcher/subagent split pattern could be a parallel surface.
- `src/mcp/mcp-server.ts`, `src/mcp/commands.ts` — not opened; possible impact on `get_state`/`tail_artifacts` contract if worker output changes from direct writes to structured responses.
- `src/engine/loop.ts`, `src/engine/human.ts`, `src/hitl/*.ts` — not opened; loop-body node execution and HITL nodes also run under the isolation model and may be affected by a default-scope change.
- `.flowai-workflow/github-inbox/agents/*.md`, `.flowai-workflow/autonomous-sdlc/agents/*.md` — not opened; example agent prompts that currently assume direct-write behavior and would need rewriting if the "worker response, no write" contract lands.
- `documents/design-engine/00-intro.md`, `documents/requirements-engine/00-meta.md`, `documents/requirements-engine/01-execution-model.md` — not opened; may contain the top-level statement of the execution/isolation model that needs a matching update.
- The two files with pre-existing (session-start) modifications, `.github/workflows/ci.yml` and `.gitleaks.toml`, were not inspected — git status shows them already modified before this request; left out as likely unrelated, but not confirmed.

## Could not rule out

- Whether "разделение и слияние" (split/merge) is meant as a **new node type pair** (e.g., `type: split` / a redesigned `type: merge`) versus a **reframing of existing primitives** (`for_each` as split, worktree isolation as the boundary) — the request text alone does not disambiguate, and turn 2's "1A 2B 3A" answers (invisible to this scout) likely resolved it in the planner's proposal.
- Whether "формат воркера без записи — только ответ от воркера" applies to **all** agent nodes or only to nodes running under the new split/isolation scope — could change whether `src/engine/agent.ts`'s write contract changes globally or only on a new code path.
- Whether MCP tool contracts (`src/mcp/*`) or plugin agent prompts (`plugin-src/shared/agents/*`) are in scope — not verified due to time budget, flagged above as "not examined."
````

Dispositions over the union of that report and my own enumeration, updated
to the selected design:

- `src/engine/dag.ts` (`buildLevels`, `topoSort`) — covered-by Solution step 3 (`join` edge resolution and readiness-driven scheduling).
- `src/engine/engine.ts` (`executeLevel`, `executeLevelWithLevelGuardrail`, `executeForEach`, `maybeIsolated`) — covered-by Solution steps 3, 4 and 5.
- `src/engine/for-each.ts` — covered-by Solution step 1 (renamed to `branch.ts`, item type widened to objects, `for_each` config surface deleted).
- `src/engine/node-dispatch.ts` — covered-by Solution step 5 (answer capture); `type: merge` keeps its directory-copy contract unchanged.
- `src/engine/agent.ts` — covered-by Solution step 5 (`after`-hook stdout becomes the node's answer) and step 4 (inverted `allowed_paths` default inside a group).
- `src/config/config.ts` (`NODE_CONFIG_KEYS`, `validateNode`, `validateForEach`, `validateIsolation`) — covered-by Solution steps 1, 2 and 4.
- `src/config/validate.ts` — not affected — validation rules keep operating on files; answer-shape validation is deferred (see Follow-ups).
- `src/types.ts` (`NodeConfig`, `TemplateContext`, `ForEachConfig`) — covered-by Solution steps 1, 2 and 5.
- `src/isolation/worktree.ts` — covered-by Solution step 4: `worktreeKey` is keyed by branch instead of by node, so a branch's nodes share one tree. No new git call site.
- `src/isolation/node-isolation.ts` — covered-by Solution step 4; the isolated-context derivation is reused unchanged, only its key changes.
- `src/isolation/guardrail.ts` — covered-by Solution step 3 (the bracket follows the set of nodes actually running together).
- `src/isolation/scope-check.ts` — covered-by Solution step 4 (branch without `allowed_paths` may not modify tracked source).
- `src/state/state.ts`, `src/state/run-journal.ts` — covered-by Solution step 3 (resume and replay under readiness-driven scheduling) and step 5 (dynamic branches must be journalled so a resume rebuilds the same branch set).
- `src/mcp/mcp-server.ts` (`tail_artifacts`) — covered-by Solution step 5. Inspected: `registerTailArtifacts` (`src/mcp/mcp-server.ts:279-300`) reads a named file inside a node directory, and answers are materialised as files under the join's node directory, so a supervisor keeps something to read.
- `src/mcp/commands.ts` — not affected — it starts, resumes and cancels runs by run id with no node-type or artifact-shape coupling. Evidence: `startRun`/`buildEngineRunCommand` (`src/mcp/commands.ts:196-245`) pass only workflow dir, prompt and verbosity.
- `scripts/workflow-diagram.ts`, `scripts/workflow-diagram_test.ts` (untracked, parallel session) — deferred. Inspected: the script reads `node.merge_strategy` (`:332`) and `node.isolation` (`:202`) and lists both in its key allowlist (`:89,100`). Rendering `fork`/`join` serves no stated outcome here, and the file belongs to a session still working in it; touching it would collide. Recorded under Follow-ups together with the dead `merge_strategy` field, which nothing in this change forces us to remove.
- `src/engine/loop.ts` — covered-by Solution step 3 (config-load rule). Inspected: a loop body runs through `buildLoopBodyOrder` (`src/engine/loop.ts:21,320`), a traversal independent of the level executor, so readiness-driven scheduling does not reach inside a loop. `validateFork` restricts `fork`/`join` by node type only, which would admit a loop-body agent node; the plan therefore forbids the combination at load rather than defining branch worktrees across loop iterations.
- `src/engine/human.ts`, `src/hitl/hitl.ts` — not affected — both block on a person and neither reads levels, node types of siblings, or artifact shape; a `human` or `hitl` node keeps its current dependency semantics under readiness scheduling because it is scheduled by the same dependency map as every other node.
- `src/engine/post-workflow.ts` — covered-by Solution step 5: it runs after the graph and its output is captured by the same answer path as any other node, so FR-E96's "every node" claim holds for it.
- `documents/requirements-engine/` — covered-by Solution step 6 (new section file for FR-E95/E96/E97, FR-E90 marked superseded, P2 marked resolved).
- `documents/requirements-engine/04b-worktree-isolation.md` — covered-by Solution steps 4 and 6. Re-classified after inspection: FR-E24 (one worktree per run) does stay the default, but `worktreeKey` is re-keyed from node id to `<group>.<branch>` and tree lifetime becomes branch-scoped, so FR-E51 rescue-branch pinning and the FR-E58 gitignored-file mirror now run once per branch instead of once per node — a 10-branch dynamic fork pays the mirror cost 10 times, and the FR text must say so.
- `documents/requirements-engine/02-nodes-and-models.md` — covered-by Solution step 6. Re-classified after inspection: no new node *type* appears, but this file owns the node-field surface, and the change adds `fork`, `join` and `failure_mode`, removes `for_each`, and redefines what the `after` hook's stdout means.
- `documents/design-engine/07-graph-and-isolation.md`, `02-engine-modules-flow.md`, `04-data-and-logic.md` — covered-by Solution step 6. Inspected: `02-engine-modules-flow.md:146-150` still presents `warnUnsafeParallelism` as the answer to concurrent-node attribution, and `04-data-and-logic.md:353` carries the `max_parallel` chunking narrative that readiness-driven scheduling replaces.
- `documents/design-engine/01-engine-modules-core.md`, `03-subsystems.md` — covered-by the same SDS step.
- `README.md`, `AGENTS.md` — covered-by Solution step 6.
- `documents/index.md` — covered-by Solution step 6.
- `documents/competitors.md` — deferred — human choice. Its Isolation, Parallelism and Dynamic fan-out rows went stale when FR-E90/FR-E91 landed and go staler here; refreshing an R&D reference is not part of this change. Recorded under Follow-ups.
- `documents/ides-difference/claude-code.md` — not affected — a read-only reference on another product; this change does not alter what Claude Code does.
- `.flowai-workflow/*/workflow.yaml` and `.flowai-workflow/*/agents/*.md` — not affected — every production graph is a chain with no `fork:`, no `join:`, no `for_each:` and no `isolation:`; the change is additive for them. Evidence: `grep -rn 'for_each' .flowai-workflow/ --include='*.yaml'` returns nothing, and neither does `isolation:`.
- `plugin-src/shared/agents/supervisor.md`, `orchestrator.md` — not affected — they drive the engine through MCP tools and run-state polling, not through node types.
- `.github/workflows/ci.yml`, `.gitleaks.toml` — not affected — modified before this session by another session; unrelated to the graph model.

## Definition of Done

- [x] FR-E95 `fork: <group>.<branch>` declares a branch on its entry node;
      membership propagates along `inputs` until a node carrying `join:`.
      Test: `src/config/config_fork_test.ts::FR-E95 ...`,
      `src/engine/scheduling_test.ts::FR-E97 ...` (the join edges the
      membership produces). Evidence: `deno task check`.
- [x] FR-E95 Config-load errors: a group with no `join`, a `join` naming an
      unknown group, a node carrying both `fork` and `join`, a node whose
      inputs come from two branches of one group, and a `.` inside a group
      or branch identifier.
      Test: `src/config/config_fork_test.ts::FR-E95 ...`.
      Evidence: `deno task check`.
- [x] FR-E95 Object form `fork: {group, branches, key, max_concurrent}`
      expands one node into one branch per element of a runtime JSON array
      of objects, exposing `{{branch.value.*}}`, `{{branch.key}}` and
      `{{branch.index}}`.
      Test: `src/engine/branch_test.ts::FR-E95 ...`,
      `src/engine/fork_join_e2e_test.ts::FR-E95 ...`.
      Evidence: `deno task check`.
- [ ] FR-E95 A dynamic branch key colliding with a static branch of the same
      group fails at expansion, before any branch of that group starts.
      Test: `src/engine/branch_test.ts::FR-E95 ...`.
      Evidence: `deno task check`.
- [ ] FR-E95 `failure_mode: fail_fast | collect | all_or_nothing` on the join
      decides what a failed branch does to its siblings and to the join.
      Test: `src/engine/fork_join_e2e_test.ts::FR-E95 ...`.
      Evidence: `deno task check`.
- [x] FR-E96 Every node's answer is captured: an agent's final message, a
      command's stdout, or the `after` hook's stdout when the node declares
      one.
      Test: `src/engine/answer_test.ts::FR-E96 ...`.
      Evidence: `deno task check`.
- [x] FR-E96 The engine materialises `branches.json` and
      `branches/<branch>/<node>.answer` in the join node's directory, so the
      join and `tail_artifacts` both have something to read.
      Test: `src/engine/answer_test.ts::FR-E96 ...`.
      Evidence: `deno task check`.
- [x] FR-E96 A code-editing branch works end to end in a real repository: the
      branch **modifies one tracked file and creates one new file** in its own
      tree, `after: "git add -A -N . && git diff"` becomes its answer, and an
      authored `command` join applies the patch to the run tree so both the
      edit and the new file land there.
      Test: `src/engine/isolation_e2e_test.ts::FR-E96 ...` (git-backed).
      Evidence: `deno task check`.
- [x] FR-E97 A node starts when its own inputs are complete, not when its DAG
      level is complete: a short branch's successor does not wait for a long
      sibling branch. `defaults.max_parallel` stays the global concurrency
      cap.
      Test: `src/engine/scheduling_test.ts::FR-E97 ...`.
      Evidence: `deno task check`.
- [x] FR-E97 `--dry-run` renders a fork graph in execution order — every
      branch before its join — because `buildLevels` projects the same
      dependency map the executor reads.
      Test: `src/engine/scheduling_test.ts::FR-E97 ...`.
      Evidence: `deno run -A --no-check src/cli.ts run <fixture> --dry-run` on
      a two-branch fixture prints `a1`/`b1` on level 2, the alpha terminal
      `a2` on level 3 and `integrate` on level 4.
- [x] FR-E97 A cyclic dependency, including one closed through a `join` edge,
      fails at config load instead of stalling the ready set with nothing
      runnable.
      Test: `src/engine/scheduling_test.ts::FR-E97 ...`.
      Evidence: `deno task check`.
- [x] FR-E97 `fork:` or `join:` on a loop-body node is rejected at config
      load; a `loop` node may not sit inside a branch.
      Test: `src/config/config_fork_test.ts::FR-E97 ...`.
      Evidence: `deno task check`.
- [ ] FR-E97 Resume skips completed nodes and journal replay reconstructs
      state under readiness-driven scheduling, including the branch set of a
      dynamic fork.
      Test: `src/state/lifecycle-replay_test.ts::FR-E97 ...`.
      Evidence: `deno task check`.
- [x] FR-E91 A branch that declares `allowed_paths` gets exactly one worktree
      shared by every node of that branch, keyed by `<group>.<branch>`; a
      branch without `allowed_paths` gets none.
      Test: `src/isolation/branch-scope_test.ts::FR-E91 ...`,
      `src/engine/isolation_e2e_test.ts::FR-E91 ...`.
      Evidence: `deno task check`.
- [x] FR-E91 The FR-E50 guardrail bracket covers the set of nodes actually
      running together instead of the DAG level.
      Test: `src/isolation/guardrail_level_test.ts::FR-E91 ...`.
      Evidence: `deno task check`.
- [x] FR-E37 A branch without `allowed_paths` fails as a scope violation if it
      modifies tracked source.
      Test: `src/isolation/scope-check_test.ts::FR-E37 ...`,
      `src/isolation/branch-scope_test.ts::FR-E37 ...`.
      Evidence: `deno task check`.
- [ ] FR-E37 Two shared-tree nodes running at the same time are not failed
      for each other's writes: the check brackets the running set once against
      the union of their scopes, and an in-scope write by one does not
      violate the other.
      Test: `src/isolation/scope-check_test.ts::FR-E37 ...`.
      Evidence: `deno task check`.
- [x] FR-E37 Overlapping `allowed_paths` between two branches of one group is
      refused at config load, before any branch of the group starts. The
      "at expansion for dynamic ones" half of this item turned out not to
      apply: every runtime branch of one `fork` node inherits that one node's
      `allowed_paths`, so the scopes are identical by construction and each
      branch gets a tree of its own — there is no pair to compare.
      Test: `src/isolation/branch-scope_test.ts::FR-E37 ...`.
      Evidence: `deno task check`.
- [x] FR-E90 `for_each` is gone from the language: the key is rejected at
      config load with a message naming `fork` as its replacement, and
      `ForEachConfig` / `TemplateContext.each` are removed.
      Test: `src/config/config_fork_test.ts::FR-E90 ...`.
      Evidence: `deno task check`.
- [x] Add FR-E95, FR-E96 and FR-E97 to the engine SRS in a new section file,
      each with `Acceptance criteria`; mark FR-E90 superseded by FR-E95;
      register all three in `documents/index.md`.
      Evidence: `deno task check` (`FR Canonical Field Set`, `Docs Token
      Budget`). Manual — korchasa.
- [x] Mark proposal P2 in `documents/requirements-engine/00-meta.md`
      **partially** resolved: phase 1 by FR-E91, phase 3 by FR-E95/FR-E37.
      Phase 2 (atomic `state.json` writes, concurrent cost aggregation,
      SIGTERM propagation to all children) stays open and is recorded under
      Follow-ups — readiness-driven scheduling makes concurrent state writes
      more likely, and `src/state/state.ts` still exposes plain mutators with
      no atomic-replace helper.
      Evidence: `grep -n 'P2' documents/requirements-engine/00-meta.md`.
      Manual — korchasa.
- [x] Engine SDS gains a fork/join section; the stale parallelism narratives
      in `design-engine/02-engine-modules-flow.md:146-150` and
      `04-data-and-logic.md:353` are corrected; `AGENTS.md` execution bullet
      and `README.md` node/concurrency text match the new model.
      Evidence: `deno task check`. Manual — korchasa.
- [x] Amend the FR-E90 and FR-E91 acceptance blocks in
      `documents/requirements-engine/08-graph-and-isolation.md`: FR-E90 gains
      `Status: Superseded by FR-E95` and its regression-lock anchors move to
      the renamed test files, FR-E91 loses the `for_each.max_concurrent`
      criterion (`:300-301`) and the `warnUnsafeParallelism` behaviour
      (`:304`), both of which stop existing.
      Evidence: `deno task check` (`FR Canonical Field Set`).
      Manual — korchasa.

## Solution

Six steps, each its own RED -> GREEN -> CHECK -> commit cycle. Order is
chosen so the language never sits in a half-state: the fan-out engine is
rebuilt before the old surface is deleted, and scheduling changes only after
the graph knows what a branch is.

### Step 1 — `for-each.ts` becomes `branch.ts`, items become objects

Files: `src/engine/for-each.ts` -> `src/engine/branch.ts`,
`src/engine/for_each_test.ts` -> `src/engine/branch_test.ts`. Two more test
files reference the `for_each` config surface and stop compiling the moment
`ForEachConfig` and `NodeConfig.for_each` go away in step 2 —
`src/config/config_for_each_test.ts` and `src/engine/for_each_e2e_test.ts`.
Their assertions are re-pointed at `fork` and the files are renamed to
`config_fork_test.ts` and `fork_join_e2e_test.ts`; both are named as FR-E90
regression-lock anchors at
`documents/requirements-engine/08-graph-and-isolation.md:238-239`, so the FR
text moves with them in step 6.

- `BranchItem { index: number; value: unknown; key: string }` replaces
  `ForEachItem`; `value` is now the parsed element, object or scalar.
- `parseBranchSource` accepts a JSON array of objects in addition to the
  existing string/number array and newline list. A non-array JSON document
  is still an error.
- `key` resolution gains a field path: `key: value.id` reads the element's
  `id`. Missing field, non-string value or a duplicate key after
  slugification is an error naming the offending index.
- `itemContext` becomes `branchContext` and sets `ctx.branch = {index,
  value, key}`; `TemplateContext.each` is removed in step 2.

No engine behaviour changes in this step — `executeForEach` keeps calling
the renamed helpers — so the existing green suite is the regression net.

### Step 2 — `fork` / `join` config surface

Files: `src/types.ts`, `src/config/config.ts`, `src/config/template.ts`,
new `src/config/config_fork_test.ts`.

- `NodeConfig.fork?: string | ForkConfig`, `NodeConfig.join?: string`,
  `NodeConfig.failure_mode?: "fail_fast" | "collect" | "all_or_nothing"`.
  `ForkConfig { group: string; branches: string; key?: string;
  max_concurrent?: number }`.
- Remove `for_each`, `ForEachConfig` and `TemplateContext.each`. The
  `for_each` key stays in a rejection list so a stale config fails with
  "`for_each` was replaced by `fork` (FR-E95)" rather than "unknown key".
- `validateFork` (mirrors `validateForEach`): string form must be
  `<group>.<branch>` with no further dots; object form requires a non-empty
  `branches`; both restricted to `agent` and `command` nodes.
- `resolveBranchMembership(config)` in `src/config/config.ts`: walk the
  graph from every `fork` entry node along `inputs`, marking membership,
  stopping at nodes carrying `join`. Returns `Map<nodeId, {group, branch}>`.
  Errors: unreachable `join` group, group without join, node in two branches
  of one group, node carrying both fields.
- `{{branch.*}}` is added to `validateTemplateVars` and accepted only on
  nodes inside a branch (mirrors how `allowEach` gated `{{each.*}}`).

### Step 3 — readiness-driven scheduling and the `join` edge

Files: `src/engine/dag.ts`, `src/engine/engine.ts`,
`src/isolation/guardrail.ts`, new `src/engine/scheduling_test.ts`.

- One dependency map feeds everything. `buildDependencies(config)` returns
  `Map<nodeId, Set<nodeId>>` with `join: <group>` expanded into every terminal
  node of every branch of that group, and `buildLevels` becomes a projection
  of it rather than an independent traversal. Without that, a `join` node
  carries no `inputs:` and `buildLevels` places it at level 0, so `--dry-run`
  (`src/engine/engine.ts:150`) and drift detection (`:234`) would print a plan
  where the join runs before its branches while the executor runs it after.
- Cycle detection moves into `buildDependencies` and keeps throwing, so a
  cyclic graph still fails at load instead of stalling the ready set with
  nothing runnable. The existing cycle tests
  (`src/engine/dag_test.ts:174,192`) keep passing through the projection.
- `warnUnsafeParallelism` (`src/engine/engine.ts:333,1243`) is removed. It
  warns whenever a multi-node level meets `max_parallel > 1`, which is now the
  normal state of every fork workflow, and the two failure modes it stood in
  for are answered — attribution by the running-set bracket, same-file
  clobbering by branch worktrees. Its FR text at
  `documents/requirements-engine/08-graph-and-isolation.md:304` is amended in
  step 6.
- `Engine.runNodes` replaces `executeLevel`: maintain a ready set (all
  dependencies `completed` or `skipped`), start nodes up to
  `defaults.max_parallel`, and re-evaluate on every completion. `--skip` /
  `--only` / `when:` filtering keeps its current semantics and is applied
  when a node becomes ready.
- The FR-E50 guardrail bracket now wraps the *running set*: opened when the
  first node starts while none is running, closed when the last finishes.
  `scopeKind: "level"` is renamed to `"group"` in messages; the existing
  per-node fast path is unchanged for a run that never has two nodes at once.
- FR-E47 budget checks move from "after each chunk" to "after each node
  completion".

### Step 4 — branch isolation derived from `allowed_paths`

Files: `src/isolation/worktree.ts`, `src/engine/engine.ts`,
`src/engine/agent.ts`, `src/isolation/scope-check.ts`.

- `worktreeKey` is keyed by `<group>.<branch>` instead of node id, and
  `Engine.maybeIsolated` becomes `Engine.withBranchTree`: the first node of a
  branch creates the tree, the rest of the branch reuses it, and the tree is
  removed when the branch's terminal node succeeds (after `pinDetachedHead`)
  and kept when any node of it fails.
- A branch is isolated iff at least one of its nodes declares
  `allowed_paths`. `node.isolation` (FR-E91) stays as the escape hatch for a
  single node outside any fork.
- `runAgent` treats a missing `allowed_paths` on a branch node as
  `allowed_paths: []`, so the FR-E37 check runs and any modification fails the
  node. Outside a branch the current "absent means no check" behaviour is
  untouched.
- The FR-E37 snapshot has the same attribution problem the FR-E50 guardrail
  has, and gets the same answer. `snapshotModifiedFiles`
  (`src/isolation/scope-check.ts:21-46`) covers the whole tree, and
  `findViolations` is `after` minus `before`, so when several nodes share one
  tree concurrently node B's writes appear inside node A's bracket — the
  hazard `src/engine/engine.ts:527-533` already documents for the guardrail
  and fixes only there. The check therefore brackets the *running set* of
  shared-tree nodes once, against the union of their scopes, instead of
  bracketing each node. A violation fails every node in the set: with a
  repository-wide snapshot the engine cannot say which node wrote the file,
  and guessing would be worse than failing loudly. An isolated branch keeps
  its own per-node bracket, because its tree is its own.
- Overlap detection: a pure `globsOverlap(a, b)` helper in
  `src/isolation/glob.ts` (conservative — reports overlap unless it can prove
  disjointness). Static branches are checked in `validateFork`; dynamic
  branches are checked in `Engine` right after expansion, before the first
  branch node starts.

### Step 5 — answer capture and the branch manifest

Files: `src/engine/agent.ts`, `src/engine/command.ts`,
`src/engine/node-dispatch.ts`, `src/engine/engine.ts`, new
`src/engine/answer_test.ts`.

- `runShellCommand` returns stdout; when a node declares `after`, that stdout
  is the node's answer, otherwise the answer is the agent's final message or
  the command's stdout.
- The answer is written to `<node_dir>/.answer` as the node completes, so it
  survives a crash and a resume without inflating `state.json`.
  `NodeState.result` keeps the existing excerpt.
- When a group's last branch finishes, the engine writes into the join node's
  directory, before the join runs:
  - `branches.json` — `{group, branches: [{branch, status, nodes: [{id,
    status, answer}]}]}`, where `answer` is a path relative to the join's
    node dir.
  - `branches/<branch>/<node>.answer` — a copy of each node's answer.
- `failure_mode` decides the rest: `fail_fast` stops the group at the first
  failed branch, `collect` lets every branch finish and records the failures
  in the manifest, `all_or_nothing` fails the group without running the join.
- The expanded branch set of a dynamic fork is appended to `journal.jsonl` as
  a fact, so a resume rebuilds the same branches instead of re-reading a
  source file that may have changed.

### Step 6 — documentation and the diagram script

- New `documents/requirements-engine/10-fork-join.md` with FR-E95, FR-E96,
  FR-E97 in canonical field order; FR-E90 in
  `08-graph-and-isolation.md` gains `Status: Superseded by FR-E95` and loses
  its acceptance block; P2 in `00-meta.md` marked resolved.
- New `documents/design-engine/08-fork-join.md`; corrections to
  `02-engine-modules-flow.md:146-150` and `04-data-and-logic.md:353`.
- `documents/index.md` rows for the three new FRs.
- `02-nodes-and-models.md` gains the `fork`, `join` and `failure_mode` node
  fields and the redefined `after`-hook semantics; `04b-worktree-isolation.md`
  records branch-scoped tree lifetime and the per-branch cost of FR-E51
  pinning and the FR-E58 mirror.
- `AGENTS.md` execution bullet and node-types bullet; `README.md` node list,
  concurrency paragraph and architecture diagram.

### Verification

- `deno task check` after every step — it runs fmt, lint, the full suite,
  `deno publish --dry-run`, workflow-config validation for all four
  workflow folders, the FR canonical field check and the docs byte budget.
- `deno run -A --no-check src/cli.ts run .flowai-workflow/github-inbox
  --dry-run` — the three production workflows are chains and must produce
  byte-identical plan output before and after.
- One git-backed end-to-end test is the load-bearing check for the code-edit
  path: two branches working on disjoint scopes in their own trees, one of
  them creating a new file rather than only editing existing ones, patches
  applied by an authored join, and the run tree carrying every edit and the
  new file at the end.

## Follow-ups

Four Definition-of-Done items are NOT satisfied by this implementation and stay
unticked above. They are listed first because they are unfinished scope, not
future ideas:

- **`failure_mode` for static branches.** `collect` and `all_or_nothing` are
  honoured only on the dynamic fan-out path (`joinFailureMode` inside
  `executeFork`). A group of static branches still behaves as `fail_fast`
  whatever the join declares, so the field is accepted and partly ignored —
  the worst of the three states. Fix before anyone writes a static group that
  relies on `collect`.
- **Journalling a dynamic fork's expanded branch set.** Resume replays node
  states, but the branch list a runtime fork produced is not a journal fact, so
  a resumed run re-reads the source and may expand a different set. Static
  groups are unaffected.
- **A static branch key colliding with a dynamic one in the same group.** The
  collision is caught only among the runtime items themselves
  (`assignKeys`), not against the group's static branch names.
- **Two shared-tree nodes running together are not failed for each other's
  writes.** The rolling `GroupGuardrail` unions their scopes, which is the
  mechanism that makes this true, but nothing asserts the non-failure end to
  end; `guardrail_level_test.ts` only covers the message and the disabled
  path.

- Answer shape validation (`output:` with a JSON Schema on a node, so the
  engine rejects a malformed answer and re-prompts through the FR-E1
  continuation loop). Deferred: it forces the JSON Schema library decision
  that proposal P1 in `documents/requirements-engine/00-meta.md` still lists
  as open, and the fork/join mechanism does not depend on it.
- `type: expand` — an agent emits a graph fragment that the engine validates
  and grafts (variant D3). Deferred: it trades away load-time verification
  for the grafted subtree and needs a node-type whitelist and a scope
  ceiling before an agent may author nodes. Wanted when branches need
  structurally different pipelines, which `when:` on an extra branch node
  covers approximately today.
- The inverted `allowed_paths` default outside a fork group — a "pure node"
  contract for ordinary nodes. Deferred: flipping it globally would fail
  every existing workflow.
- Proposal P2 phase 2 — atomic `state.json` replacement, concurrent cost
  aggregation and SIGTERM propagation to every child process. Deferred: it is
  a state-layer change with its own race-condition test suite, and it is not
  what makes fork/join work. Readiness-driven scheduling raises the odds of
  concurrent writes, so this should be the next task after this one, not a
  distant one.
- The dead `merge_strategy` field. Deferred: it serves no stated outcome here.
  `scripts/workflow-diagram.ts` is untracked work owned by a parallel session;
  removing `for_each` from `NodeConfig` broke its typecheck, so it was repaired
  minimally (fork/join traits and details, key allowlist) rather than left red.
  Its FR-E94 docs were updated to match.
- `documents/competitors.md` — the Isolation, Parallelism and Dynamic fan-out
  rows describe the engine before FR-E90/FR-E91 landed and go staler with
  this change. Refresh separately.
