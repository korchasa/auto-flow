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
- PM-stage SRS persistence failure is a recurring pattern (issues #147–#196). Always check if SRS file is in diff immediately. This pattern extends to engine scope (requirements-engine.md) too. 26 consecutive failures; resolved in iter 2 for most issues.
- Decision deliverables (e.g., compile_test.ts from Task 2) can be missing even when other tasks pass. Always verify ALL decision tasks are present in diff, not just implementation files.
- Double-v version string bug pattern: when CI passes `github.ref_name` (e.g., "v1.2.3") as VERSION env and getVersionString() prepends "v", the result is "flowai-workflow vv1.2.3". Check for leading-v stripping in compile scripts.
- For documentation-only issues: even when SRS file IS in the diff (developer made doc fixes), the PM-stage FR section may still be missing. The file being in diff does NOT guarantee FR-S<N> section was added. Always grep for FR number explicitly.
- Issue #155 (engine+sdlc scope): both requirements-engine.md AND requirements-sdlc.md can be absent from diff simultaneously when two new FRs span both scopes in same issue.
- Write tool requires reading a file before overwriting it, even in QA report path — always Read existing QA report before Write on iteration > 1.
- Issue #196 iter 3 pattern: spec restored (iter 2 blocking was missing 01-spec.md), but SRS still missing FR-E49. A restored spec doesn't mean SRS was also fixed — verify both independently.

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
- `workflow.yaml` modification is expected and necessary when engine enforcement would break it — do not treat as out-of-scope.
- For SKILL.md-only changes: verify each file individually by reading in parallel; the entire implementation IS the SKILL.md content changes.
- Shell test files (`.sh`) are NOT part of Deno test suite — count stays the same. Behavioral ACs still verified by reading the script directly.
- When previous iteration verified behavioral ACs and implementation is unchanged, reference prior verification with confidence rather than re-reading all files — saves turns.

## Environment Quirks

- Large `deno task check` output → stored in temp file → reading temp file → stored in another temp file (recursive nesting). Use `tail` on the first temp file to get final lines.
- PR self-approval always fails in this repo (author = reviewer). Always use `gh issue comment` fallback.
- `documents/requirements-sdlc.md` and `documents/requirements-engine.md` are large — use targeted Grep instead of full Read.
- Write tool requires prior Read of the target file. On iteration > 1, always Read the existing QA report before overwriting it.

## Baseline Metrics

- Target: ≤15 turns
- Current session (issue #196, iteration 3): ~8 turns, FAIL verdict (FR-E49 absent from SRS; spec now present; all 741 tests pass; behavioral ACs correct per iter2)
- Previous session (issue #196, iteration 2): FAIL (01-spec.md missing)
- Previous session (issue #196, iteration 1): FAIL (FR-E49 absent from SRS + 01-spec.md missing)
- Thirty-eighth session (issue #183, iteration 3): ~10 turns, PASS verdict
- Thirty-seventh session (issue #182, iteration 2): ~9 turns, PASS verdict
