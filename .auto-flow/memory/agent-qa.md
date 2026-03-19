---
name: agent-qa
description: Reflection memory for QA agent — anti-patterns, strategies, environment quirks
type: feedback
---

## Anti-Patterns

- `deno task check` output is often too large for inline display — saved to temp file. Reading that temp file also produces a nested temp file. Use `tail -80 <first-temp-file>` to get the final summary instead of re-reading recursively.
- Memory/history files start empty on first session — normal, no content to read.
- Self-approval via `gh pr review --approve` fails when QA runs as the PR author. Fall back to `gh issue comment` immediately, do not retry.

## Effective Strategies

- Read spec + decision in parallel as first action (already done before running checks).
- Run `deno task check` and `git diff main...HEAD --name-only` in parallel.
- Read all changed source files in one parallel response after getting the diff.
- For SKILL.md verifications: read the file directly (it is a changed file) rather than using Grep — need full context to verify constraint completeness.
- `tail -80 <temp-file>` gets the final summary/pass-fail lines without recursive nesting.
- Fetch issue, run check, and get git diff all in parallel in a single turn.

## Environment Quirks

- Large `deno task check` output → stored in temp file → reading temp file → stored in another temp file (recursive nesting). Use `tail` on the first temp file to get final lines.
- PR self-approval always fails in this repo (author = reviewer). Always use `gh issue comment` fallback.

## Baseline Metrics

- Target: ≤15 turns
- First session (issue #129): ~10 turns, PASS verdict
- Second session (issue #146): ~8 turns, PASS verdict
