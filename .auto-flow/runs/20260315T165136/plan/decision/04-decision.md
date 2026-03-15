---
variant: "Variant A: Single dispatch module (node-dispatch.ts)"
tasks:
  - desc: "Create engine/node-dispatch.ts with EngineContext type and 4 executor functions"
    files: ["engine/node-dispatch.ts"]
  - desc: "Refactor engine/engine.ts to delegate node execution to node-dispatch.ts"
    files: ["engine/engine.ts"]
  - desc: "Update engine/mod.ts re-exports if node-dispatch exposes public symbols"
    files: ["engine/mod.ts"]
  - desc: "Run full engine test suite to verify zero behavioral change"
    files: ["engine/engine_test.ts"]
---

## Justification

I selected Variant A for the following reasons:

1. **Lowest effort (S):** Single new file (`node-dispatch.ts`, ~230 lines)
   vs Variant B's 3 new/modified files or Variant C's 3 new files with
   bidirectional dependency risk.

2. **Ample margin:** Engine.ts drops to ~490 LOC — 10 lines under the 500-LOC
   limit (FR-E30). Variant C's ~498 is dangerously tight; any future addition
   re-exceeds the limit.

3. **Zero test disruption:** All 4 executors are private methods called via
   `Engine.executeNode()`. Extracting them to free functions called from the
   same switch statement preserves the public API. `engine_test.ts` requires
   zero import changes. Variant B requires updating `runPreRunScript` import
   path.

4. **Established precedent:** `post-pipeline.ts` already groups multiple
   related-but-distinct concerns (collection + sorting + execution) into a
   single module. `node-dispatch.ts` follows this pattern.

5. **Vision alignment (AGENTS.md):** The project vision emphasizes a
   domain-agnostic DAG executor with clean separation of orchestration from
   execution. Variant A makes `engine.ts` a pure orchestrator (config loading,
   state management, level iteration, delegation) while `node-dispatch.ts`
   encapsulates all node-type-specific execution logic behind a unified
   `EngineContext` parameter bag.

## Task Descriptions

### Task 1: Create `engine/node-dispatch.ts`

Define `EngineContext` interface containing fields currently accessed via `this`
in executor methods: `config`, `state`, `output`, `options`, `userInput`,
`buildContext()`, `saveState()`. Extract these free functions:

- `executeAgentNode(ctx, nodeId, nodeConfig)` — agent invocation, HITL check,
  log save (~109 lines)
- `executeMergeNode(ctx, nodeId, nodeConfig)` — directory copy (~20 lines)
- `executeLoopNode(ctx, nodeId, nodeConfig)` — loop delegation + callbacks
  (~57 lines)
- `executeHumanNode(ctx, nodeId, nodeConfig)` — terminal prompt (~20 lines)
- `copyDir(src, dest)` — utility free function (~13 lines)

Total: ~230 lines.

### Task 2: Refactor `engine/engine.ts`

Replace inline executor method bodies with imports from `node-dispatch.ts`.
The `executeNode()` switch statement calls `executeAgentNode(ctx, ...)` etc.,
constructing the `EngineContext` bag from `this.*` fields. Remove `copyDir()`
and the 4 method bodies. Net reduction: ~220 lines → engine.ts ~490 LOC.

### Task 3: Update `engine/mod.ts` re-exports

If `node-dispatch.ts` exports any symbols needed by external consumers (e.g.,
`copyDir` used in tests), add re-export in `mod.ts`. Likely minimal — most
symbols are internal.

### Task 4: Run full engine test suite

Execute `deno task test:engine` to verify all existing tests pass unchanged.
This is the primary acceptance gate — zero behavioral change is the requirement.

## Summary

I selected Variant A (single `node-dispatch.ts` dispatch module) for its
lowest effort, ample LOC margin (~490 vs 500 limit), zero test disruption,
and alignment with the project's established module grouping pattern. I defined
4 tasks covering module creation, engine refactoring, re-export updates, and
test verification. I created branch `sdlc/issue-92` and will open a draft PR.
