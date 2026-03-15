---
variant: "Variant A: Extract function + constants"
tasks:
  - desc: "Create scripts/backoff.ts exporting nextPause() and constants"
    files: ["scripts/backoff.ts"]
  - desc: "Create scripts/backoff_test.ts with moved nextPause tests"
    files: ["scripts/backoff_test.ts"]
  - desc: "Remove local nextPause + constants from self_runner.ts, add import"
    files: ["scripts/self_runner.ts"]
  - desc: "Remove local nextPause + constants from loop_in_claude.ts, add import"
    files: ["scripts/loop_in_claude.ts"]
  - desc: "Remove nextPause tests from self_runner_test.ts"
    files: ["scripts/self_runner_test.ts"]
---

## Justification

I selected Variant A because it fully eliminates all duplication — both the
`nextPause()` function and the three constants (`MIN_PAUSE_SEC`, `MAX_PAUSE_SEC`,
`BACKOFF_FACTOR`). This aligns with the project vision (AGENTS.md) of a clean,
maintainable engine codebase where shared utilities have a single authoritative
source.

Variant B leaves `MIN_PAUSE_SEC` duplicated in both scripts, creating a future
divergence risk — partial DRY is worse than no DRY because it creates a false
sense of consolidation. Variant C adds an optional parameter, which the spec
explicitly excludes ("no logic changes") and constitutes scope creep for a
1-line function.

Variant A stays strictly within the "extraction only, no behavioral changes"
boundary defined in the spec. The effort is S (small) — 5 files touched, all
mechanical moves.

## Task Descriptions

**Task 1: Create `scripts/backoff.ts`**
New module exporting `nextPause(current: number): number` and three constants:
`MIN_PAUSE_SEC` (60), `MAX_PAUSE_SEC` (14400), `BACKOFF_FACTOR` (2). Pure
function, no side effects. This is the single source of truth for backoff logic.

**Task 2: Create `scripts/backoff_test.ts`**
Move the 3 existing `nextPause` tests from `self_runner_test.ts` into a
dedicated test file. Import from `backoff.ts`. Tests cover: basic doubling,
max cap, and min floor. No new tests needed — existing coverage is sufficient.

**Task 3: Update `scripts/self_runner.ts`**
Remove local `nextPause()` function definition (lines 10-12) and local
constants `MIN_PAUSE_SEC`, `MAX_PAUSE_SEC`, `BACKOFF_FACTOR` (lines 9-16).
Add `import { nextPause, MIN_PAUSE_SEC } from "./backoff.ts"`. `MIN_PAUSE_SEC`
is used in the main loop for pause reset on success.

**Task 4: Update `scripts/loop_in_claude.ts`**
Same removals as Task 3 (lines 13-19). Add identical import. Both scripts
use `MIN_PAUSE_SEC` for reset-on-success logic in their main loops.

**Task 5: Update `scripts/self_runner_test.ts`**
Remove the 3 `nextPause` test cases and remove `nextPause` from the import
statement. Remaining tests (`printUsage`, `checkArgs` etc.) stay unchanged.

## Summary

I selected Variant A (extract function + constants) for full DRY elimination
with zero behavioral changes, aligning with the engine's maintainability goals.
I defined 5 dependency-ordered tasks: create shared module, create dedicated
tests, update both consumer scripts, clean up old test file. Branch
`sdlc/issue-89` created with draft PR.
