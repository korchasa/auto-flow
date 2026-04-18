# Implementation Plan for Issue #187

FR-E47: Run Budget Enforcement — workflow-wide `--budget` CLI cap, per-node
`budget.max_usd` / `budget.max_turns` YAML fields, resolution cascade, and
loop pre-check with `budget_preempt`.

## Variant A: Inline Budget Checks in Existing Flow

Add budget fields directly to existing types and check budget inline at the
two cost-recording sites (`engine.ts:executeNode()` and `loop.ts:runLoop()`).
`budget.max_turns` emitted via `extraArgs` in `agent.ts`. No new modules.

- **Affected files:**
  - `engine/types.ts` — add `budget_usd?: number` to `EngineOptions` (line 308),
    `budget?: { max_usd?: number; max_turns?: number }` to `NodeConfig` (line 83)
    and `WorkflowDefaults` (line 57)
  - `engine/cli.ts` — parse `--budget <USD>` flag in `parseArgs()` (line 73),
    add to `--help` output
  - `engine/cli_test.ts` — new parseArgs tests for `--budget`
  - `engine/config.ts` — validate `budget.max_usd` (positive number) and
    `budget.max_turns` (positive integer) in `validateNode()` (line 212);
    cascade merge in `mergeDefaults()` (line 608): node.budget → loop.budget →
    defaults.budget
  - `engine/config_test.ts` — validation tests for budget fields
  - `engine/engine.ts` — after `markNodeCompleted()` at line 435: check
    `state.total_cost_usd > options.budget_usd`, abort workflow if exceeded.
    Per-node check: compare `node.cost_usd > resolvedBudget.max_usd`, fail
    node (not workflow). Pass `budget_usd` through to loop executor
  - `engine/loop.ts` — after each body node `markNodeCompleted()` at line 134:
    check workflow budget. Before iteration spawn: compute
    `avgIterCost = totalLoopCost / iterationCount`, if
    `avgIterCost > remainingBudget` → exit with `budget_preempt`. Skip
    pre-check on first iteration
  - `engine/loop_test.ts` — budget pre-check and exceeded tests
  - `engine/agent.ts` — in `runAgent()`, if `budget.max_turns` resolved,
    append `--max-turns <N>` to `extraArgs` (line 180 and 290)
  - `engine/agent_test.ts` — max_turns arg emission test
  - `engine/state_test.ts` — budget exceeded scenarios
- **Effort:** S
- **Risks:** Inline checks in engine.ts and loop.ts add conditional branches
  to already complex functions. Budget cascade logic duplicated between
  config.ts (validation) and engine.ts/loop.ts (resolution). `--max-turns`
  only works for Claude CLI runtime — other runtimes silently ignore.

## Variant B: Budget Module with Centralized Resolution

Extract budget resolution and enforcement into a dedicated `engine/budget.ts`
module. This module owns: cascade resolution (node → loop → defaults → CLI),
workflow-wide check, per-node check, and loop pre-check. Engine/loop call
`budget.checkWorkflow()` and `budget.checkNode()` — single responsibility.

