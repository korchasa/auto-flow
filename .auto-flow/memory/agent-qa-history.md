# Agent QA — Run History

<!-- Append-only. ≤20 entries. Format per reflection-protocol.md §Layer 2. -->

## 2026-03-15T22:XX — Issue #129

- **Turns:** ~10
- **Cost:** ~$0.30 (est)
- **Verdict:** PASS
- **Outcome:** All 6 acceptance criteria passed. 483 tests, 0 failures. SKILL.md granted `scripts/check.ts` permission + FR-S31 responsibility item. SDS §3.4 updated.
- **Key learnings:**
  - `deno task check` output nested into temp file → nested again on read → use `tail -80` on first temp file to get final summary.
  - Self-approval fails → use `gh issue comment` fallback immediately.
  - Memory + history files empty on first session — normal.

## 2026-03-19T19:XX — Issue #147 (iteration 1)

- **Turns:** ~11
- **Cost:** ~$0.25 (est)
- **Verdict:** FAIL
- **Outcome:** 10/12 acceptance criteria passed. 493 tests, 0 failures. All artifact file renames correct (zero grep matches for old names). Blocking issue: FR-S32 section absent from `documents/requirements-sdlc.md` (spec says PM added it; developer's Task 3 rewrite dropped it). Self-approval failed → used `gh issue comment` fallback.
- **Key learnings:**
  - When spec's "SRS Changes" says a new FR section was added, verify it exists even if `deno task check` is green — a full-file rewrite by developer silently drops PM additions.
  - `documents/requirements-sdlc.md` too large for inline display; use `tail + Grep` pattern.
  - Grep-sweeping for old artifact names is fast and conclusive — do it early.

## 2026-03-19T18:XX — Issue #146

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** PASS
- **Outcome:** All 16 acceptance criteria passed. 493 tests, 0 failures. FR-E33 composite `artifact` validation rule fully implemented in engine/types.ts, engine/config.ts, engine/validate.ts with complete test coverage.
- **Key learnings:**
  - Fetching issue, running `deno task check`, and `git diff` all in one parallel turn reduces total turns significantly.
  - Reading all 5 changed source files in one parallel response is efficient.
  - Minor non-blocking doc inaccuracy (stale count in module docstring) does not block PASS verdict.
  - Self-approval fails → used `gh issue comment` on issue #146 as fallback.

## 2026-03-19T20:XX — Issue #147 (iteration 2)

- **Turns:** ~9
- **Cost:** ~$0.20 (est)
- **Verdict:** PASS
- **Outcome:** All 12 acceptance criteria passed. 493 tests, 0 failures. FR-S32 restored to `documents/requirements-sdlc.md` (section 3.32 + Appendix C). All artifact renames complete, zero stray old-name refs. Self-approval failed → used `gh issue comment` fallback.
- **Key learnings:**
  - On fix iterations, use targeted Grep (e.g., `grep -n "FR-S32" file`) early to confirm the blocking issue is resolved before reading large files.
  - Old artifact names appearing in FR-S32 "Motivation" section are intentional historical context — NOT a problem; distinguish from active references.
  - Running `deno task check`, `git diff`, and `gh issue view` in first parallel turn + Grep for old names and FR-S32 in second turn gives full picture in ~4 turns.

## 2026-03-19T21:XX — Issue #148 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 3/5 criteria passed. 493 tests, 0 failures. Implementation correct: all 6 symlinks deleted, check.ts symlink validation block removed, design-sdlc.md fully updated. Blocking: `documents/requirements-sdlc.md` not in diff and has 0 matches for "FR-S33" — PM agent never added FR-S33 section or promised NFR/Appendix updates. Stale FR-S13 AC (line 297) now contradicts FR-S33 (claims standalone /agent-<name> invocation still works). Self-approval failed → used `gh issue comment` fallback.
- **Key learnings:**
  - If `requirements-sdlc.md` not in diff, grep for FR number immediately — if missing, it's a PM-stage failure, not developer fault.
  - Stale ACs in existing FRs can become actively contradictory when a new FR removes a feature — check related FRs for semantic conflicts.
  - Pattern: PM agent added FR-S33 to spec but never persisted it to requirements-sdlc.md. Same root cause as issue #147 iter 1.

## 2026-03-19T23:XX — Issue #149 (iteration 1)

- **Turns:** ~7
- **Cost:** ~$0.18 (est)
- **Verdict:** FAIL
- **Outcome:** 26/28 acceptance criteria passed. 509 tests, 0 failures. Implementation correct: `readStreamLog()` with head+tail truncation, inline log viewer in `renderCard()`, distinct CSS for all 4 header status values (completed/running/failed/aborted), `computePhaseStatus()` with run_on:always separation, CLI wiring. Blocking: `documents/requirements-sdlc.md` not in diff, 0 grep matches for FR-S34 — PM agent never added section 3.34 or Appendix C row. Self-approval failed → used `gh issue comment` fallback on issue #149.
- **Key learnings:**
  - PM-stage SRS persistence failure is a recurring pattern (issues #147, #148, #149). Running grep for FR number immediately after getting git diff is essential — saves turns.
  - 509 tests (up from 493) confirms new tests were added for all new functions.
  - Strategy "parallel: deno task check + git diff + gh issue view + grep FR-SXX" works well — confirms/denies blocking in one turn.

## 2026-03-19T24:XX — Issue #149 (iteration 2)

- **Turns:** ~6
- **Cost:** ~$0.16 (est)
- **Verdict:** PASS
- **Outcome:** All 28 acceptance criteria passed. 509 tests, 0 failures. FR-S34 present at line 737 (section 3.34) and line 904 (Appendix C). Implementation: `readStreamLog()` with head+tail truncation (200+50 default), inline log viewer in `renderCard()`, 4 distinct CSS rules for header status values, `computePhaseStatus()` with run_on:always separation, CLI wiring complete. Self-approval failed → used `gh issue comment` fallback on issue #149.
- **Key learnings:**
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S34) confirmed PASS in one parallel turn — no blocking issues found.
  - For fix iterations, running the FR grep in the same batch as deno check is the optimal pattern: confirms fix before spending turns on source file reads.
  - The spec only listed 2 SRS changes (section 3.34 + Appendix C) — no NFR or Appendix B updates needed. Verify what the spec actually promises, not what prior issues did.

## 2026-03-19T22:XX — Issue #148 (iteration 2)

- **Turns:** ~7
- **Cost:** ~$0.18 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 493 tests, 0 failures. FR-S33 present at line 726 with all ACs marked [x]. NFR §4 updated (line 740), Appendix B updated (line 788), Appendix C FR-S33 row added (line 852). FR-S13 AC contradiction resolved (line 297 now references FR-S33 supersession). Self-approval failed → used `gh issue comment` fallback on issue #148.
- **Key learnings:**
  - Running `deno task check`, `git diff`, `gh issue view`, AND `grep -n "FR-S33" requirements-sdlc.md` all in one parallel turn gives full picture in 1 turn.
  - When FR is found in grep output, check all 4 spec-promised sub-sections (FR section, NFR, Appendix B, Appendix C) in the same grep output — saves a turn vs separate reads.
  - FR-S13 AC semantics evolve as system changes — check for cross-FR contradictions whenever a feature is removed.
  - `tail -40` is sufficient to get final check summary lines (vs `tail -80`).

## 2026-03-19T25:XX — Issue #150 (iteration 1)

- **Turns:** ~6
- **Cost:** ~$0.16 (est)
- **Verdict:** FAIL
- **Outcome:** 7/10 acceptance criteria passed. 514 tests, 0 failures. Implementation correct: mutual-exclusivity validation added to `engine/config.ts` (lines 133–149), `setPhaseRegistry()` simplified to exclusive if/else in `engine/state.ts`, 4 new tests in `config_test.ts`, 2 new tests in `state_test.ts`. `.auto-flow/pipeline.yaml` fixed (necessary — engine now rejects both mechanisms). Blocking: `documents/requirements-engine.md` not in diff, 0 matches for FR-E33 — PM agent never added section 3.33, FR-E9 update, or Appendix cross-reference row. Self-approval failed → used `gh issue comment` fallback on issue #150.
- **Key learnings:**
  - PM-stage SRS persistence failure now extends to engine scope (requirements-engine.md), not just sdlc scope. Same grep-first strategy applies.
  - `pipeline.yaml` modification is expected and necessary when engine enforcement would break it — not out-of-scope.
  - State test at line 408 retains "falls back" name semantically (implies old dual-mechanism), but body is correct — non-blocking.
  - 514 tests (up from 509) confirms new config_test.ts + state_test.ts tests added.

## 2026-03-19T27:XX — Issue #151 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 7/9 acceptance criteria passed. 519 tests, 0 failures. All 5 implementation tasks correct: pipeline.yaml uses `{{input.specification}}/01-spec.md` (line 23), `interpolate()` in `hitl.ts:buildScriptArgs()` (line 264), template resolution test in `hitl_test.ts` (lines 232–277), `validateHitlArtifactSource()` + `hitlArtifactSource()` in `check.ts` (lines 110–146), 4 tests in `check_test.ts` (lines 109–130). Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S35 — PM agent never added section 3.35 or Appendix C row. Self-approval failed → used `gh issue comment` fallback on issue #151.
- **Key learnings:**
  - PM-stage SRS persistence failure confirmed again (6th consecutive issue: #147, #148, #149, #150, #151). Grep for FR number as 1st action after git diff — pattern is 100% reliable now.
  - 519 tests (up from 514) confirms new hitl_test + check_test tests were added.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S35) in one turn gives full picture immediately.

## 2026-03-19T26:XX — Issue #150 (iteration 2)

- **Turns:** ~6
- **Cost:** ~$0.16 (est)
- **Verdict:** PASS
- **Outcome:** All 10 acceptance criteria passed. 514 tests, 0 failures. FR-E33 present at line 665 (section 3.33), FR-E9 updated at line 180, Appendix row at line 751. Implementation confirmed: mutual-exclusivity validation in config.ts (lines 133–149), setPhaseRegistry() exclusive if/else in state.ts (lines 28–45), 4 config tests + 2 state tests all passing. pipeline.yaml fixed. One non-blocking: stale test name "falls back" at state_test.ts:408 (body correct). Self-approval failed → used `gh issue comment` fallback on issue #150.
- **Key learnings:**
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E33) confirmed PASS in one parallel turn — all SRS changes present.
  - When SRS file IS in diff and grep confirms FR presence at all promised locations, proceed directly to source file read — no further SRS investigation needed.
  - Pipeline.yaml fix (removing dual-mechanism usage) is always expected when engine adds a new validation rule that rejects it.
  - 10 ACs across SRS + config implementation + state implementation + tests is the correct decomposition for this class of issue.

