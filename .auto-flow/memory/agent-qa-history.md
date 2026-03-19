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
