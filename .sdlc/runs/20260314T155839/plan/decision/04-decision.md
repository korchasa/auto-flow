---
variant: "Variant A: Two new modules (HITL handler + post-pipeline)"
tasks:
  - desc: "Extract HITL handler to engine/hitl-handler.ts"
    files: ["engine/hitl-handler.ts", "engine/engine.ts"]
  - desc: "Extract post-pipeline executor to engine/post-pipeline.ts"
    files: ["engine/post-pipeline.ts", "engine/engine.ts"]
  - desc: "Relocate free functions to appropriate modules"
    files: ["engine/engine.ts", "engine/agent.ts", "engine/config.ts"]
  - desc: "Update Engine class to delegate to new modules"
    files: ["engine/engine.ts", "engine/mod.ts"]
  - desc: "Update and verify all engine tests pass"
    files: ["engine/engine_test.ts"]
---

## Justification

I selected Variant A because it directly addresses both structural problems
identified in the spec — duplicated HITL logic and tangled post-pipeline
orchestration — with focused, single-responsibility modules. Key factors:

- **Target margin:** ~470 LOC estimate gives comfortable buffer vs ≤500 target.
  Variant C (~490-510) risks exceeding the limit. Variant B (~400) provides
  more headroom but at the cost of a larger diff and broader param surface.
- **Merge conflict risk:** Variant A's diff is smaller than Variant B, reducing
  conflict likelihood with parallel engine PRs #90 and #91.
- **Modularity alignment:** AGENTS.md vision states "domain-agnostic DAG
  executor" with clean module boundaries. Two focused extraction modules
  (hitl-handler, post-pipeline) match this architectural direction better than
  Variant C's inline-only approach which keeps logic in the Engine class.
- **HITL coupling (managed risk):** The main risk — HITL handler needing Engine
  state access — is addressed via explicit param passing (discriminated union
  param with `mode: "resume" | "detect"`), avoiding tight coupling to Engine
  internals.

## Task Descriptions

### Task 1: Extract HITL handler to `engine/hitl-handler.ts`

Create `engine/hitl-handler.ts` (~80 LOC) with unified `handleAgentHitl()`
function. This function accepts a discriminated union param (`mode: "resume" |
"detect"`) and consolidates both HITL paths from `executeAgentNode()`:
resume-from-waiting (lines 373–429) and detect-after-run (lines 461–517).
Includes `runHitlLoop` call, `markNodeFailed`/`markNodeWaiting`, session_id +
log saving. Each 57-line block in `executeAgentNode()` reduces to ~5-line call.

### Task 2: Extract post-pipeline executor to `engine/post-pipeline.ts`

Create `engine/post-pipeline.ts` (~90 LOC). Move existing free functions
`collectPostPipelineNodes()`, `sortPostPipelineNodes()`, `runFailureHook()`
here. Add `executePostPipeline()` function extracted from `runWithLock()` lines
171–213: failure hook invocation, `run_on` filtering, per-node `executeNode()`
with error swallowing. `runWithLock()` becomes: init → ensureDirs →
filterLevels → execute levels → call `executePostPipeline()` → finalize.

### Task 3: Relocate free functions to appropriate modules

Move remaining free functions from `engine/engine.ts` bottom (lines 715–849):
- `resolveInputArtifacts()` → `engine/agent.ts` (input resolution is
  agent-execution concern)
- `findNodeConfig()`, `collectAllNodeIds()` → `engine/config.ts` (config
  querying belongs with config loading)
- `copyDir()` stays in `engine.ts` (only used by `executeMergeNode()`, 12 LOC)

### Task 4: Update Engine class to delegate to new modules

Update `engine/engine.ts` imports to reference new modules. `executeAgentNode()`
calls `handleAgentHitl()` at both branch points. `runWithLock()` calls
`executePostPipeline()`. Update `engine/mod.ts` exports if new modules expose
public API.

### Task 5: Update and verify all engine tests pass

Run `engine/engine_test.ts` and all engine tests. Pure refactoring — no test
changes expected. If tests reference moved functions by import path, update
imports. Verify `deno task check` passes.

## Summary

I selected Variant A (two new modules: `hitl-handler.ts` + `post-pipeline.ts`)
for its clean separation of concerns, comfortable ≤500 LOC margin (~470), and
smaller diff vs Variant B. I defined 5 dependency-ordered tasks covering HITL
extraction, post-pipeline extraction, free function relocation, delegation
updates, and test verification. I created branch `sdlc/issue-92` and opened a
draft PR.