- **Affected files:**
  - `engine/types.ts` — same additions as Variant A: `budget_usd` on
    `EngineOptions`, `budget` object on `NodeConfig` and `WorkflowDefaults`
  - `engine/cli.ts` — same `--budget` parsing as Variant A
  - `engine/cli_test.ts` — same tests as Variant A
  - `engine/config.ts` — validate budget fields in `validateNode()`;
    cascade merge in `mergeDefaults()` (node.budget → defaults.budget)
  - `engine/config_test.ts` — validation tests
  - `engine/budget.ts` — **new module** (~80 lines). Exports:
    - `resolveBudget(node, loopNode?, defaults?): ResolvedBudget` — cascade
    - `checkWorkflowBudget(state, budgetUsd): BudgetResult` — workflow-wide
    - `checkNodeBudget(nodeCost, maxUsd): BudgetResult` — per-node
    - `checkLoopPreempt(totalLoopCost, iterCount, remainingBudget): boolean`
    - `BudgetResult = { exceeded: boolean; message?: string }`
  - `engine/budget_test.ts` — **new test file**. Pure-function tests for all
    4 exports: no budget (no-op), not exceeded, exceeded, cascade resolution,
    loop pre-check first iteration skip, pre-check trigger
  - `engine/engine.ts` — after `markNodeCompleted()`: call
    `checkWorkflowBudget()` and `checkNodeBudget()`. Abort/fail based on result
  - `engine/loop.ts` — call `checkWorkflowBudget()` after body node completion;
    call `checkLoopPreempt()` before iteration spawn
  - `engine/agent.ts` — same `--max-turns` via extraArgs as Variant A
  - `engine/agent_test.ts` — max_turns arg test
  - `engine/mod.ts` — re-export `budget.ts` for barrel
- **Effort:** M
- **Risks:** New module adds a file to engine/. Risk of over-abstraction for
  what is essentially 4 conditionals. `resolveBudget()` cascade must stay in
  sync with `mergeDefaults()` merge order. Same `--max-turns` Claude-only
  limitation.

## Variant C: Config-Time Budget Resolution + Runtime Checks

Resolve budget fully at config parse time: `mergeDefaults()` computes final
`_resolved_budget` on each `NodeConfig` (cascade already applied). Runtime
only reads the pre-resolved values — zero cascade logic in engine.ts/loop.ts.
Workflow-wide budget stored in `EngineOptions` and checked post-node.

- **Affected files:**
  - `engine/types.ts` — `budget_usd` on `EngineOptions`, `budget` on
    `NodeConfig` and `WorkflowDefaults`, plus `_resolved_budget` internal
    field on `NodeConfig` (set by config.ts, consumed by engine/loop/agent)
  - `engine/cli.ts` — same `--budget` parsing
  - `engine/cli_test.ts` — same tests
  - `engine/config.ts` — validate budget fields; in `mergeDefaults()`,
    resolve cascade and write `_resolved_budget` onto each node (including
    loop body nodes). This is consistent with existing `settings` merge
    pattern (lines 620-627)
  - `engine/config_test.ts` — cascade resolution tests at config level
  - `engine/engine.ts` — after `markNodeCompleted()`: simple check
    `state.total_cost_usd > options.budget_usd`. Per-node: check
    `node.cost_usd > node._resolved_budget.max_usd`. No cascade logic needed
  - `engine/loop.ts` — workflow budget check after body node. Pre-check:
    `avgCost > remaining` using pre-resolved values. Clean exit with
    `budget_preempt`
  - `engine/agent.ts` — read `_resolved_budget.max_turns`, emit
    `--max-turns <N>` via extraArgs
  - `engine/agent_test.ts` — max_turns test
  - `engine/loop_test.ts` — pre-check tests
- **Effort:** M
- **Risks:** `_resolved_budget` is an internal convention (underscore prefix)
  that could confuse contributors. Adds a new merge pass in
  `mergeDefaults()` — must handle loop body nodes recursively (same pattern
  as settings merge at lines 631-643). Config-time resolution means CLI
  `--budget` must be threaded into config loading or checked separately
  (it's an EngineOptions field, not a config field — slight asymmetry).

## Summary

3 variants. Key trade-off: simplicity (A) vs. testability/separation (B) vs.
config-time resolution (C).

Recommend **Variant A**: the budget checks are 4 conditionals total (2 in
engine.ts, 2 in loop.ts) — a dedicated module (B) or config-time resolution
(C) adds indirection without proportional benefit. The `budget` field on
`NodeConfig`/`WorkflowDefaults` cascades naturally via the existing
`mergeDefaults()` pattern. Pure-function unit tests for cascade resolution
can live in `config_test.ts` without a new module. Variant A has the smallest
diff and keeps budget logic co-located with cost tracking.
