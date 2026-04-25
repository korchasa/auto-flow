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
- **Outcome:** All 7 acceptance criteria passed. 528 tests, 0 failures. FR-S36 present at line 821 (section 3.36) and Appendix C at line 968 — blocking issue from iteration 1 resolved. Implementation: `run-dashboard.sh` wrapper (warns on failure, exits 0), `workflow.yaml` `after:` updated to `.flowai-workflow/scripts/run-dashboard.sh {{run_dir}}` (line 180), `on_error: continue` and `run_on: always` retained. Self-approval failed → used `gh issue comment` fallback on issue #154.
- **Key learnings:**
  - PM-stage SRS persistence failure for issue #154 was fixed in iteration 2 — `requirements-sdlc.md` IS in diff and FR-S36 found at lines 821 and 968.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S36) confirmed PASS in one parallel turn — optimal pattern for fix iterations.
  - 528 tests unchanged from iteration 1 — no new tests needed for this sdlc-only change.
  - SDLC workflow pattern (wrapper script replacing `|| true`) is correct approach for observable non-blocking after-script failures.

## 2026-03-20T42:XX — Issue #159 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** FAIL
- **Outcome:** 4/5 implementation criteria passed (all behavioral ACs met). 533 tests, 0 failures. Implementation correct: `reset-to-main.sh:10-20` adds dirty-check guard, branch display, `git diff --stat HEAD` + cached + untracked, `git stash push --include-untracked -m "flowai-workflow pre_run: <timestamp>"`, stash ref + restore cmd. `reset-to-main_test.sh` covers all 3 test scenarios (clean-tree, dirty-tree, post-reset). Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S41 — PM-stage SRS persistence failure (14th consecutive: #147–#159). Self-request-changes failed (author = reviewer) → used `gh issue comment` fallback on issue #159.
- **Key learnings:**
  - Shell test file (`reset-to-main_test.sh`) is NOT part of Deno test suite — `deno task check` count stays at 533 (same as #158). Behavioral ACs still verified by reading the script directly.
  - PM-stage SRS persistence failure continues (14th consecutive). Grep for FR-S41 in requirements-sdlc.md returns 0 matches — same pattern as all prior issues.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S41) confirmed FAIL in one parallel turn — optimal pattern.

## 2026-03-20T44:XX — Issue #174 (iteration 1)

- **Turns:** ~5
- **Cost:** ~$0.12 (est)
- **Verdict:** FAIL
- **Outcome:** 8/9 criteria passed. 533 tests, 0 failures. Workflow.yaml implementation fully correct: all 6 nodes use `type: artifact` with correct sections; `frontmatter_field` rules for specification (issue, scope) and verify (verdict) preserved; `custom_script` in build preserved; deno task check passes. Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S42 — PM-stage SRS persistence failure (16th consecutive: #147–#174). Self-request-changes failed (author = reviewer) → used `gh issue comment` fallback on issue #174.
- **Key learnings:**
  - PM-stage SRS persistence failure continues (16th consecutive). Workflow config-only changes are no exception to the SRS verification step.
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
  - Continuation loop condition `while (validationRules.length > 0 || node.allowed_paths !== undefined)` ensures scope-check nodes enter loop even without artifact rules.
  - 18th consecutive pattern: PM stage fails on iter 1, dev restores on iter 2. Pattern continues.

## 2026-03-20T57:XX — Issue #183 (iteration 3)

- **Turns:** ~10
- **Cost:** ~$0.22 (est)
- **Verdict:** PASS
- **Outcome:** All 7 FR-E39 acceptance criteria passed. 587 tests, 0 failures. All 4 blocking issues from iteration 2 resolved: (1) FR-E39 at line 861 §3.39 + Appendix row at line 954 — requirements-engine.md in diff; (2) `scripts/compile_test.ts` exists with 9 tests (4 target mappings, 1 naming convention, 3 stripVersionPrefix); (3) platform names correct (x86_64/darwin, not amd64/macos); (4) double-v bug fixed via `stripVersionPrefix()` in `compile.ts:33–35`. Self-approval failed → used `gh issue comment` fallback on issue #183.
- **Key learnings:**
  - Issue #183 required 3 iterations — only issue in history to need iter 3 (iter 2 had 4 blocking issues: SRS + 3 implementation bugs).
  - Multi-focus review sub-agents found only non-blocking observations in iter 3.
  - `--env-file` in `deno compile` embeds vars into the binary for runtime use; CI env var `VERSION` is what compile.ts reads and strips before embedding.
  - 25th consecutive PM-stage SRS persistence failure resolved in iteration 3 for issue #183.

## 2026-03-20T56:XX — Issue #183 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.22 (est)
- **Verdict:** FAIL
- **Outcome:** 5/9 acceptance criteria passed. 578 tests, 0 failures. 4 blocking issues: (1) FR-E39 absent from `requirements-engine.md` (25th consecutive PM-stage SRS persistence failure); (2) `scripts/compile_test.ts` missing — Decision Task 2 not delivered; (3) platform naming deviation: `amd64`/`macos` instead of spec-required `x86_64`/`darwin`; (4) double-v version string bug: `release.yml` passes `VERSION=${{ github.ref_name }}` = "v1.2.3", `getVersionString()` prepends another `v` → "flowai-workflow vv1.2.3". Self-request-changes failed → used `gh issue comment` fallback on issue #183.
- **Key learnings:**
  - Decision deliverables can be entirely missing even on iter 2: compile_test.ts was listed as Task 2 but never created. Always verify ALL decision tasks present in diff.
  - Double-v bug: always check if VERSION env var in CI already carries `v` prefix from git tag.
  - Platform naming: spec/issue explicitly state `x86_64`/`darwin` — always verify implementation uses exact strings.
  - 25th consecutive PM-stage SRS persistence failure. Pattern unchanged.

## 2026-03-20T55:XX — Issue #183 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 4/7 spec ACs passed. 578 tests, 0 failures. All 4 implementation tasks correct. Blocking: `documents/requirements-engine.md` not in diff, 0 matches for FR-E39 — PM-stage SRS persistence failure (24th consecutive: #147–#183). Non-blocking: double-v version string bug [confidence: 96]; platform naming deviation (`amd64`/`macos` vs `x86_64`/`darwin` in spec) [confidence: 85]. Self-request-changes failed → used `gh issue comment` fallback on issue #183.
- **Key learnings:**
  - Double-v version string bug: always check if `VERSION` env var in CI already contains the `v` prefix.
  - Platform naming deviation: spec explicitly states platform strings; implementation uses aliases.
  - `deno compile --env-file <tmpfile>` is a valid alternative to `--env` for embedding env vars.
  - 24th consecutive PM-stage SRS persistence failure.

## 2026-03-20T54:XX — Issue #182 (iteration 2)

- **Turns:** ~9
- **Cost:** ~$0.22 (est)
- **Verdict:** PASS
- **Outcome:** All 8 acceptance criteria passed. 576 tests, 0 failures. FR-E38 at line 834 (§3.38, all 7 ACs marked [x]) and Appendix row at line 924 — blocking issues from iteration 1 resolved. `requirements-engine.md` IS in diff. Duplicate FR-E36 Appendix row removed (now sequential FR-E35/36/37/38 at lines 921-924). Self-approval failed → used `gh issue comment` fallback on issue #182.
- **Key learnings:**
  - 23rd consecutive PM-stage SRS persistence failure resolved in iteration 2 — `requirements-engine.md` in diff with FR-E38 at §3.38 and Appendix.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E38) confirmed PASS in one parallel turn.
  - Duplicate Appendix row removal confirmed by sequential line scan.
  - 576 tests unchanged from iter 1 (all tests already added in iter 1); only SRS doc updated in iter 2.

## 2026-03-20T52:XX — Issue #182 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.22 (est)
- **Verdict:** FAIL
- **Outcome:** 6/6 behavioral criteria passed. 576 tests, 0 failures. All 5 implementation tasks correct. Blocking: `documents/requirements-engine.md` not in diff, 0 matches for FR-E38 — PM-stage SRS persistence failure (23rd consecutive: #147–#182). Also: duplicate FR-E36 row in Appendix (lines 895 and 897) not removed as spec promised. Self-request-changes failed → used `gh issue comment` fallback on issue #182.
- **Key learnings:**
  - 23rd consecutive PM-stage SRS persistence failure.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E38) confirmed FAIL in one parallel turn.
  - 576 tests (up from 569) confirms 7 new tests added (3 config_test + 4 validate_test).
  - Multi-focus review sub-agents found only pre-existing/non-blocking issues.

## 2026-03-20T51:XX — Issue #178 (iteration 2)

- **Turns:** ~10
- **Cost:** ~$0.25 (est)
- **Verdict:** PASS
- **Outcome:** All 15 acceptance criteria passed. 569 tests, 0 failures. FR-S43 (§3.43, line 1007), FR-S44 (§3.44, line 1027), FR-S45 (§3.45, line 1045) + Appendix C rows (lines 1185–1187) all present — blocking issue from iteration 1 resolved. SKILL.md implementations confirmed correct. Self-approval failed → used `gh issue comment` fallback on issue #178.
- **Key learnings:**
  - 22nd consecutive PM-stage SRS persistence failure resolved in iteration 2.
  - Three FRs simultaneously (FR-S43/S44/S45): grepping for all 3 in one command confirms all 3 in one operation.
  - Multi-focus review sub-agents add thoroughness but produce mostly non-blocking documentation quality findings for prompt-level-only changes.

## 2026-03-20T50:XX — Issue #178 (iteration 1)

- **Turns:** ~9
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 9/10 acceptance criteria passed. 569 tests, 0 failures. SKILL.md implementations fully correct. Blocking: `documents/requirements-sdlc.md` not in diff, 0 matches for FR-S43/FR-S44/FR-S45 — PM-stage SRS persistence failure (21st consecutive: #147–#178). Self-request-changes failed → used `gh issue comment` fallback on issue #178.
- **Key learnings:**
  - 21st consecutive PM-stage SRS persistence failure. Same pattern: grep for FR numbers returns 0 immediately.
  - This issue adds 3 FRs simultaneously (FR-S43/S44/S45) — none persisted to requirements-sdlc.md.
  - Multi-focus review sub-agents work well; conventions sub-agent found all patterns correct.

## 2026-03-20T49:XX — Issue #176 (iteration 2)

- **Turns:** ~6
- **Cost:** ~$0.12 (est)
- **Verdict:** PASS
- **Outcome:** All 5 acceptance criteria passed. 569 tests, 0 failures. FR-E7 4 detailed criteria at lines 137-140 all marked [x]; `requirements-engine.md` IS in diff — blocking issue from iteration 1 resolved. Implementation: `validateTemplateVars()` pure function in `engine/template.ts:121-181`; called from `engine/config.ts:324-344` in `validateNode()` for before/after hooks; error messages include hook type and node ID; 20 new tests (12 template_test.ts + 9 config_test.ts). Self-approval failed → used `gh issue comment` fallback on issue #176.
- **Key learnings:**
  - PM-stage SRS persistence failure for issue #176 resolved in iteration 2.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E7) confirmed PASS in one parallel turn.
  - 20th consecutive pattern: PM stage fails on iter 1, dev restores on iter 2.
  - validateTemplateVars() design: pure function in template.ts returning error array.

## 2026-03-20T48:XX — Issue #176 (iteration 1)

- **Turns:** ~7
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 4/5 criteria passed. 569 tests, 0 failures. Implementation correct. Blocking: `documents/requirements-engine.md` not in diff, old single vague criterion at line 137 — 4 detailed criteria absent. PM-stage SRS persistence failure (19th consecutive: #147–#176). Self-request-changes failed → used `gh issue comment` fallback on issue #176.
- **Key learnings:**
  - PM-stage SRS persistence failure continues (19th consecutive).
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E7) confirmed FAIL in one parallel turn.
  - 569 tests (up from 549) confirms 20 new tests added.
  - validateTemplateVars() design: pure function in template.ts, returns error array (not throws).

## 2026-03-20T46:XX — Issue #175 (iteration 1)

- **Turns:** ~7
- **Cost:** ~$0.14 (est)
- **Verdict:** FAIL
- **Outcome:** 7/9 criteria passed. 549 tests, 0 failures. All 7 behavioral ACs implemented correctly. Blocking: `documents/requirements-engine.md` not in diff, 0 matches for FR-E37 — PM-stage SRS persistence failure (17th consecutive: #147–#175). Self-request-changes failed → used `gh issue comment` fallback on issue #175.
- **Key learnings:**
  - 17th consecutive PM-stage SRS persistence failure. Same pattern.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-E37) confirmed FAIL in one parallel turn.
  - scope-check.ts implementation is clean: pure `findViolations()` + git-based `snapshotModifiedFiles()`.

## 2026-03-20T45:XX — Issue #174 (iteration 2)

- **Turns:** ~8
- **Cost:** ~$0.14 (est)
- **Verdict:** PASS
- **Outcome:** All 8 acceptance criteria passed. 533 tests, 0 failures. FR-S42 present at line 972 (§3.42, all 8 ACs marked [x]) and Appendix C at line 1128 — blocking issue from iteration 1 resolved. `requirements-sdlc.md` IS in diff. workflow.yaml: 6/6 nodes use `type: artifact`; `frontmatter_field` and `custom_script` preserved. Self-approval failed → used `gh issue comment` fallback on issue #174.
- **Key learnings:**
  - PM-stage SRS persistence failure for issue #174 resolved in iteration 2.
  - Config-only changes (workflow.yaml) with no TypeScript/test changes: test count stays at 533.
  - 16th consecutive pattern: PM stage fails on iter 1, dev restores on iter 2. Pattern continues unchanged.
  - Parallel strategy (deno task check + git diff + gh issue view + grep FR-S42) confirmed PASS in one turn.

## 2026-04-25T22:XX — Issue #196 (iteration 1)

- **Turns:** ~8
- **Cost:** ~$0.20 (est)
- **Verdict:** FAIL
- **Outcome:** 0 spec ACs verifiable (spec missing); all behavioral FR-E49 criteria met per decision + issue DoD. `deno task check` PASS. Implementation correct: `buildSpawnEnv()` exported from `agent.ts` with engine-wins merge; wired at initial + continuation invoke + HITL resume (hitl.ts:267); `captureClaudeVersion()` in engine.ts captures version at run start with graceful failure; 5 unit tests for buildSpawnEnv + 3 tests for RunState.claude_cli_version; design docs updated. Blocking: `01-spec.md` absent — specification directory contains only `stream.log` (PM/Architect stage ran but produced no artifact). Non-blocking: `LoopRunOptions.env` declared with JSDoc "forwarded to inner runAgent()" but not wired in runLoop() body [confidence: 90]. Self-request-changes failed → used `gh issue comment` fallback on issue #196.
- **Key learnings:**
  - `01-spec.md` can be absent even when `03-decision.md` exists: PM/Architect stage produced stream.log but no output artifact. Check specification directory at session start.
  - `LoopRunOptions.env` dead-field pattern: field declared with FR reference in JSDoc but not forwarded in the actual function body — DISABLE_AUTOUPDATER=1 still works via buildSpawnEnv inside runAgent, so FR goal is met.
  - Multi-focus review sub-agents identified the dead-field issue in loop.ts independently from two angles (correctness + conventions) — strong corroboration for non-blocking finding.
