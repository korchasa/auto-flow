---
variant: "Variant A: Extend markNodeCompleted with optional cost parameter"
tasks:
  - desc: "Add cost_usd to NodeState and total_cost_usd to RunState in types.ts"
    files: ["engine/types.ts"]
  - desc: "Add updateRunCost helper and extend markNodeCompleted with optional costUsd param in state.ts"
    files: ["engine/state.ts"]
  - desc: "Pass agent result cost_usd through markNodeCompleted in engine.ts"
    files: ["engine/engine.ts"]
  - desc: "Pass agent result cost_usd through markNodeCompleted in loop.ts"
    files: ["engine/loop.ts"]
  - desc: "Add unit tests for cost fields in state_test.ts"
    files: ["engine/state_test.ts"]
  - desc: "Add integration tests for cost roundtrip in engine_test.ts and loop_test.ts"
    files: ["engine/engine_test.ts", "engine/loop_test.ts"]
---

## Justification

**Variant A selected** over B and C for these reasons:

1. **Semantic correctness:** Cost is known at node completion time — recording it
   inside `markNodeCompleted()` matches the data lifecycle. One call site per
   completion, zero risk of orphaned cost updates (Variant B's main weakness).

2. **Centralized state logic:** All state mutations stay in `state.ts`. The
   `updateRunCost()` helper keeps aggregation logic in one place (Variant C
   duplicates it across engine.ts and loop.ts — DRY violation).

3. **Backward compatibility:** Optional `costUsd?: number` parameter. All
   existing call sites continue working without changes until explicitly updated.
   No signature breaks.

4. **Vision alignment (AGENTS.md):** "Engine is domain-agnostic" — cost tracking
   is a generic engine concern (not git/GitHub/domain-specific). Adding it to
   `state.ts` keeps the engine's state management layer cohesive without leaking
   domain logic.

5. **Minimal complexity:** Effort S. 3 call sites to update (engine.ts, loop.ts,
   state_test.ts). O(N) running total recomputation is negligible at pipeline
   scale (typically <20 nodes).

Variant B rejected: decoupled `recordNodeCost()` requires two function calls at
every completion site — fragile when adding new node types. Extra abstraction
without benefit for current scope.

Variant C rejected: inline cost aggregation in engine.ts/loop.ts bypasses
state.ts abstraction, duplicates reduce logic, harder to extend for future cost
budgets (FR deferred in spec).

## Task Descriptions

### Task 1: Type additions (types.ts)
Add `cost_usd?: number` to `NodeState` interface. Add `total_cost_usd?: number`
to `RunState` interface. Both optional — backward compatible with existing
state.json files.

### Task 2: State logic (state.ts)
Add `updateRunCost(state: RunState): void` — iterates `Object.values(state.nodes)`,
sums `cost_usd` fields, writes result to `state.total_cost_usd`. Extend
`markNodeCompleted(state, nodeId, costUsd?)` — if `costUsd` provided, sets
`node.cost_usd = costUsd` then calls `updateRunCost(state)`. Depends on Task 1.

### Task 3: Engine integration (engine.ts)
In `executeNode()` after `markNodeCompleted()` call (~line 340), pass
`agentResult?.output?.total_cost_usd` as the cost argument. The `AgentResult`
already carries `output.total_cost_usd` from Claude CLI parsing. Depends on
Task 2.

### Task 4: Loop integration (loop.ts)
In `runLoop()` at the `markNodeCompleted()` call for body nodes (~line 97), pass
`result.output?.total_cost_usd` as cost argument. Same pattern as Task 3.
Depends on Task 2.

### Task 5: Unit tests (state_test.ts)
Test `markNodeCompleted` with cost param: verify `node.cost_usd` set correctly.
Test `updateRunCost`: verify `total_cost_usd` sums across multiple nodes. Test
backward compat: `markNodeCompleted` without cost param leaves fields undefined.
Depends on Task 2.

### Task 6: Integration tests (engine_test.ts, loop_test.ts)
Verify end-to-end: agent node produces cost → `state.json` contains per-node
`cost_usd` and correct `total_cost_usd`. Verify loop body nodes accumulate cost.
Depends on Tasks 3-4.
