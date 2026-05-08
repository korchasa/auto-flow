---
date: "2026-05-01"
status: to do
implements: [FR-E47, FR-E59, FR-E60, FR-E61]
tags: [refactor, engine]
related_tasks:
  - 2026/05/isolation-provider-plugin.md
  - 2026/05/config-split.md
  - 2026/05/engine-singleton-guard.md
  - 2026/05/budget-to-cli-lib.md
---
# engine: Decompose `Engine` god-class into focused subsystems

## Goal

Reduce coupling and improve testability of the workflow engine by
splitting `Engine` into single-responsibility collaborators. Eliminate
the 130-line `run()` and 150-line `runWithLock()` methods.

## Overview

### Context

Critique #2: `engine.ts` is 827 lines, `engine_test.ts` is 1515 lines
(1.8× ratio is a refactor signal). One class owns: worktree lifecycle,
lock management, state init/load/save, DAG levels, parallelism,
post-workflow, budget enforcement at 4 sites, summary, prepare_command.

### Current State

- `Engine.run()` — 130 lines, mixes worktree, lock, state, dispatch
  ([engine.ts:104-237](engine.ts#L104-L237)).
- `Engine.runWithLock()` — 150 lines, mixes prepare_command, level loop,
  post-workflow, worktree teardown ([engine.ts:240-388](engine.ts#L240-L388)).
- `Engine.executeNode()` — 120 lines including budget check inline
  ([engine.ts:456-579](engine.ts#L456-L579)).
- Budget enforcement scattered across `engine.ts` (level + node + warn),
  `loop.ts`, `node-dispatch.ts`, `agent.ts:applyBudgetFlags`.

### Constraints

- Public surface (`Engine.run()`, `EngineOptions`, `mod.ts` exports) MUST
  stay byte-identical. Library consumers depend on it.
- Cannot break library-embedding contract (FR-E59/E60/E61).
- Refactor lands AFTER the IsolationProvider task — or merges with
  it; doing both at once doubles review surface.

## Definition of Done

- [ ] `Engine` class ≤ 250 lines; `run()` ≤ 30 lines.
- [ ] New `RunLifecycle` module: owns lock acquire/release, run dirs
      setup, isolation provider setup/teardown, signal disposers.
- [ ] New `LevelExecutor` module: owns DAG level iteration, max_parallel
      chunking, per-level budget post-check.
- [ ] New `BudgetGuard` module: single source of truth for FR-E47 — all
      4 check sites call its methods (workflow-resume, workflow-runtime,
      per-node post-completion, loop pre-iteration). `applyBudgetFlags`
      moves there from `agent.ts`.
- [ ] `executeNode()` ≤ 60 lines; budget logic delegated to `BudgetGuard`.
- [ ] `engine_test.ts` split into per-collaborator test files.
- [ ] No new public exports leak from `mod.ts` unless intentional;
      collaborators are package-private by default.
- [ ] All existing tests pass without modification (refactor, not redesign).

## Solution

### Step 1 — Extract `BudgetGuard`

Pure-function module first. Move `checkWorkflowBudget`,
`warnBudgetCaveats`, `resolveBudget` callsites, per-node check from
`executeNode`, loop pre-check from `loop.ts`, `applyBudgetFlags` from
`agent.ts`. Single class with 4 methods: `checkWorkflowResume`,
`checkWorkflowRuntime`, `checkNodePost`, `shouldPreemptLoop`.

### Step 2 — Extract `LevelExecutor`

Move `executeLevel` + parallel chunking. Inject `executeNode` as a
callback (Engine passes its own bound method). `LevelExecutor` calls
`BudgetGuard.checkWorkflowRuntime` after each level/chunk.

### Step 3 — Extract `RunLifecycle`

Move worktree create/teardown (provider-aware, post isolation task), lock
acquire/release, shutdown disposer registration, `ensureRunDirs`. Engine
constructs `RunLifecycle`, calls `setup()` and `teardown(success)`.

### Step 4 — Slim `Engine`

`Engine.run()` becomes orchestration only:
```
const lc = new RunLifecycle(...);
const ctx = await lc.setup();
try {
  await prepareCommand(...);  // standalone fn
  const success = await this.levelExecutor.runAll(filteredLevels);
  await this.postWorkflow.run(workflowSuccess: success);
  return this.finalize(success);
} finally { await lc.teardown(success); }
```

### Step 5 — Test split

`run_lifecycle_test.ts`, `level_executor_test.ts`, `budget_guard_test.ts`,
shrunken `engine_test.ts` (orchestration smoke only).

### Verification

- `deno task check` green.
- All 4 dogfood workflows run end-to-end identically (compare
  `state.json`, artifact tree, run log).
- `wc -l engine.ts` ≤ 300; `engine_test.ts` ≤ 600.
- No public-API diff: `deno publish --dry-run` shows zero new exports.
