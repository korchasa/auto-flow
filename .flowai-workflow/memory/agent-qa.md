---
name: agent-qa
description: Reflection memory for QA agent — anti-patterns, strategies, environment quirks
type: feedback
---

## Anti-Patterns

- `deno task check` output is often too large for inline display — saved to temp file. Use offset read near end to get final summary.
- Memory/history files start empty on first session — normal, no content to read.
- Self-approval via `gh pr review --approve` fails when QA runs as the PR author. Fall back to `gh issue comment` immediately, do not retry.
- When developer uses a Write (full rewrite) for a large SRS file, PM-stage additions can be silently dropped. Check for new sections promised in spec's "SRS Changes" section even if `deno task check` passes.
- When `requirements-engine.md` or `requirements-sdlc.md` is NOT in `git diff main...HEAD --name-only`, grep for FR number to confirm before writing verdict.
- Stale ACs in existing FRs can become contradictory after a new FR removes a feature. Check for contradictions in related FRs.
- PM-stage SRS persistence failure is a recurring pattern. Always check if SRS file is in diff immediately.
- Decision deliverables can be missing even when other tasks pass. Always verify ALL decision tasks are present in diff.
- Double-v version string bug: when CI passes `github.ref_name` (e.g., "v1.2.3") as VERSION env and `getVersionString()` prepends "v", the result is "flowai-workflow vv1.2.3".
- For documentation-only issues: the file being in diff does NOT guarantee FR-S<N> section was added. Always grep for FR number explicitly.
- Write tool requires reading a file before overwriting it, even in QA report path — always Read existing QA report before Write on iteration > 1.
- `01-spec.md` can be absent from the run directory even when `03-decision.md` exists — PM/Architect stage ran (stream.log present) but produced no artifact. Check specification directory at session start.
- **NEW**: `loop_test.ts` env forwarding tests are type-structure tests, NOT behavioral tests — they verify interface accepts `env` but do not assert env reaches the subprocess. Do not count as "behavioral coverage" for forwarding.

## Effective Strategies

- Read spec + decision in parallel as first action.
- Run `deno task check` and `git diff main...HEAD --name-only` and `gh issue view` all in one parallel turn; add `grep -n "FR-EXX\|FR-SXX" requirements-*.md` to the same turn.
- Read all key changed source files in one parallel response after getting the diff.
- Read check output at offset ~400 from temp file to get the final test count and "All checks passed!" line.
- Grep for old artifact names across agents/ and documents/ to verify rename sweep completeness.
- Cross-check spec's "SRS Changes" section against actual SRS content.
- When spec lists SRS changes, grep for the FR number in the SRS immediately after getting the diff.
- `workflow.yaml` modification is expected and necessary when engine enforcement would break it — do not treat as out-of-scope.
- Shell test files (`.sh`) are NOT part of Deno test suite — count stays the same.
- Check for existence of `01-spec.md` immediately after reading the spec path; if only `stream.log` present, record as blocking issue and proceed with verification against decision + issue DoD.

## Environment Quirks

- Large `deno task check` output → stored in temp file. Read at offset ~400 to reach the summary section.
- PR self-approval always fails in this repo (author = reviewer). Always use `gh issue comment` fallback.
- `documents/requirements-sdlc.md` and `documents/requirements-engine.md` are large — use targeted Grep instead of full Read.
- Write tool requires prior Read of the target file. On iteration > 1, always Read the existing QA report before overwriting it.

## Baseline Metrics

- Target: ≤15 turns
- Fortieth session (issue #196, iteration 2): ~7 turns, FAIL verdict (01-spec.md still missing; LoopRunOptions.env dead-field fixed + AgentRunOptions.env field added; all FR-E49 behavioral ACs correct; deno task check PASS 741 tests)
- Thirty-ninth session (issue #196, iteration 1): ~8 turns, FAIL verdict (01-spec.md missing; LoopRunOptions.env dead field non-blocking; all behavioral FR-E49 ACs correct; deno task check PASS)
- Thirty-eighth session (issue #183, iteration 3): ~10 turns, PASS verdict
- Thirty-seventh session (issue #182, iteration 2): ~9 turns, PASS verdict
- Thirty-sixth session (issue #182, iteration 1): ~8 turns, FAIL verdict
- Thirty-fifth session (issue #178, iteration 2): ~10 turns, PASS verdict
- Thirty-fourth session (issue #178, iteration 1): ~9 turns, FAIL verdict
