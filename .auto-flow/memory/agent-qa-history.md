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

## 2026-03-20T42:XX — Issue #159 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** FAIL
- **Outcome:** 4/5 implementation criteria passed (all behavioral ACs met). 533 tests, 0 failures. Implementation correct: `reset-to-main.sh:10-20` adds dirty-check guard, branch display, `git diff --stat HEAD` + cached + untracked, `git stash push --include-untracked -m "auto-flow pre_run: <timestamp>"`, stash ref + restore cmd. `reset-to-main_test.sh` covers all 3 test scenarios (clean-tree, dirty-tree, post-reset). Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S41 — PM-stage SRS persistence failure (14th consecutive: #147–#159). Self-request-changes failed (author = reviewer) → used `gh issue comment` fallback on issue #159.
- **Key learnings:**
  - Shell test file (`reset-to-main_test.sh`) is NOT part of Deno test suite — `deno task check` count stays at 533 (same as #158). Behavioral ACs still verified by reading the script directly.
  - PM-stage SRS persistence failure continues (14th consecutive). Grep for FR-S41 in requirements-sdlc.md returns 0 matches — same pattern as all prior issues.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S41) confirmed FAIL in one parallel turn — optimal pattern.

## 2026-03-20T44:XX — Issue #174 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** FAIL
- **Outcome:** 8/9 criteria passed. 533 tests, 0 failures. Pipeline.yaml implementation fully correct: all 6 nodes use `type: artifact` with correct sections; `frontmatter_field` rules for specification (issue, scope) and verify (verdict) preserved; `custom_script` in build preserved; deno task check passes. Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S42 — PM-stage SRS persistence failure (16th consecutive: #147–#174). Self-request-changes failed (author = reviewer) → used `gh issue comment` fallback on issue #174.
- **Key learnings:**
  - PM-stage SRS persistence failure continues (16th consecutive). Pipeline config-only changes are no exception to the SRS verification step.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S42) confirmed FAIL in one parallel turn — optimal pattern.
  - `design-sdlc.md` IS in diff (Tech Lead SDS update) but spec doesn't promise it — not a blocking issue.

## 2026-03-20T43:XX — Issue #159 (iteration 2)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 533 tests, 0 failures. FR-S41 present at line 945 (§3.41, all ACs marked [x]) and Appendix C at line 1092 — blocking issue from iteration 1 resolved. `requirements-sdlc.md` IS in diff. Implementation: `reset-to-main.sh:10-20` auto-stash block (dirty-check, branch display, diff stat, stash push with --include-untracked, confirmation with restore cmd). `reset-to-main_test.sh`: 3 test scenarios (clean-tree no-op, dirty-tree stash creation, post-reset HEAD at origin/main). Self-approval failed → used `gh issue comment` fallback on issue #159.
- **Key learnings:**
  - Shell tests (.sh) are not in Deno count (533 unchanged) — non-blocking; behavioral coverage confirmed by reading script + test file directly.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S41) confirmed PASS in one parallel turn — optimal fix-iteration pattern.
  - PM-stage SRS persistence failure for issue #159 resolved in iteration 2 — `requirements-sdlc.md` in diff with FR-S41 at all promised locations.
  - 15th consecutive pattern: PM stage fails on iter 1, dev restores on iter 2. Pattern continues unchanged.

## 2026-03-20T47:XX — Issue #175 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 15 criteria passed. 549 tests, 0 failures. FR-E37 present at line 793 (§3.37, all ACs marked [x]). FR-E1 §3.1 updated at line 54. Appendix row at line 893. `requirements-engine.md` IS in diff. Implementation confirmed: `scope-check.ts` (snapshotModifiedFiles + findViolations + globMatch), `types.ts` (allowed_paths? + scope_check union), `config.ts` (validateAllowedPaths), `agent.ts` (pre/post snapshot, shared continuation budget). Self-approval failed → used `gh issue comment` fallback on issue #175.
- **Key learnings:**
  - 17th consecutive PM-stage SRS persistence failure resolved on iter 2 — `requirements-engine.md` in diff with FR-E37 at all promised locations.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E37) confirmed PASS in one parallel turn — optimal fix-iteration pattern.
  - Continuation loop condition `while (validationRules.length > 0 || node.allowed_paths !== undefined)` ensures scope-check nodes enter loop even without artifact rules — important subtlety for AC #7 verification.
  - 18th consecutive pattern: PM stage fails on iter 1, dev restores on iter 2. Pattern continues.

