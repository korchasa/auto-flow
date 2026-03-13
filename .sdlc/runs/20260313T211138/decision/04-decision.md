---
variant: "Variant A: Inline aggregation in markNodeCompleted"
tasks:
  - desc: "Extend NodeState and RunState types with cost fields"
    files: ["engine/types.ts"]
  - desc: "Add updateRunCost() helper and costUsd param to markNodeCompleted()"
    files: ["engine/state.ts"]
  - desc: "Write unit tests for cost aggregation in state"
    files: ["engine/state_test.ts"]
  - desc: "Pass cost_usd from ClaudeCliOutput to markNodeCompleted in engine.ts"
    files: ["engine/engine.ts"]
  - desc: "Pass cost_usd from ClaudeCliOutput to markNodeCompleted in loop.ts"
    files: ["engine/loop.ts"]
---

## Justification

**Variant A selected** over B (dedicated module) and C (lazy aggregation).

- **Simplicity over abstraction:** Only 2 call sites exist (`engine.ts`,
  `loop.ts`). A dedicated `CostTracker` class (Variant B) adds import surface
  and indirection for ~10 lines of logic — violates AGENTS.md principle of
  keeping engine minimal and domain-agnostic. No new module, no new class.
- **Single-read requirement:** Spec mandates that one `state.json` read
  provides complete cost visibility. Variant C computes total lazily, breaking
  this requirement — external tooling reading `state.json` would see no
  `total_cost_usd` without running Deno code.
- **Effort:** S-sized. Minimal surface area change. Optional fields ensure
  backward compatibility with existing `state.json` consumers.
- **Risk acceptance:** O(N) sum over all nodes on each completion is negligible
  for typical pipeline sizes (<20 nodes). Tight coupling between state mutation
  and cost aggregation is acceptable given the 2-call-site constraint.
- **Vision alignment (AGENTS.md):** Engine remains a generic DAG executor.
  Cost fields are optional type extensions — no domain-specific logic added
  to engine. Aggregation is pure arithmetic on existing state, consistent with
  engine's role as infrastructure.

## Task Descriptions

1. **Extend types** (`engine/types.ts`): Add `cost_usd?: number` to
   `NodeState` interface. Add `total_cost_usd?: number` to `RunState`
   interface. Both optional for backward compatibility.

2. **Add updateRunCost() + costUsd param** (`engine/state.ts`): Add optional
   `costUsd?: number` parameter to `markNodeCompleted()`. When provided, set
   `node.cost_usd = costUsd`. New `updateRunCost(state)` helper sums all
   `nodes[*].cost_usd` values (filtering undefined), writes result to
   `state.total_cost_usd`. Called from `markNodeCompleted()` when `costUsd`
   is provided.

3. **Unit tests** (`engine/state_test.ts`): 4 tests covering: (a) cost_usd
   set on node completion, (b) total_cost_usd aggregated across nodes,
   (c) undefined cost_usd skipped in sum, (d) backward compat — no cost
   fields when costUsd param omitted.

4. **Engine call site** (`engine/engine.ts`): After agent node execution,
   extract `total_cost_usd` from `ClaudeCliOutput` and pass to
   `markNodeCompleted(state, nodeId, costUsd)`.

5. **Loop call site** (`engine/loop.ts`): After loop body node execution,
   extract `total_cost_usd` from `ClaudeCliOutput` and pass to
   `markNodeCompleted(state, nodeId, costUsd)` for each iteration's body
   nodes.
