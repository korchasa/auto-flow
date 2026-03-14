---
variant: "Variant B: Per-concern extraction to dedicated modules"
tasks:
  - desc: "Extract executeAgentNode() into engine/agent-node.ts"
    files: ["engine/engine.ts", "engine/agent-node.ts"]
  - desc: "Extract executeMergeNode() + copyDir() into engine/merge.ts"
    files: ["engine/engine.ts", "engine/merge.ts"]
  - desc: "Move executeLoopNode() into engine/loop.ts"
    files: ["engine/engine.ts", "engine/loop.ts"]
  - desc: "Add delegation calls in engine.ts and verify line count ≤500"
    files: ["engine/engine.ts"]
  - desc: "Update engine_test.ts imports and verify all tests pass"
    files: ["engine/engine_test.ts"]
---

## Justification

I selected Variant B for three reasons:

1. **Sufficient margin.** Extracting ~198 lines yields ≈476 LOC in engine.ts
   — 24 lines under the 500-line FR-E24 limit. Not as aggressive as Variant A
   (385 LOC) but adequate headroom without over-engineering.

2. **Domain-aligned module boundaries.** Each extraction targets a natural
   concern: agent node execution (HITL detection, session tracking, log saving),
   merge logic (pure filesystem copy), and loop node execution (condition
   extraction, iteration). This aligns with AGENTS.md's architecture principle
   of modular, domain-agnostic engine components — each module owns one node
   type's execution semantics.

3. **Lowest effort, lowest risk.** Effort rated S vs M for Variant A. No
   large context-passing interface needed (unlike Variant A's `NodeDispatcher`
   class requiring ~10 Engine fields). No borderline LOC risk (unlike Variant
   C's ≈507 LOC). Three focused modules are easier to review and test than
   one monolithic dispatch module.

Variant A was rejected because it creates a single ~300-line module that itself
approaches the 500-line limit over time, and requires a heavyweight Engine
context interface. Variant C was rejected because ≈507 LOC exceeds the
threshold, requiring additional ad-hoc trimming.

## Task Descriptions

### Task 1: Extract executeAgentNode() into engine/agent-node.ts

Create `engine/agent-node.ts` with a standalone `executeAgentNode(params)`
function. The params object receives all dependencies: state, config, output
manager, HITL config, run directory, stream log path, user input function.
Move the 109-line method from `engine.ts` into this new module. In `engine.ts`,
replace with a ~5-line delegation call that constructs the params object and
forwards. This is the largest single extraction and must come first as
subsequent tasks depend on stable engine.ts structure.

### Task 2: Extract executeMergeNode() + copyDir() into engine/merge.ts

Create `engine/merge.ts` with `executeMergeNode()` and `copyDir()` as exported
functions. These are pure filesystem operations with no Engine class
dependencies — they receive source/dest paths and config as parameters. 32
lines extracted. Simplest extraction with zero coupling concerns.

### Task 3: Move executeLoopNode() into engine/loop.ts

Extend the existing `engine/loop.ts` module with an `executeLoopNode()` export.
Loop setup logic (condition extraction, body ordering, iteration tracking)
naturally belongs alongside `runLoop()`. The function receives engine context
(state, config, output, run directory) as a params object. 57 lines extracted.

### Task 4: Add delegation calls and verify line count

After all three extractions, `engine.ts` should contain ~476 lines. Verify
with `wc -l`. The three new delegation calls in `executeNode()` replace
direct method calls with imports. Ensure `executeNode()` dispatch switch
correctly routes to the extracted functions. Run `deno task check` to verify
no lint/type errors.

### Task 5: Update tests and verify

Update `engine/engine_test.ts` imports if any test directly references the
extracted methods. Run full test suite (`deno task test`) to confirm zero
regressions — this is AC #4 (no behavior change) and AC #5 (check passes).

## Summary

I selected Variant B (per-concern extraction) for its domain-aligned module
boundaries, sufficient LOC margin (≈476), and lowest implementation effort.
I defined 5 ordered tasks: extract agent-node (blocking), extract merge, move
loop-node, verify line count, and update tests. I created branch `sdlc/issue-92`
and opened draft PR #106.