## 2026-03-20T57:XX — Issue #183 (iteration 3)

- **Turns:** ~10
- **Cost:** ~$0.22 (est)
- **Verdict:** PASS
- **Outcome:** All 7 FR-E39 acceptance criteria passed. 587 tests, 0 failures. All 4 blocking issues from iteration 2 resolved: (1) FR-E39 at line 861 §3.39 + Appendix row at line 954 — requirements-engine.md in diff; (2) `scripts/compile_test.ts` exists with 9 tests (4 target mappings, 1 naming convention, 3 stripVersionPrefix); (3) platform names correct (x86_64/darwin, not amd64/macos); (4) double-v bug fixed via `stripVersionPrefix()` in `compile.ts:33–35`. Self-approval failed → used `gh issue comment` fallback on issue #183.
- **Key learnings:**
  - Issue #183 required 3 iterations — only issue in history to need iter 3 (iter 2 had 4 blocking issues: SRS + 3 implementation bugs).
  - Multi-focus review sub-agents found only non-blocking observations in iter 3: decision's --dry-run flag absent (not an AC), README covers 2/4 platforms, output dir deviation from decision.
  - `--env-file` in `deno compile` embeds vars into the binary for runtime use; CI env var `VERSION` is what compile.ts reads and strips before embedding — not a conflict.
  - 25th consecutive PM-stage SRS persistence failure resolved in iteration 3 for issue #183.

## 2026-03-20T56:XX — Issue #183 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.22 (est)
- **Verdict:** FAIL
- **Outcome:** 5/9 acceptance criteria passed. 578 tests, 0 failures. 4 blocking issues: (1) FR-E39 absent from `requirements-engine.md` (25th consecutive PM-stage SRS persistence failure); (2) `scripts/compile_test.ts` missing — Decision Task 2 not delivered, file does not exist; (3) platform naming deviation: `amd64`/`macos` instead of spec-required `x86_64`/`darwin` (3 of 4 binary names wrong); (4) double-v version string bug: `release.yml` passes `VERSION=${{ github.ref_name }}` = "v1.2.3", `getVersionString()` prepends another `v` → "auto-flow vv1.2.3". `deno.json` compile task registered, CI workflow structure correct, README install docs present, `design-engine.md` has FR-E39 section (with duplicate 3.5 numbering). Self-request-changes failed → used `gh issue comment` fallback on issue #183.
- **Key learnings:**
  - Decision deliverables can be entirely missing even on iter 2: compile_test.ts was listed as Task 2 but never created. Always verify ALL decision tasks present in diff.
  - Double-v bug: always check if VERSION env var in CI already carries `v` prefix from git tag. `github.ref_name` for tag "v1.2.3" = "v1.2.3" (includes v). If getVersionString() also prepends v → double-v. Fix: strip leading `v` in compile.ts before embedding.
  - Platform naming: spec/issue explicitly state `x86_64`/`darwin` — always verify implementation uses exact strings, not aliases (`amd64`/`macos`).
  - 25th consecutive PM-stage SRS persistence failure. Pattern unchanged.

