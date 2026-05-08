---
date: "2026-05-01"
status: done
implements: [FR-E47]
tags: [decision, engine, budget, library, accepted]
related_tasks:
  - 2026/05/budget-to-cli-lib.md
---
# Budget enforcement is coupled to the CLI runtime; planned move into `@korchasa/ai-ide-cli`

> **Status:** Accepted (records current coupling; migration planned in
> `2026/05/budget-to-cli-lib.md`).

## Goal

Acknowledge the runtime-specific reality of FR-E47 budget enforcement
explicitly so reviewers of the cross-repo migration task have a stable
reference point — and define the target boundary (engine = generic
predicate; adapter = USD/turns mechanics).

## Overview

### Context

FR-E47 (Run Budget Enforcement) gave the engine three budget knobs:
workflow-wide `--budget <USD>` cap, per-node `budget.max_usd`, and
per-node `budget.max_turns` (passed as `--max-turns N` to the CLI
runtime). All three are evaluated by engine code in `engine.ts`,
`loop.ts`, `agent.ts`, and `config.ts`.

The reality of the implementation reveals that two of the three
mechanisms are tightly bound to a specific runtime adapter:

- `budget.max_turns` emits `--max-turns N` only when the runtime is
  `claude`. Non-Claude runtimes ignore it with a one-line warning at
  workflow start (FR-E47 acceptance §5; `engine.ts::warnBudgetCaveats`).
  The flag is a Claude-CLI surface, not a runtime-agnostic primitive.
- `total_cost_usd` USD checks rely on the adapter populating
  `node.cost_usd` from `CliRunOutput.total_cost_usd`. Runtimes that
  don't report cost (Cursor today; future stub adapters) cause USD-
  based checks to no-op silently, with a warning at workflow start
  (FR-E47 acceptance §6; `warnBudgetCaveats` second branch).

Result: the engine spends a non-trivial chunk of `engine.ts` /
`loop.ts` / `agent.ts` doing accounting that only one adapter
actually feeds. The "engine is domain-agnostic" NFR (`AGENTS.md` Key
Decisions) is in tension with "engine knows about CLI cost
schemas".

### Constraints

- While the migration is pending, the YAML budget field schema MUST
  stay back-compat — workflows authored under FR-E47 today must keep
  working after the move.
- Tests in `cli_test.ts`, `config_test.ts`, `loop_test.ts`,
  `agent_test.ts` cover the resolution cascade and per-runtime
  behaviour.

## Definition of Done

- [x] Coupling recognized explicitly and accepted as the current state.
- [x] Plan to relocate budget primitives (cost-tracking, turn-cap flag
      emission, per-node cap evaluation, loop pre-check) into
      `@korchasa/ai-ide-cli` as adapter-side responsibilities.
- [x] Engine retains only:
      - Workflow-wide kill-switch (workflow stops when a host-supplied
        callback says "you've spent too much") — generic predicate,
        not USD-specific.
      - YAML schema fields, validated at config load and forwarded
        verbatim to the adapter.
- [x] Migration scoped in `2026/05/budget-to-cli-lib.md` (cross-repo —
      library minor release ships first, engine pins the new version,
      deletes the duplicated code on the second release).

## Solution

### Decision

Recognize the coupling explicitly and accept it as the current
state. Plan to relocate the budget primitives (cost-tracking,
turn-cap flag emission, per-node cap evaluation, loop pre-check)
into `@korchasa/ai-ide-cli` as adapter-side responsibilities, with
the engine retaining only:

- The workflow-wide kill-switch (workflow stops when a host-supplied
  callback says "you've spent too much") — a generic predicate, not
  USD-specific.
- The YAML schema fields, validated at config load and forwarded
  verbatim to the adapter.

The migration is scoped in `2026/05/budget-to-cli-lib.md` (cross-repo —
library minor release ships first, engine pins the new version,
deletes the duplicated code on the second release). Until that task
lands, the FR-E47 implementation in the engine is the source of
truth.

### Consequences

- **Positive.** Records the rationale BEFORE the migration so
  reviewers of the cross-repo task have a stable reference point.
  Makes the "engine is domain-agnostic" tension explicit rather
  than ambient. After migration, new adapters can ship full budget
  semantics without engine changes.
- **Negative.** Until the migration lands, engine code carries
  CLI-specific accounting. Two runtime caveats (`max_turns` Claude-
  only; cost reporting adapter-dependent) must be re-documented in
  every workflow that wires budgets.
- **Cross-link.** Implements / documents FR-E47 (see
  `documents/requirements-engine/05-cli-and-observability.md` §3.47).

### Alternatives Considered

- **Keep budget enforcement fully in the engine forever.** Rejected
  — every new adapter forces the engine to learn its cost surface,
  which violates the domain-agnostic NFR. The further the engine
  drifts from "DAG executor", the harder decomposition becomes
  (cf. `2026/05/isolation-provider.md`).
- **Drop USD enforcement; keep only `max_turns`.** Rejected — USD
  caps are the safety primitive operators actually want for unbounded
  loops. Removing them in favour of a turn count would push cost
  surprises onto the operator.
- **Negotiate a runtime-agnostic cost protocol (e.g., abstract
  "spend") in the library AND keep enforcement in the engine.**
  Rejected as a half-measure — moves only the type and leaves the
  accounting pull on the engine. The full move (engine becomes a
  consumer of an adapter-emitted "abort" signal) is the target.
