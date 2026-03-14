---
variant: "Variant A: Minimal in-place modification"
tasks:
  - desc: "Add extractResultExcerpt() pure function to engine/output.ts"
    files: ["engine/output.ts", "engine/output_test.ts"]
  - desc: "Update nodeResult() to use extractResultExcerpt() instead of first-line truncation"
    files: ["engine/output.ts", "engine/output_test.ts"]
  - desc: "Add result field to NodeState in engine/types.ts"
    files: ["engine/types.ts"]
  - desc: "Add optional result param to markNodeCompleted() in engine/state.ts"
    files: ["engine/state.ts", "engine/state_test.ts"]
  - desc: "Add nodeResults to RunSummary and render per-node results in summary()"
    files: ["engine/output.ts", "engine/output_test.ts"]
  - desc: "Pass result excerpt to markNodeCompleted() in engine.ts at both call sites and build nodeResults for summary"
    files: ["engine/engine.ts", "engine/engine_test.ts"]
---

## Justification

I selected Variant A for three reasons:

1. **Smallest diff, lowest risk.** All changes are localized additions to
   existing files. No signature refactoring, no new modules. TypeScript compiler
   catches any type mismatches at `deno task check`.

2. **No premature abstraction.** Variant B's options-object refactor for
   `markNodeCompleted()` is premature — the function has only 2 optional params
   (`costUsd`, `result`). The AGENTS.md vision emphasizes domain-agnostic
   simplicity; adding indirection for a 4-param function contradicts "keep
   solutions simple." If more fields are needed later, refactoring to an options
   object is a trivial mechanical change.

3. **Variant C is over-engineering.** A separate `engine/excerpt.ts` module for
   a single ~10-line pure function used in 2 call sites adds file count without
   proportional benefit. The function logically belongs in `output.ts` alongside
   the `nodeResult()` that consumes it.

## Task Descriptions

### Task 1: Add extractResultExcerpt() pure function

Create `extractResultExcerpt(text: string, maxLines?: number, maxChars?: number): string`
in `engine/output.ts`. Filters empty lines, takes first N non-empty lines
(default 3), joins with ` | ` separator, truncates to maxChars (default 400).
Unit tests: empty string, single line, multi-line, blank lines filtered,
>3 lines truncated, >400 chars truncated.

### Task 2: Update nodeResult() to use extractResultExcerpt()

Replace `split("\n")[0].slice(0, 120)` with `extractResultExcerpt()` call in
`nodeResult()`. Update existing tests: replace "first line only" assertion with
multi-line excerpt assertions; update truncation length from 120 to 400 chars.

### Task 3: Add result field to NodeState

Add `result?: string` to `NodeState` interface in `engine/types.ts`. No
behavioral change — field consumed by subsequent tasks.

### Task 4: Add result param to markNodeCompleted()

Add optional `result?: string` parameter to `markNodeCompleted()` in
`engine/state.ts`, after existing `costUsd?` param. When provided, persists to
`NodeState.result`. Tests: round-trip persistence (write + read back from
state.json), backward compat (existing calls without result still work).

### Task 5: Add nodeResults to RunSummary and render in summary()

Add `nodeResults?: Record<string, string>` to `RunSummary` in
`engine/output.ts`. Update `summary()`: after "Nodes:" line, if `nodeResults`
present, render per-node lines: `  <nodeId padded>  <excerpt>`. Tests:
`summary()` with and without `nodeResults`.

### Task 6: Pass result excerpt at engine call sites and build nodeResults

In `engine/engine.ts`:
- `executeNode()`: after `markNodeCompleted()`, pass
  `extractResultExcerpt(result.output.result)` as `result` param.
- `executeLoopNode()`: pass result excerpt in `onNodeComplete` callback.
- `printSummary()`: build `nodeResults` from `state.nodes[*].result`, pass to
  `summary()`.
Tests: verify `printSummary()` includes node results when present in state.

## Summary

I selected Variant A (minimal in-place modification) for its smallest diff,
lowest risk, and alignment with the project's domain-agnostic simplicity vision.
I defined 6 ordered tasks covering both FR-E15 (extractResultExcerpt + nodeResult
upgrade) and FR-E22 (NodeState.result persistence + summary rendering).
I created branch `sdlc/issue-109` and opened a draft PR.
