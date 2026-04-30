# Agent QA — Run History

<!-- Append-only. ≤20 entries. Format per reflection-protocol.md §Layer 2. -->

## 2026-03-19T26:XX — Issue #150 (iteration 2)

- **Turns:** ~6
- **Cost:** ~$0.16 (est)
- **Verdict:** PASS
- **Outcome:** All 10 acceptance criteria passed. 514 tests, 0 failures. FR-E33 present at line 665 (section 3.33), FR-E9 updated at line 180, Appendix row at line 751. Implementation confirmed: mutual-exclusivity validation in config.ts (lines 133–149), setPhaseRegistry() exclusive if/else in state.ts (lines 28–45), 4 config tests + 2 state tests all passing. workflow.yaml fixed. One non-blocking: stale test name "falls back" at state_test.ts:408 (body correct). Self-approval failed → used `gh issue comment` fallback on issue #150.
- **Key learnings:**
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E33) confirmed PASS in one parallel turn — all SRS changes present.
  - When SRS file IS in diff and grep confirms FR presence at all promised locations, proceed directly to source file read — no further SRS investigation needed.
  - Workflow.yaml fix (removing dual-mechanism usage) is always expected when engine adds a new validation rule that rejects it.

## 2026-03-19T29:XX — Issue #152 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 524 tests, 0 failures. FR-E34 present at line 693 (section 3.34) and Appendix at line 786. Implementation: `engine.ts:385-388` info log at `on_error: continue` branch, 5 FR-E34 integration tests in `engine_test.ts` (lines 1009–1165), `design-engine.md` FR-E34 section at lines 617–655. Self-approval failed → used `gh issue comment` fallback on issue #152.
- **Key learnings:**
  - First time FR-E34 passed on iteration 1 — developer correctly included `requirements-engine.md` in diff.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E34) confirmed PASS in one parallel turn.

## 2026-03-19T31:XX — Issue #153 (iteration 2)

- **Turns:** ~5
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 528 tests, 0 failures. FR-E35 present at line 727 (§3.35) and Appendix at line 816. Self-approval failed → used `gh issue comment` fallback on issue #153.
- **Key learnings:**
  - Parallel strategy confirmed PASS in one parallel turn.
  - Reading the existing (FAIL) QA report before overwriting is required by Write tool.

## 2026-03-19T33:XX — Issue #154 (iteration 2)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** PASS
- **Outcome:** All 7 acceptance criteria passed. 528 tests, 0 failures. FR-S36 present at line 821 (section 3.36) and Appendix C at line 968. Self-approval failed → used `gh issue comment` fallback on issue #154.
- **Key learnings:**
  - PM-stage SRS persistence failure fixed in iteration 2. SDLC workflow pattern (wrapper script) is correct approach.

## 2026-03-20T42:XX — Issue #159 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** FAIL
- **Outcome:** 4/5 implementation criteria passed. 533 tests, 0 failures. Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S41 — PM-stage SRS persistence failure (14th consecutive).
- **Key learnings:**
  - Shell test file (.sh) is NOT part of Deno test suite — count stays same. Behavioral ACs verified by reading script directly.

## 2026-03-20T43:XX — Issue #159 (iteration 2)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 533 tests, 0 failures. FR-S41 at line 945 (§3.41) and Appendix C at line 1092. Self-approval failed → used `gh issue comment` fallback on issue #159.
- **Key learnings:**
  - Shell tests not in Deno count — non-blocking.
  - PM-stage SRS persistence failure resolved in iteration 2.

## 2026-03-20T44:XX — Issue #174 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** FAIL
- **Outcome:** 8/9 criteria passed. 533 tests, 0 failures. Blocking: FR-S42 absent from requirements-sdlc.md (16th consecutive PM failure).
- **Key learnings:**
  - Workflow config-only changes are no exception to the SRS verification step.

## 2026-03-20T45:XX — Issue #174 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 8 acceptance criteria passed. 533 tests, 0 failures. FR-S42 at line 972 and Appendix C at line 1128. Self-approval failed → used `gh issue comment` fallback on issue #174.
- **Key learnings:**
  - Config-only changes with no TypeScript: test count stays same — non-blocking.

## 2026-03-20T46:XX — Issue #175 (iteration 1)

- **Turns:** ~7
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 7/9 criteria passed. 549 tests, 0 failures. Blocking: FR-E37 absent from requirements-engine.md (17th consecutive PM failure). All 7 behavioral ACs correct.
- **Key learnings:**
  - 17th consecutive PM-stage SRS persistence failure. Grep-first strategy is essential.

## 2026-03-20T47:XX — Issue #175 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 15 criteria passed. 549 tests, 0 failures. FR-E37 at line 793 (§3.37). Self-approval failed → used `gh issue comment` fallback on issue #175.
- **Key learnings:**
  - Continuation loop condition ensures scope-check nodes enter loop even without artifact rules.