## 2026-03-19T29:XX — Issue #152 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 524 tests, 0 failures. FR-E34 present at line 693 (section 3.34) and Appendix at line 786. Implementation: `engine.ts:385-388` info log at `on_error: continue` branch, 5 FR-E34 integration tests in `engine_test.ts` (lines 1009–1165), `design-engine.md` FR-E34 section at lines 617–655. Self-approval failed → used `gh issue comment` fallback on issue #152.
- **Key learnings:**
  - First time FR-E34 passed on iteration 1 — developer correctly included `requirements-engine.md` in diff and marked all ACs with evidence.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E34) confirmed PASS in one parallel turn.
  - 524 tests (up from 519) confirms 5 new FR-E34 tests were added.
  - SRS persistence failure pattern broken for this issue — PM + Developer both delivered correctly.

## 2026-03-19T31:XX — Issue #153 (iteration 2)

- **Turns:** ~5
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 528 tests, 0 failures. FR-E35 present at line 727 (§3.35) and Appendix at line 816 — blocking issue from iteration 1 resolved. Implementation: `engine/config.ts:273-289` inline forwarding validation in `validateNode()` loop branch; 4 FR-E35 tests in `config_test.ts:171-291`; `design-engine.md:109-116` (§3.1) and `design-engine.md:569-581` (§5 Logic) document the algorithm. Self-approval failed → used `gh issue comment` fallback on issue #153.
- **Key learnings:**
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E35) confirmed PASS in one parallel turn — blocking issue from iter 1 resolved.
  - `requirements-engine.md` IS in the diff this time, confirming PM-stage fix was applied.
  - 528 tests (same as iteration 1) — no new tests needed since tests were already added in iter 1.
  - Reading the existing (FAIL) QA report before overwriting is required by the Write tool — add Read step to plan.

