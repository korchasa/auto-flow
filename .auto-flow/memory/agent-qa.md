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
- PM-stage SRS persistence failure is a recurring pattern (issues #147–#157). Always check if SRS file is in diff immediately. This pattern extends to engine scope (requirements-engine.md) too. 12 consecutive failures; resolved in iter 2 for each issue.
- Issue #155 (engine+sdlc scope): both requirements-engine.md AND requirements-sdlc.md can be absent from diff simultaneously when two new FRs span both scopes in same issue.
- Write tool requires reading a file before overwriting it, even in QA report path — always Read existing QA report before Write on iteration > 1.

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
- For SKILL.md-only changes: verify each file individually by reading in parallel; the entire implementation IS the SKILL.md content changes.

## Environment Quirks

- Large `deno task check` output → stored in temp file → reading temp file → stored in another temp file (recursive nesting). Use `tail` on the first temp file to get final lines.
- PR self-approval always fails in this repo (author = reviewer). Always use `gh issue comment` fallback.
- `documents/requirements-sdlc.md` and `documents/requirements-engine.md` are large — use targeted Grep instead of full Read.
- Write tool requires prior Read of the target file. On iteration > 1, always Read the existing QA report before overwriting it.

## Baseline Metrics

- Target: ≤15 turns
- First session (issue #129): ~10 turns, PASS verdict
- Second session (issue #146): ~8 turns, PASS verdict
- Third session (issue #147, iteration 1): ~11 turns, FAIL verdict (FR-S32 missing from SRS)
- Fourth session (issue #147, iteration 2): ~9 turns, PASS verdict (FR-S32 restored)
- Fifth session (issue #148, iteration 1): ~8 turns, FAIL verdict (FR-S33 missing from SRS)
- Sixth session (issue #148, iteration 2): ~7 turns, PASS verdict (FR-S33 restored + FR-S13 conflict resolved)
- Seventh session (issue #149, iteration 1): ~7 turns, FAIL verdict (FR-S34 missing from SRS)
- Eighth session (issue #149, iteration 2): ~6 turns, PASS verdict (FR-S34 restored; 509 tests, 28/28 ACs)
- Ninth session (issue #150, iteration 1): ~6 turns, FAIL verdict (FR-E33 missing from requirements-engine.md)
- Tenth session (issue #150, iteration 2): ~6 turns, PASS verdict (FR-E33 restored; 514 tests, 10/10 ACs)
- Eleventh session (issue #151, iteration 1): ~5 turns, FAIL verdict (FR-S35 missing from requirements-sdlc.md)
- Twelfth session (issue #151, iteration 2): ~6 turns, PASS verdict (FR-S35 at line 788; 519 tests, 9/9 ACs)
- Thirteenth session (issue #152, iteration 1): ~5 turns, PASS verdict (FR-E34 present; 524 tests, 5/5 ACs)
- Fourteenth session (issue #153, iteration 1): ~5 turns, FAIL verdict (FR-E35 absent from requirements-engine.md)
- Fifteenth session (issue #153, iteration 2): ~5 turns, PASS verdict (FR-E35 at line 727; 528 tests, 5/5 ACs)
- Sixteenth session (issue #154, iteration 1): ~5 turns, FAIL verdict (FR-S36 absent from requirements-sdlc.md)
- Seventeenth session (issue #154, iteration 2): ~5 turns, PASS verdict (FR-S36 at line 821; 528 tests)
- Eighteenth session (issue #155, iteration 1): ~5 turns, FAIL verdict (FR-E36 + FR-S37 both absent; both SRS files not in diff)
- Nineteenth session (issue #155, iteration 2): ~5 turns, PASS verdict (both FRs present; 533 tests, 10/10 ACs)
- Twentieth session (issue #156, iteration 1): ~5 turns, FAIL verdict (FR-S38 absent; 10th consecutive PM failure)
- Twenty-first session (issue #156, iteration 2): ~5 turns, PASS verdict (FR-S38 at line 864; 533 tests, 4/4 ACs)
- Twenty-second session (issue #157, iteration 1): ~5 turns, FAIL verdict (FR-S39 absent; 12th consecutive PM failure; SKILL.md changes correct)
- Twenty-third session (issue #157, iteration 2): ~5 turns, PASS verdict (FR-S39 at line 881 §3.39 + Appendix C line 1028; requirements-sdlc.md in diff; all 6 SKILL.md files correct; 533 tests, 4/4 ACs)