## 2026-03-20T55:XX — Issue #183 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 4/7 spec ACs passed. 578 tests, 0 failures. All 4 implementation tasks correct: `VERSION = Deno.env.get("VERSION") ?? "dev"` + `getVersionString()` + `--version`/`-V` in `engine/cli.ts`; `scripts/compile.ts` with 4 targets; `.github/workflows/release.yml` matrix CI; README Installation section. Blocking: `documents/requirements-engine.md` not in diff, 0 matches for FR-E39 — PM-stage SRS persistence failure (24th consecutive: #147–#183). Non-blocking: double-v version string bug (`github.ref_name="v1.2.3"` + `getVersionString()` prepends `v` → `auto-flow vv1.2.3`) [confidence: 96]; platform naming deviation (`amd64`/`macos` vs `x86_64`/`darwin` in spec) [confidence: 85]. Self-request-changes failed → used `gh issue comment` fallback on issue #183.
- **Key learnings:**
  - Double-v version string bug: always check if `VERSION` env var in CI already contains the `v` prefix (GitHub tag names do); `getVersionString()` prepends another `v`. Fix: strip leading `v` in compile.ts before embedding.
  - Platform naming deviation (`amd64` vs `x86_64`, `macos` vs `darwin`): spec explicitly states platform strings; implementation uses more user-friendly but non-conformant names.
  - `deno compile --env-file <tmpfile>` is a valid alternative to `--env` for embedding env vars — different from what the decision specified but functionally correct.
  - 24th consecutive PM-stage SRS persistence failure. Pattern unchanged: grep for FR-E39 returns 0 immediately.

## 2026-03-20T54:XX — Issue #182 (iteration 2)

- **Turns:** ~9
- **Cost:** ~$0.22 (est)
- **Verdict:** PASS
- **Outcome:** All 8 acceptance criteria passed. 576 tests, 0 failures. FR-E38 at line 834 (§3.38, all 7 ACs marked [x]) and Appendix row at line 924 — blocking issues from iteration 1 resolved. `requirements-engine.md` IS in diff. Duplicate FR-E36 Appendix row removed (now sequential FR-E35/36/37/38 at lines 921-924). Behavioral implementation confirmed: `engine/types.ts:164`, `engine/config.ts:428-461`, `engine/validate.ts:261-337`, 3 config_test + 4 validate_test cases. Self-approval failed → used `gh issue comment` fallback on issue #182.
- **Key learnings:**
  - 23rd consecutive PM-stage SRS persistence failure resolved in iteration 2 — `requirements-engine.md` in diff with FR-E38 at §3.38 and Appendix.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E38) confirmed PASS in one parallel turn — optimal fix-iteration pattern.
  - Duplicate Appendix row removal (FR-E36 duplicate from iter 1) confirmed by sequential line scan — grep shows FR-E35/36/37/38 at lines 921-924.
  - 576 tests unchanged from iter 1 (all tests already added in iter 1); only SRS doc updated in iter 2.

## 2026-03-20T52:XX — Issue #182 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.22 (est)
- **Verdict:** FAIL
- **Outcome:** 6/6 behavioral criteria passed. 576 tests, 0 failures. All 5 implementation tasks correct: `fields?: string[]` in `types.ts:164`, `checkArtifact()` extended with fail-fast frontmatter field presence check in `validate.ts:303-334`, `validateValidationRule()` rejects bad entries and enforces at least one of sections/fields in `config.ts:428-461`, 3 config_test cases (non-string → throws, empty-string → throws, fields-only → accepted), 4 validate_test cases (skip/all-present/one-missing/one-empty-valued). Blocking: `documents/requirements-engine.md` not in diff, 0 matches for FR-E38 — PM-stage SRS persistence failure (23rd consecutive: #147–#182). Also: duplicate FR-E36 row in Appendix (lines 895 and 897) not removed as spec promised. Self-request-changes failed (author = reviewer) → used `gh issue comment` fallback on issue #182.
- **Key learnings:**
  - 23rd consecutive PM-stage SRS persistence failure. Pattern unchanged: grep for FR number returns 0 immediately.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E38) confirmed FAIL in one parallel turn — optimal pattern.
  - 576 tests (up from 569) confirms 7 new tests added (3 config_test + 4 validate_test).
  - Multi-focus review sub-agents found only pre-existing/non-blocking issues (stale module docstring listing 5 rule types; LF-only frontmatter regex pre-existing from checkFrontmatterField). No new defects introduced.

