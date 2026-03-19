## Summary

### Files Changed

- `engine/config.ts` — Added parse-time FR-E36 validation in `validateNode()`
  loop branch: if condition node has a `validate` block, checks that at least
  one `frontmatter_field` rule declares `field` matching `condition_field`;
  throws descriptive error on mismatch.

- `engine/config_test.ts` — Added 2 FR-E36 tests: (1) condition_field missing
  from validate block throws with full error message; (2) matching
  frontmatter_field rule present passes silently.

- `engine/loop.ts` — Exported `extractConditionValue`; added `loopId` and
  `condNodeId` parameters; changed return type from `Promise<string | undefined>`
  to `Promise<string>`; throws `Error` when field not found (FR-E36 runtime
  check). Updated `runLoop` to wrap the call in try/catch and convert thrown
  error to a `LoopResult` failure instead of propagating uncaught.

- `engine/loop_test.ts` — Added 3 tests for `extractConditionValue`: throws
  when field absent from output file, throws with loop/node IDs when dir is
  empty, returns value when field present in frontmatter.

- `.auto-flow/pipeline.yaml` — Added `frontmatter_field` validation rule (field:
  verdict, allowed: [PASS, FAIL]) to `verify` node's validate block, satisfying
  FR-S37 and the new FR-E36 parse-time check simultaneously.

### Tests Added / Modified

- `engine/config_test.ts`: +2 tests (FR-E36 parse-time cross-check)
- `engine/loop_test.ts`: +3 tests (FR-E36 runtime presence check)

- `documents/requirements-engine.md` — (iter 2) added §3.36 FR-E36: Loop
  Condition Field Validation with parse-time + runtime acceptance criteria and
  evidence references; added Appendix row.
- `documents/requirements-sdlc.md` — (iter 2) added §3.37 FR-S37: Verify Node
  Verdict Frontmatter Validation with pipeline.yaml acceptance criteria and
  evidence references; added Appendix C row.

### `deno task check` Result

PASS — 533 tests, 0 failures, all lint/fmt/pipeline-integrity checks passed.
