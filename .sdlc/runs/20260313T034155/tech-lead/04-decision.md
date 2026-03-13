---
variant: "Variant A"
tasks:
  - desc: "Add post-pipeline filtering to dry-run path in engine.ts"
    files: [".sdlc/engine/engine.ts"]
  - desc: "Extend dryRunPlan() signature and render post-pipeline section in output.ts"
    files: [".sdlc/engine/output.ts"]
  - desc: "Add/update tests for dry-run post-pipeline filtering"
    files: [".sdlc/engine/engine_test.ts"]
---

## Critique

### Variant A: Filter in engine, extend `dryRunPlan()` signature

- **Issue:** Claims ~5 lines of "duplicated" filtering logic between dry-run and
  normal paths. In practice the duplication is 4 lines
  (`collectPostPipelineNodes` + `sortPostPipelineNodes` + `.map().filter()`).
  This is acceptable — the two call sites have different downstream needs
  (dry-run renders text; normal path executes nodes), so extracting a shared
  helper provides no meaningful benefit. The plan correctly identifies the
  minimal change set.

### Variant B: Extract shared filter helper

- **Issue:** Over-engineering. The plan itself acknowledges this: "Introduces
  abstraction for logic used in only 2 call sites." The helper would return a
  `{ filteredLevels, postPipelineNodeIds }` tuple used once each in two callers.
  Net code increase vs Variant A with no behavioral gain. Violates YAGNI.

### Variant C: Delegate filtering to `OutputManager`

- **Issue:** Violates separation of concerns (plan correctly identifies this).
  `OutputManager` is a pure presentation layer — it currently has zero knowledge
  of `run_on` semantics, `NodeConfig`, or DAG topology. Adding filtering logic
  there creates a new dependency direction (`output.ts` → `types.ts` for
  `NodeConfig`). Would also make `dryRunPlan()` harder to test in isolation
  since it would need a full node config map.

## Justification

**Selected: Variant A.**

- **Technical fit:** Minimal change (~20 lines across 2 files). Reuses existing
  `collectPostPipelineNodes()` and `sortPostPipelineNodes()` functions already
  proven in the normal execution path (engine.ts L100-109). No new abstractions,
  no new dependencies.
- **Vision alignment:** AGENTS.md states "Engine is domain-agnostic: Engine is a
  generic DAG executor." Variant A keeps filtering logic in engine.ts (the DAG
  executor) and rendering in output.ts (presentation). Variant C would leak
  domain knowledge into the output layer. Variant A preserves the clean
  separation.
- **Complexity/maintainability:** Lowest complexity. The 4-line "duplication"
  is trivially readable and each call site can evolve independently (dry-run
  may want different formatting; normal path may add execution logic). No
  indirection, no abstraction tax.

## Task Descriptions

### Task 1: Add post-pipeline filtering to dry-run path in engine.ts

In the `if (this.options.dry_run)` block (L68-74), before calling
`dryRunPlan()`:
1. Call `collectPostPipelineNodes(this.config.nodes)` → raw IDs.
2. Call `sortPostPipelineNodes(rawIds, this.config.nodes)` → sorted IDs.
3. Filter levels: `levels.map(l => l.filter(...)).filter(l => l.length > 0)`.
4. Build `runOnMap: Record<string, string>` from config nodes' `run_on` field.
5. Pass `filteredLevels`, `labels`, `postPipelineNodeIds`, `runOnMap` to
   `dryRunPlan()`.

### Task 2: Extend dryRunPlan() in output.ts

1. Add optional parameters `postPipelineNodeIds?: string[]` and
   `runOnMap?: Record<string, string>` to `dryRunPlan()` signature.
2. After rendering regular levels, if `postPipelineNodeIds` is non-empty,
   render a "Post-pipeline:" section listing each node with its `run_on`
   condition and label.
3. Existing callers passing only `(levels, labels)` continue to work (backward
   compatible via optional params).

### Task 3: Add/update tests for dry-run post-pipeline filtering

1. Add test: dry-run with `run_on` nodes → verify they appear in
   "Post-pipeline" section, not in regular levels.
2. Add test: dry-run without `run_on` nodes → verify no "Post-pipeline"
   section rendered.
3. Update any existing dry-run tests broken by new parameter signature.
