---
variant: "Variant A: Inline Budget Checks in Existing Flow"
tasks:
  - desc: "Add budget types to types.ts"
    files: ["types.ts"]
  - desc: "Parse --budget CLI flag in cli.ts"
    files: ["cli.ts", "cli_test.ts"]
  - desc: "Validate budget fields and cascade merge in config.ts"
    files: ["config.ts", "config_test.ts"]
  - desc: "Add workflow-wide and per-node budget checks in engine.ts"
    files: ["engine.ts"]
  - desc: "Add loop budget pre-check with budget_preempt in loop.ts"
    files: ["loop.ts", "loop_test.ts"]
  - desc: "Emit --max-turns via extraArgs in agent.ts (runtime-gated)"
    files: ["agent.ts", "agent_test.ts"]
  - desc: "Add state budget exceeded and resume tests"
    files: ["state_test.ts"]
---

## Justification

I selected **Variant A** (Inline Budget Checks) over Variant B (dedicated
module) and Variant C (config-time resolution) for these reasons:

1. **Proportional complexity:** Budget enforcement is 4 conditionals total —
   2 in `engine.ts` (workflow-wide + per-node after `markNodeCompleted()`) and
   2 in `loop.ts` (workflow budget after body node + pre-check before iteration
   spawn). A dedicated `budget.ts` module (Variant B) or config-time resolved
   `_resolved_budget` field (Variant C) adds files/abstractions without
   matching benefit for ~20 lines of logic.

2. **Follows existing patterns:** Budget cascade (node → loop → defaults)
   naturally extends the existing `mergeDefaults()` pattern in `config.ts`
   (same pattern used for `model`, `runtime`, `on_failure_script`). Pure-function
   unit tests for cascade resolution live in `config_test.ts` — no new test
   file needed. Per AGENTS.md: "no premature abstraction."

3. **Co-location with cost tracking:** FR-E17 cost aggregation already happens
   in `engine.ts` (`markNodeCompleted()` → `updateRunCost()`) and `loop.ts`
   (body node cost accumulation). Budget checks sit directly after these sites,
   making the enforcement flow obvious in the code path.

4. **Smallest diff (effort S):** No new modules, no new barrel exports, no new
   internal conventions. Aligns with AGENTS.md's "domain-agnostic DAG executor"
   vision — budget is a workflow-level concern, not an architectural subsystem.

5. **`--max-turns` gated on runtime:** The `--max-turns` flag is Claude CLI
   only. Agent.ts emits it via `extraArgs` **only when runtime is `claude`**
   (same pattern as `--model`). Non-Claude runtimes get a one-time warning and
   the flag is omitted — no reliance on silent-ignore tolerance.

## Repo-layout note (post-#208 flatten)

Engine sources live at the repo root (not under `engine/`). All file paths
below use the flattened layout. Line numbers are approximate and should be
re-verified by the Developer against current `main` before editing.

## Task Descriptions

### Task 1: Add budget types to types.ts

Add `budget_usd?: number` to `EngineOptions`. Add
`budget?: { max_usd?: number; max_turns?: number }` to `NodeConfig` and
`WorkflowDefaults`. These are optional fields — no breaking changes to existing
workflows.

### Task 2: Parse --budget CLI flag in cli.ts

In `parseArgs()`, add `--budget <USD>` parsing. Convert to float, validate
positive. Map to `EngineOptions.budget_usd`. Add to `--help` output text. Add
unit tests in `cli_test.ts` for valid/invalid `--budget` values.

### Task 3: Validate budget fields and cascade merge in config.ts

In `validateNode()`: validate `budget.max_usd` (positive number) and
`budget.max_turns` (positive integer) when present. In `mergeDefaults()`:
cascade merge `budget` field: node.budget → loop parent budget → defaults.budget
(same pattern as existing `model` cascade). Add tests in `config_test.ts` for
validation and cascade.

### Task 4: Add workflow-wide and per-node budget checks in engine.ts

After `markNodeCompleted()`: check `state.total_cost_usd > options.budget_usd`
(strict — exact-equal does NOT trigger) → abort workflow with error
`Budget exceeded: $X.XX > $Y.YY`. Per-node check: compare
`node.cost_usd > resolvedBudget.max_usd` → fail node (not workflow). Pass
`budget_usd` through to loop executor. On `--resume`: load prior
`total_cost_usd` and abort pre-execution if already over cap.

### Task 5: Add loop budget pre-check with budget_preempt in loop.ts

After each body node `markNodeCompleted()`: check workflow budget. Before
iteration spawn (iteration > 1): compute
`avgIterCost = totalLoopCost / iterationCount`. If
`avgIterCost > remainingBudget` → exit loop with `budget_preempt` reason. Skip
pre-check on first iteration (no data). Add tests for pre-check trigger and
exceeded scenarios.

### Task 6: Emit --max-turns via extraArgs in agent.ts (runtime-gated)

In `runAgent()`, if resolved `budget.max_turns` is present AND runtime is
`claude`, append `--max-turns <N>` to `extraArgs`. For non-Claude runtimes:
omit the flag, emit a one-time warning
`budget.max_turns ignored: runtime=<id>` at workflow start. Add tests covering
both the Claude emission path and the non-Claude omit-with-warning path.

### Task 7: Add state budget exceeded and resume tests

Test scenarios in `state_test.ts`: workflow-level budget exceeded detection,
exact-equal cap does not trigger, per-node cost accumulation exceeding budget,
`total_cost_usd` tracking with `budget_usd` comparison, and resume semantics
(`--resume` with prior run already over budget → abort pre-execution).

## Summary

Selected Variant A (Inline Budget Checks) for FR-E47. Budget enforcement adds
4 inline conditionals to existing cost-tracking sites in `engine.ts` and
`loop.ts`, follows established `mergeDefaults()` cascade pattern, and requires
no new modules. `--max-turns` emission is gated on `runtime=claude` (not
reliant on silent-ignore). Resume preserves cumulative `total_cost_usd`;
exact-equal cap does not trigger abort. 7 tasks ordered by dependency (types
first, then CLI/config, then runtime checks). Branch `sdlc/issue-187` created
with draft PR.
