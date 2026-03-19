---
name: agent-qa
description: Reflection memory for QA agent — anti-patterns, strategies, environment quirks
type: feedback
---

## Anti-Patterns

- `deno task check` output is often too large for inline display — saved to temp file. Reading that temp file also produces a nested temp file. Use `tail -40 <first-temp-file>` to get the final summary instead of re-reading recursively.
- Memory/history files start empty on first session — normal, no content to read.
- Self-approval via `gh pr review --approve` fails when QA runs as the PR author. Fall back to `gh issue comment` immediately, do not retry.
- When developer uses a Write (full rewrite) for a large SRS file, PM-stage additions (like FR-S32, FR-S33) can be silently dropped. Check for new sections promised in spec's "SRS Changes" section even if `deno task check` passes.
- When `requirements-engine.md` or `requirements-sdlc.md` is NOT in `git diff main...HEAD --name-only`, it means the PM agent never added the promised FR section. Grep for the FR number to confirm before writing verdict.
- Stale ACs in existing FRs can become contradictory after a new FR removes a feature (e.g., FR-S13 AC claiming standalone invocability after FR-S33 removes interactive skill discovery). Check for contradictions in related FRs.
- PM-stage SRS persistence failure is a recurring pattern (issues #147, #148, #149, #150, #151). Always check if SRS file is in diff immediately. This pattern now extends to engine scope (requirements-engine.md), not just sdlc scope.

## Effective Strategies

- Read spec + decision in parallel as first action (already done before running checks).
- Run `deno task check` and `git diff main...HEAD --name-only` and `gh issue view` all in one parallel turn; add `grep -n "FR-EXX\|FR-SXX" requirements-*.md` to the same turn.
- Read all key changed source files in one parallel response after getting the diff.
- `tail -40 <temp-file>` gets the final summary/pass-fail lines without recursive nesting.
- Grep for old artifact names across agents/ and documents/ to verify rename sweep completeness.
- Cross-check spec's "SRS Changes" section against actual SRS content — new FR sections can be lost if PM agent failed to persist changes.
- For fix iterations (iteration > 1): grep for specific content (e.g., `grep -n "FR-E33" file`) to confirm presence before reading the whole file — saves a turn.
- When spec lists SRS changes, grep for the FR number in the SRS immediately after getting the diff. If not in diff AND not in file → blocking.
- On fix iteration, once FR is confirmed present in grep, check all spec-promised SRS sub-sections in the same grep output.
- `pipeline.yaml` modification is expected and necessary when engine enforcement would break it — do not treat as out-of-scope.

## Environment Quirks

- Large `deno task check` output → stored in temp file → reading temp file → stored in another temp file (recursive nesting). Use `tail` on the first temp file to get final lines.
- PR self-approval always fails in this repo (author = reviewer). Always use `gh issue comment` fallback.
- `documents/requirements-sdlc.md` and `documents/requirements-engine.md` are large — use targeted Grep instead of full Read.

## Baseline Metrics

- Target: ≤15 turns
- First session (issue #129): ~10 turns, PASS verdict
- Second session (issue #146): ~8 turns, PASS verdict
- Third session (issue #147, iteration 1): ~11 turns, FAIL verdict (FR-S32 missing from SRS)
- Fourth session (issue #147, iteration 2): ~9 turns, PASS verdict (FR-S32 restored)
- Fifth session (issue #148, iteration 1): ~8 turns, FAIL verdict (FR-S33 missing from SRS; PM agent never added it)
- Sixth session (issue #148, iteration 2): ~7 turns, PASS verdict (FR-S33 restored + all SRS sub-sections + FR-S13 conflict resolved)
- Seventh session (issue #149, iteration 1): ~7 turns, FAIL verdict (FR-S34 missing from SRS; PM agent never added it)
- Eighth session (issue #149, iteration 2): ~6 turns, PASS verdict (FR-S34 restored at line 737; Appendix C at line 904; 509 tests, 28/28 ACs)
- Ninth session (issue #150, iteration 1): ~6 turns, FAIL verdict (FR-E33 missing from requirements-engine.md; PM agent never added it)
- Tenth session (issue #150, iteration 2): ~6 turns, PASS verdict (FR-E33 restored at line 665; FR-E9 updated at line 180; Appendix at line 751; 514 tests, 10/10 ACs)
- Eleventh session (issue #151, iteration 1): ~5 turns, FAIL verdict (FR-S35 missing from requirements-sdlc.md; PM agent never persisted it)
- Twelfth session (issue #151, iteration 2): ~6 turns, PASS verdict (FR-S35 at line 788; Appendix C at line 938; 519 tests, 9/9 ACs)
