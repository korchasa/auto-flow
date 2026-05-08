---
date: "2026-05-01"
status: to do
implements: [FR-E47]
tags: [refactor, library, budget, cross-repo]
related_tasks:
  - 2026/05/engine-decomposition.md
  - 2026/05/budget-cli-runtime-coupling.md
cross_repo: korchasa/ai-ide-cli
---
# engine: Move budget enforcement primitives into `@korchasa/ai-ide-cli`

## Goal

Make budget tracking a runtime-adapter responsibility. Engine declares
caps (workflow / per-node) and consumes a normalized cost number from
the adapter. Per-runtime mechanics (`--max-turns`, cost reporting field
names, fallback estimators) live in the lib.

## Overview

### Context

Critique #12. FR-E47 budget enforcement is effectively Claude-only:
`max_turns` maps to `--max-turns <N>` (Claude CLI flag), `cost_usd`
comes from `CliRunOutput.total_cost_usd` (Claude reports it,
others may not). Engine emits warnings about non-Claude runtimes,
which is an admission that the engine knows runtime-specific budget
support.

### Current State

- `agent.ts:applyBudgetFlags(base, runtime, maxTurns)` switches on
  runtime ID inside the engine.
- `engine.ts:warnBudgetCaveats` walks the config to detect
  non-Claude+max_turns nodes — engine-side runtime taxonomy.
- HITL resume in `hitl.ts` re-applies budget flags — duplication.
- Library adapters return `CliRunOutput.total_cost_usd | undefined`
  with no contract on what undefined means.

### Constraints

- Cross-repo: lib changes ship first, this repo bumps JSR pin
  afterward.
- FR-E47 acceptance criteria preserved at the user-visible level
  (`--budget` aborts overspending workflows; per-node `max_usd` fails
  the node).
- Engine remains domain-agnostic AND runtime-agnostic — must not
  switch on runtime ID anywhere after this lands.
- `BudgetGuard` (output of engine-decomposition task) is the single
  consumer of this contract.

## Definition of Done

### In `korchasa/ai-ide-cli`

- [ ] New `RuntimeInvokeOptions` field: `budget?: { max_turns?:
      number; max_usd?: number }`. Adapter is free to honor or ignore
      individual fields; warnings flow through the result type.
- [ ] New result field: `RuntimeInvokeResult.budget?: {
      cost_usd?: number; turns?: number; max_turns_honored: boolean;
      max_usd_honored: boolean }`. Adapters set the `*_honored` flags
      so engine knows what it can rely on.
- [ ] Claude adapter: maps `budget.max_turns` → `--max-turns`,
      reports `cost_usd` from CLI JSON, sets both honored flags true.
- [ ] OpenCode/Cursor/Codex adapters: best-effort. Whichever fields
      are unsupported set `*_honored: false`; engine warns once at run
      start (deduped).
- [ ] Library FR-L<N> for "Budget contract".

### In this repo (after lib release)

- [ ] `BudgetGuard` (post engine-decomposition) reads `result.budget`
      only — no runtime ID inspection.
- [ ] `agent.ts:applyBudgetFlags` deleted.
- [ ] `engine.ts:warnBudgetCaveats` reduced to a single pass over
      first invocation results, emitting one warning per
      `*_honored: false` runtime per node.
- [ ] FR-E47 acceptance criteria rewritten in runtime-neutral terms.
      Specific flag mappings move to lib FR-L<N>.
- [ ] AGENTS.md notes "Budget enforcement is best-effort and depends
      on the runtime adapter — see lib FR-L<N>".
- [ ] `deno.json` JSR pin bumped.

## Solution

### Phase 1 — Lib design + ship

1. Open lib issue referencing this task.
2. Spec the budget contract. Implement Claude adapter (full support)
   and stub others (best-effort with `*_honored: false`).
3. Lib tests: each adapter returns the contract shape correctly.
4. Library minor release.

### Phase 2 — This repo

5. Bump JSR pin.
6. Refactor `BudgetGuard` to read `result.budget` only.
7. Delete `applyBudgetFlags`. Trim `warnBudgetCaveats` to use the
   honored flags from first invocation result.
8. Test: workflow with `--budget` against an OpenCode workflow emits
   the warning; against a Claude workflow runs silently and aborts on
   overspend as before.
9. Update FR-E47 in
   `documents/requirements-engine/05-cli-and-observability.md`.
10. Decision recorded in `2026/05/budget-cli-runtime-coupling.md`.

### Verification

- `deno task check` green.
- `grep -rn "max_turns\|--max-turns\|total_cost_usd" *.ts` outside
  test fixtures: matches only in BudgetGuard's typed contract
  destructuring, no runtime branching.
- Smoke: 4 dogfood workflows with `--budget 10` — Claude variants
  abort on overspend, OpenCode variants emit one warning and complete
  normally.
- Negative test: a node configured with `budget.max_turns` on
  non-Claude runtime emits warning once; does not silently fail.
