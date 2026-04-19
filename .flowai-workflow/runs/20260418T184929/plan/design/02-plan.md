# Implementation Plan for Issue #187

FR-E47: Run Budget Enforcement — workflow-wide `--budget` CLI cap, per-node
`budget.max_usd` / `budget.max_turns` YAML fields, resolution cascade, and
loop pre-check with `budget_preempt`.

**Note (post-#208 flatten):** engine sources live at the repo root. All paths
below reflect the flattened layout. Line numbers are approximate; verify
against current `main` before editing.

## Variant A: Inline Budget Checks in Existing Flow

Add budget fields directly to existing types and check budget inline at the
two cost-recording sites (`engine.ts:executeNode()` and `loop.ts:runLoop()`).
`budget.max_turns` emitted via `extraArgs` in `agent.ts` **only when runtime
is `claude`**. No new modules.

- **Affected files:**
  - `types.ts` — add `budget_usd?: number` to `EngineOptions`,
    `budget?: { max_usd?: number; max_turns?: number }` to `NodeConfig`
    and `WorkflowDefaults`
  - `cli.ts` — parse `--budget <USD>` flag in `parseArgs()`, add to `--help`
    output
  - `cli_test.ts` — new `parseArgs` tests for `--budget`
  - `config.ts` — validate `budget.max_usd` (positive number) and
    `budget.max_turns` (positive integer) in `validateNode()`;
    cascade merge in `mergeDefaults()`: node.budget → loop.budget →
    defaults.budget
  - `config_test.ts` — validation tests for budget fields
  - `engine.ts` — after `markNodeCompleted()`: strict check
    `state.total_cost_usd > options.budget_usd`, abort workflow if exceeded
    (error: `Budget exceeded: $X.XX > $Y.YY`). Per-node check: compare
    `node.cost_usd > resolvedBudget.max_usd`, fail node (not workflow). Pass
    `budget_usd` through to loop executor. On `--resume`: abort
    pre-execution if loaded `total_cost_usd` already over cap.
  - `loop.ts` — after each body node `markNodeCompleted()`: check workflow
    budget. Before iteration spawn: compute
    `avgIterCost = totalLoopCost / iterationCount`, if
    `avgIterCost > remainingBudget` → exit with `budget_preempt`. Skip
    pre-check on first iteration
  - `loop_test.ts` — budget pre-check and exceeded tests
  - `agent.ts` — in `runAgent()`, if `budget.max_turns` resolved AND runtime
    is `claude`, append `--max-turns <N>` to `extraArgs`. For non-Claude:
    omit flag, emit one-time warning `budget.max_turns ignored: runtime=<id>`
  - `agent_test.ts` — max_turns arg emission test (Claude) + omit-with-warning
    test (non-Claude)
  - `state_test.ts` — budget exceeded scenarios, exact-equal-cap no-trigger,
    resume over-budget abort
- **Effort:** S
- **Risks:** Inline checks in `engine.ts` and `loop.ts` add conditional
  branches to already complex functions. Budget cascade logic duplicated
  between `config.ts` (validation) and `engine.ts`/`loop.ts` (resolution).
  Pre-check uses average-based heuristic — may preempt loops whose variance
  would have fit.

## Variant B: Budget Module with Centralized Resolution

Extract budget resolution and enforcement into a dedicated `budget.ts`
module. This module owns: cascade resolution (node → loop → defaults → CLI),
workflow-wide check, per-node check, and loop pre-check. Engine/loop call
`budget.checkWorkflow()` and `budget.checkNode()` — single responsibility.

- **Affected files:**
  - `types.ts` — same additions as Variant A: `budget_usd` on
    `EngineOptions`, `budget` object on `NodeConfig` and `WorkflowDefaults`
  - `cli.ts` — same `--budget` parsing as Variant A
  - `cli_test.ts` — same tests as Variant A
  - `config.ts` — validate budget fields in `validateNode()`;
    cascade merge in `mergeDefaults()` (node.budget → defaults.budget)
  - `config_test.ts` — validation tests
  - `budget.ts` — **new module** (~80 lines). Exports:
    - `resolveBudget(node, loopNode?, defaults?): ResolvedBudget` — cascade
    - `checkWorkflowBudget(state, budgetUsd): BudgetResult` — workflow-wide
    - `checkNodeBudget(nodeCost, maxUsd): BudgetResult` — per-node
    - `checkLoopPreempt(totalLoopCost, iterCount, remainingBudget): boolean`
    - `BudgetResult = { exceeded: boolean; message?: string }`
  - `budget_test.ts` — **new test file**. Pure-function tests for all
    4 exports: no budget (no-op), not exceeded, exceeded, cascade resolution,
    loop pre-check first iteration skip, pre-check trigger
  - `engine.ts` — after `markNodeCompleted()`: call
    `checkWorkflowBudget()` and `checkNodeBudget()`. Abort/fail based on result
  - `loop.ts` — call `checkWorkflowBudget()` after body node completion;
    call `checkLoopPreempt()` before iteration spawn
  - `agent.ts` — same runtime-gated `--max-turns` as Variant A
  - `agent_test.ts` — max_turns arg test
  - `mod.ts` — re-export `budget.ts` for barrel
- **Effort:** M
- **Risks:** New module adds a file to root. Risk of over-abstraction for
  what is essentially 4 conditionals. `resolveBudget()` cascade must stay in
  sync with `mergeDefaults()` merge order.

## Variant C: Config-Time Budget Resolution + Runtime Checks

Resolve budget fully at config parse time: `mergeDefaults()` computes final
`_resolved_budget` on each `NodeConfig` (cascade already applied). Runtime
only reads the pre-resolved values — zero cascade logic in engine.ts/loop.ts.
Workflow-wide budget stored in `EngineOptions` and checked post-node.

- **Affected files:**
  - `types.ts` — `budget_usd` on `EngineOptions`, `budget` on
    `NodeConfig` and `WorkflowDefaults`, plus `_resolved_budget` internal
    field on `NodeConfig` (set by config.ts, consumed by engine/loop/agent)
  - `cli.ts` — same `--budget` parsing
  - `cli_test.ts` — same tests
  - `config.ts` — validate budget fields; in `mergeDefaults()`,
    resolve cascade and write `_resolved_budget` onto each node (including
    loop body nodes). Consistent with existing `settings` merge pattern
  - `config_test.ts` — cascade resolution tests at config level
  - `engine.ts` — after `markNodeCompleted()`: simple check
    `state.total_cost_usd > options.budget_usd`. Per-node: check
    `node.cost_usd > node._resolved_budget.max_usd`. No cascade logic needed
  - `loop.ts` — workflow budget check after body node. Pre-check:
    `avgCost > remaining` using pre-resolved values. Clean exit with
    `budget_preempt`
  - `agent.ts` — read `_resolved_budget.max_turns`, emit
    `--max-turns <N>` via extraArgs (runtime-gated)
  - `agent_test.ts` — max_turns test
  - `loop_test.ts` — pre-check tests
- **Effort:** M
- **Risks:** `_resolved_budget` is an internal convention (underscore prefix)
  that could confuse contributors. Adds a new merge pass in
  `mergeDefaults()` — must handle loop body nodes recursively. Config-time
  resolution means CLI `--budget` must be threaded into config loading or
  checked separately (it's an `EngineOptions` field, not a config field —
  slight asymmetry).

## Summary

3 variants. Key trade-off: simplicity (A) vs. testability/separation (B) vs.
config-time resolution (C).

Recommend **Variant A**: the budget checks are 4 conditionals total (2 in
`engine.ts`, 2 in `loop.ts`) — a dedicated module (B) or config-time resolution
(C) adds indirection without proportional benefit. The `budget` field on
`NodeConfig`/`WorkflowDefaults` cascades naturally via the existing
`mergeDefaults()` pattern. Pure-function unit tests for cascade resolution
can live in `config_test.ts` without a new module. Variant A has the smallest
diff and keeps budget logic co-located with cost tracking.