## 2026-03-20T48:XX — Issue #176 (iteration 1)

- **Turns:** ~7
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 4/5 criteria passed. 569 tests, 0 failures. Blocking: FR-E7 4 detailed criteria absent (19th consecutive PM failure).
- **Key learnings:**
  - PM-stage SRS persistence failure: old single vague criterion at line 137 — 4 detailed criteria absent.

## 2026-03-20T49:XX — Issue #176 (iteration 2)

- **Turns:** ~6
- **Cost:** ~$0.12 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 569 tests, 0 failures. FR-E7 4 detailed criteria at lines 137-140. Self-approval failed → used `gh issue comment` fallback on issue #176.
- **Key learnings:**
  - validateTemplateVars() design: pure function in template.ts returning error array — correct approach.

## 2026-03-20T50:XX — Issue #178 (iteration 1)

- **Turns:** ~9
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 9/10 acceptance criteria passed. 569 tests, 0 failures. Blocking: FR-S43/S44/S45 absent (21st consecutive PM failure).
- **Key learnings:**
  - Issue adds 3 FRs simultaneously — none persisted to requirements-sdlc.md.

## 2026-03-20T51:XX — Issue #178 (iteration 2)

- **Turns:** ~10
- **Cost:** ~$0.25 (est)
- **Verdict:** PASS
- **Outcome:** All 15 acceptance criteria passed. 569 tests, 0 failures. FR-S43/S44/S45 + Appendix C rows all present. Self-approval failed → used `gh issue comment` fallback on issue #178.
- **Key learnings:**
  - Three FRs simultaneously: grep for all 3 in one command confirms all 3 in one operation.

## 2026-03-20T52:XX — Issue #182 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.22 (est)
- **Verdict:** FAIL
- **Outcome:** 6/6 behavioral criteria passed. 576 tests, 0 failures. Blocking: FR-E38 absent (23rd consecutive PM failure). Duplicate FR-E36 row in Appendix not removed.
- **Key learnings:**
  - 23rd consecutive PM-stage SRS persistence failure. Pattern unchanged.

## 2026-03-20T54:XX — Issue #182 (iteration 2)

- **Turns:** ~9
- **Cost:** ~$0.22 (est)
- **Verdict:** PASS
- **Outcome:** All 8 acceptance criteria passed. 576 tests, 0 failures. FR-E38 at line 834 (§3.38) and Appendix row at line 924. Duplicate FR-E36 removed. Self-approval failed → used `gh issue comment` fallback on issue #182.
- **Key learnings:**
  - Duplicate Appendix row removal confirmed by sequential line scan.

## 2026-03-20T55:XX — Issue #183 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 4/7 spec ACs passed. 578 tests, 0 failures. Blocking: FR-E39 absent (24th consecutive PM failure). Non-blocking: double-v bug, platform naming deviation.
- **Key learnings:**
  - Double-v bug: github.ref_name="v1.2.3" + getVersionString() prepends v → double-v.

## 2026-03-20T56:XX — Issue #183 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.22 (est)
- **Verdict:** FAIL
- **Outcome:** 5/9 ACs passed. 578 tests, 0 failures. 4 blocking issues: FR-E39 absent, compile_test.ts missing, platform naming wrong, double-v bug.
- **Key learnings:**
  - Decision deliverables can be entirely missing on iter 2: compile_test.ts was Task 2 but never created.

## 2026-03-20T57:XX — Issue #183 (iteration 3)

- **Turns:** ~10
- **Cost:** ~$0.22 (est)
- **Verdict:** PASS
- **Outcome:** All 7 FR-E39 acceptance criteria passed. 587 tests, 0 failures. All 4 blocking issues from iteration 2 resolved. Self-approval failed → used `gh issue comment` fallback on issue #183.
- **Key learnings:**
  - Issue #183 required 3 iterations — only issue in history to need iter 3 (iter 2 had 4 blocking issues).

## 2026-04-25T22:XX — Issue #196 (iteration 3)

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 5/7 acceptance criteria passed. 741 tests, 0 failures. Blocking: FR-E49 absent from `documents/requirements-engine/04-runtime-and-hooks.md` and `requirements-engine.md` index (26th consecutive PM-stage SRS persistence failure). All behavioral ACs correct (confirmed in iter2, unchanged). `01-spec.md` now present (blocking issue from iter2 resolved). Self-request-changes failed → used `gh issue comment` fallback on issue #196.
- **Key learnings:**
  - A restored spec (01-spec.md) does not guarantee SRS was also fixed — verify both independently in parallel.
  - 26th consecutive PM-stage SRS persistence failure. Pattern unchanged across engine and sdlc scopes.
  - When previous iteration verified behavioral ACs and implementation is unchanged, reference prior verification — saves turns.