## 2026-03-19T33:XX — Issue #154 (iteration 2)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** PASS
- **Outcome:** All 7 acceptance criteria passed. 528 tests, 0 failures. FR-S36 present at line 821 (section 3.36) and Appendix C at line 968 — blocking issue from iteration 1 resolved. Implementation: `run-dashboard.sh` wrapper (warns on failure, exits 0), `pipeline.yaml` `after:` updated to `.auto-flow/scripts/run-dashboard.sh {{run_dir}}` (line 180), `on_error: continue` and `run_on: always` retained. Self-approval failed → used `gh issue comment` fallback on issue #154.
- **Key learnings:**
  - PM-stage SRS persistence failure for issue #154 was fixed in iteration 2 — `requirements-sdlc.md` IS in diff and FR-S36 found at lines 821 and 968.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S36) confirmed PASS in one parallel turn — optimal pattern for fix iterations.
  - 528 tests unchanged from iteration 1 — no new tests needed for this sdlc-only change.
  - SDLC pipeline pattern (wrapper script replacing `|| true`) is correct approach for observable non-blocking after-script failures.

## 2026-03-19T32:XX — Issue #154 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 6/7 criteria passed. 528 tests, 0 failures. Implementation correct: `run-dashboard.sh` wrapper created (warns on failure, exits 0), `pipeline.yaml` `after:` updated to `.auto-flow/scripts/run-dashboard.sh {{run_dir}}`, `design-sdlc.md` updated. Blocking: `documents/requirements-sdlc.md` not in diff, 0 grep matches for FR-S36 — PM agent never added section 3.36 or Appendix C row. Self-approval failed → used `gh issue comment` fallback on issue #154.
- **Key learnings:**
  - PM-stage SRS persistence failure continues (issue #154). Pattern now: #147, #148, #149, #151, #153, #154 all fail on missing SRS; #150, #152 pass. Grep-first strategy is mandatory.
  - `design-sdlc.md` was in diff (SDS update correct) but `requirements-sdlc.md` was not — confirms PM-stage, not Developer-stage failure.
  - 528 tests (unchanged from #153) — no new tests needed for this sdlc-only change (wrapper script, pipeline config).

## 2026-03-19T30:XX — Issue #153 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 5/6 criteria passed. 528 tests, 0 failures. Implementation correct: `engine/config.ts:273-289` inline forwarding validation in `validateNode()` loop branch; 4 FR-E35 tests in `config_test.ts` (lines 171–291) covering all required cases; `documents/design-engine.md` §3.1 (lines 109–116) and §5 Logic (lines 569–581) document the algorithm. Blocking: `documents/requirements-engine.md` not in diff, 0 grep matches for FR-E35 — PM agent never added §3.35 or Appendix row. Self-approval failed → used `gh issue comment` fallback on issue #153.
- **Key learnings:**
  - PM-stage SRS persistence failure confirmed again (7th issue: #147, #148, #149, #150, #151, #152 passed, #153 fails again). Grep-first strategy is the mandatory first verification step.
  - 528 tests (up from 524) confirms 4 new FR-E35 tests were added.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E35) confirmed FAIL in one parallel turn — blocking identified immediately.
  - Issue #152 broke the streak (PASS on iter 1), but #153 reverts to missing SRS pattern.

## 2026-03-19T28:XX — Issue #151 (iteration 2)

- **Turns:** ~6
- **Cost:** ~$0.16 (est)
- **Verdict:** PASS
- **Outcome:** All 9 acceptance criteria passed. 519 tests, 0 failures. FR-S35 present at line 788 (section 3.35) and Appendix C at line 938. Implementation: pipeline.yaml `{{input.specification}}/01-spec.md` (line 23), `interpolate()` in `hitl.ts:buildScriptArgs()` (line 264), `validateHitlArtifactSource()` + `hitlArtifactSource()` in `check.ts` (lines 110–146), tests in `hitl_test.ts` + `check_test.ts`. Self-approval failed → used `gh issue comment` fallback on issue #151.
- **Key learnings:**
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S35) confirmed PASS in one parallel turn — blocking issue from iter 1 resolved.
  - When SRS file IS in diff and grep confirms FR at all promised locations, source file reads confirm the rest — optimal pattern for fix iterations.
  - 6 consecutive PM-stage SRS persistence failures (#147–151); the grep-first strategy is now the mandatory first verification step.