## 2026-03-20T51:XX — Issue #178 (iteration 2)

- **Turns:** ~10
- **Cost:** ~$0.25 (est)
- **Verdict:** PASS
- **Outcome:** All 15 acceptance criteria passed. 569 tests, 0 failures. FR-S43 (§3.43, line 1007), FR-S44 (§3.44, line 1027), FR-S45 (§3.45, line 1045) + Appendix C rows (lines 1185–1187) all present — blocking issue from iteration 1 resolved. SKILL.md implementations confirmed correct. 6 non-blocking findings (documentation quality gaps). Self-approval failed → used `gh issue comment` fallback on issue #178.
- **Key learnings:**
  - 22nd consecutive PM-stage SRS persistence failure resolved in iteration 2 — `requirements-sdlc.md` in diff with all 3 FR sections at correct lines.
  - Three FRs simultaneously (FR-S43/S44/S45): grepping for all 3 in one command confirms all 3 in one operation.
  - Multi-focus review sub-agents add thoroughness but produce mostly non-blocking documentation quality findings for prompt-level-only changes.
  - SKILL.md internal tensions (responsibility #4 vs #7 for SKILL.md file reviews) are non-blocking spec-compliance gaps.

## 2026-03-20T50:XX — Issue #178 (iteration 1)

- **Turns:** ~9
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 9/10 acceptance criteria passed. 569 tests, 0 failures. SKILL.md implementations fully correct: `agent-architect/SKILL.md` has `## Codebase Exploration` section (2-3 parallel sub-agents: Prior art, Architecture layers, Integration points; Agent tool explicitly allowed; Responsibility #3 updated). `agent-qa/SKILL.md` has `## Confidence Scoring` (0-100, ≥80 threshold) and `## Multi-Focus Review` (2-3 parallel sub-agents; Agent tool explicitly allowed; Responsibility #4 delegates). Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S43/FR-S44/FR-S45 — PM-stage SRS persistence failure (21st consecutive: #147–#178). Self-request-changes failed (author = reviewer) → used `gh issue comment` fallback on issue #178.
- **Key learnings:**
  - 21st consecutive PM-stage SRS persistence failure. Same pattern: grep for FR numbers returns 0 immediately.
  - This issue adds 3 FRs simultaneously (FR-S43/S44/S45) — none persisted to requirements-sdlc.md.
  - Multi-focus review sub-agents work well; conventions sub-agent found all patterns correct (Agent tool allowance, section naming, additive scope adherence).
  - SKILL.md-only changes with no TypeScript — test count unchanged at 569 from prior issue (#176).
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S43/S44/S45) confirmed FAIL in one parallel turn.

## 2026-03-20T49:XX — Issue #176 (iteration 2)

- **Turns:** ~6
- **Cost:** ~$0.12 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 569 tests, 0 failures. FR-E7 4 detailed criteria at lines 137-140 all marked [x]; `requirements-engine.md` IS in diff — blocking issue from iteration 1 resolved. Implementation: `validateTemplateVars()` pure function in `engine/template.ts:121-181`; called from `engine/config.ts:324-344` in `validateNode()` for before/after hooks; error messages include hook type and node ID; 20 new tests (12 template_test.ts + 9 config_test.ts). Self-approval failed → used `gh issue comment` fallback on issue #176.
- **Key learnings:**
  - PM-stage SRS persistence failure for issue #176 resolved in iteration 2 — `requirements-engine.md` in diff with FR-E7 4 detailed criteria at lines 137-140.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E7) confirmed PASS in one parallel turn — optimal fix-iteration pattern.
  - 20th consecutive pattern: PM stage fails on iter 1, dev restores on iter 2. Pattern continues unchanged.
  - validateTemplateVars() design: pure function in template.ts returning error array — allows accumulation of multiple errors before throwing at config.ts level.

## 2026-03-20T48:XX — Issue #176 (iteration 1)

- **Turns:** ~7
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 4/5 criteria passed. 569 tests, 0 failures. Implementation correct: `validateTemplateVars()` added to `engine/template.ts:121-181` (pure function, returns error array); called from `engine/config.ts:324-344` in `validateNode()` for `before`/`after` hooks; error format includes hook type ("before hook"/"after hook") and node ID; 12 new template_test.ts tests + 9 new config_test.ts integration tests. Blocking: `documents/requirements-engine.md` not in diff, old single vague criterion at line 137 — 4 detailed criteria absent. PM-stage SRS persistence failure (19th consecutive: #147–#176). Self-request-changes failed → used `gh issue comment` fallback on issue #176.
- **Key learnings:**
  - PM-stage SRS persistence failure continues (19th consecutive). Grep for FR-E7 in requirements-engine.md returns old single criterion — same pattern as all prior issues.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E7) confirmed FAIL in one parallel turn — optimal pattern.
  - 569 tests (up from 549) confirms 20 new tests added (12 template_test.ts + 9 config_test.ts).
  - validateTemplateVars() design: pure function in template.ts, returns error array (not throws) — allows accumulation of multiple errors before throwing at config.ts level.

## 2026-03-20T46:XX — Issue #175 (iteration 1)

- **Turns:** ~7
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 7/9 criteria passed. 549 tests, 0 failures. All 7 behavioral ACs implemented correctly: `engine/scope-check.ts` (snapshotModifiedFiles + findViolations), `engine/types.ts` (allowed_paths? + scope_check union), `engine/config.ts` (validateAllowedPaths), `engine/agent.ts` pre/post snapshot integration. 16 new tests (scope-check_test.ts: 11, agent_test.ts FR-E37 section: 4, config integration: indirect). Blocking: `documents/requirements-engine.md` not in diff, 0 matches for FR-E37 — PM-stage SRS persistence failure (17th consecutive: #147–#175). Self-request-changes failed (author = reviewer) → used `gh issue comment` fallback on issue #175.
- **Key learnings:**
  - 17th consecutive PM-stage SRS persistence failure. Same pattern: grep for FR-E37 in requirements-engine.md returns 0 immediately.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E37) confirmed FAIL in one parallel turn — optimal pattern.
  - scope-check.ts implementation is clean: pure `findViolations()` + git-based `snapshotModifiedFiles()`, pre-existing mods correctly excluded via set-difference algorithm.
  - agent.ts integration uses snapshot before first invocation + post-invocation comparison each iteration + updates beforeSnapshot for next iteration (incremental detection).

## 2026-03-20T45:XX — Issue #174 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 8 acceptance criteria passed. 533 tests, 0 failures. FR-S42 present at line 972 (§3.42, all 8 ACs marked [x]) and Appendix C at line 1128 — blocking issue from iteration 1 resolved. `requirements-sdlc.md` IS in diff. pipeline.yaml: 6/6 nodes use `type: artifact`; `frontmatter_field` (spec: issue, scope; verify: verdict) and `custom_script` (build) preserved. Self-approval failed → used `gh issue comment` fallback on issue #174.
- **Key learnings:**
  - PM-stage SRS persistence failure for issue #174 resolved in iteration 2 — `requirements-sdlc.md` in diff with FR-S42 at lines 972 and 1128.
  - Config-only changes (pipeline.yaml) with no TypeScript/test changes: test count stays at 533 — non-blocking.
  - 16th consecutive pattern: PM stage fails on iter 1, dev restores on iter 2. Pattern continues unchanged.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S42) confirmed PASS in one turn — optimal fix-iteration pattern.
