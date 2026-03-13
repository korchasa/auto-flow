---
variant: "Variant A: Minimal — extend markNodeCompleted() with optional cost param"
tasks:
  - desc: "Add cost_usd to NodeState and total_cost_usd to RunState interfaces"
    files: ["engine/types.ts"]
  - desc: "Extend markNodeCompleted() with optional costUsd param; add recomputeTotalCost() helper"
    files: ["engine/state.ts"]
  - desc: "Write unit tests for cost aggregation in markNodeCompleted and recomputeTotalCost"
    files: ["engine/state_test.ts"]
  - desc: "Pass result.output.total_cost_usd to markNodeCompleted() at both call sites in engine.ts"
    files: ["engine/engine.ts"]
  - desc: "Pass cost from result.output.total_cost_usd to markNodeCompleted() in loop body completion"
    files: ["engine/loop.ts"]
---

## Justification

**Selected: Variant A** over B (separate function) and C (engine-only tracking).

- **Centralized cost logic in state.ts.** Aligns with engine's domain-agnostic
  architecture (AGENTS.md Key Decision: "Engine is domain-agnostic"). Cost
  aggregation belongs in the state module alongside existing node-completion
  bookkeeping (`duration_ms`, `session_id`, `continuations`), not scattered
  across engine.ts/loop.ts (Variant C's weakness).
- **Single atomic mutation per node completion.** Variant B introduces two
  sequential state mutations (`markNodeCompleted` + `recordNodeCost`) creating
  ordering concerns for crash consistency. Variant A writes cost in the same
  call that sets `completed` status — atomic from the caller's perspective.
- **Minimal surface area.** Optional `costUsd?` param preserves backward compat
  — all existing callers (2 in engine.ts, 1 in loop.ts) continue working
  unchanged until updated to pass cost. No new exported functions (vs Variant B).
- **Effort S.** Smallest diff: type additions + one signature extension + one
  helper. Variant C requires M effort with scattered integration logic.
- **Testable in isolation.** `markNodeCompleted` + `recomputeTotalCost` unit-
  testable in `state_test.ts` without mocking engine or CLI output.

## Task Descriptions

### Task 1: Add cost fields to type interfaces

Add `cost_usd?: number` to `NodeState` (per-node cost from
`ClaudeCliOutput.total_cost_usd`). Add `total_cost_usd?: number` to `RunState`
(aggregate sum). Both optional for backward compat with existing state.json
files.

### Task 2: Extend markNodeCompleted + recomputeTotalCost helper

Extend `markNodeCompleted(state, nodeId, costUsd?)` — when `costUsd` provided,
sets `state.nodes[nodeId].cost_usd = costUsd`. Add `recomputeTotalCost(state)`
that sums all `cost_usd` across `state.nodes` (undefined treated as 0), writes
to `state.total_cost_usd`. Called at end of `markNodeCompleted()`.

### Task 3: Unit tests for cost aggregation

Tests in `engine/state_test.ts`:
- `markNodeCompleted` with cost param → node has `cost_usd`, run has
  `total_cost_usd`.
- `markNodeCompleted` without cost param → no `cost_usd` on node, existing
  `total_cost_usd` unchanged.
- Multiple nodes with mixed defined/undefined costs → correct aggregate.
- `recomputeTotalCost` with all-undefined costs → `total_cost_usd` = 0.

### Task 4: Pass cost at engine.ts call sites

In `executeNode()` after agent execution, pass
`result.output?.total_cost_usd` to `markNodeCompleted(this.state, nodeId,
result.output?.total_cost_usd)`. Single call site in engine.ts (line ~340).

### Task 5: Pass cost in loop body completion

In `loop.ts` `runLoop()`, at `markNodeCompleted(state, bodyNodeId)` call (~line
97), pass `result.output?.total_cost_usd` from the body node's agent result.
