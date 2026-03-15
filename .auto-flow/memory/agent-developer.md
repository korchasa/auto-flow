---
name: agent-developer
description: Reflection memory for developer agent — anti-patterns, strategies, environment quirks
type: feedback
---

# Reflection Memory — agent-developer

## Anti-patterns

- Writing complete files (Write) for simple section inserts when Edit would work
- Not checking deno fmt compliance for memory/*.md files — blank lines between headings and list items required
- Splitting import updates and test additions into separate Edit calls (one Write/Edit per file rule)
- NOT committing immediately after deno task check passes — background self_runner resets to main

## Effective Strategies

- ONE Edit for single-location changes; ONE Write for multi-location changes (whole file rewrite)
- All parallel Reads + git log in first turn = minimal turns
- Pre-flight git log check prevents wasted work on pre-committed tasks
- COMMIT IMMEDIATELY after writing code — do not run deno task check first; the check takes 60-90s and self_runner can reset during that time
- When self_runner has reset to main mid-session: `git checkout sdlc/issue-86`, rewrite, commit, push
- Normalize whitespace in regex matches for markdown content that may word-wrap across lines

## Environment Quirks

- `deno fmt` checks ALL `.md` files in the repo, not just TypeScript
- Memory files require blank lines between `##` headings and first list item (deno fmt rule)
- deno task check output >50KB persisted to temp file — no `<error>` wrapper = PASS
- **CRITICAL**: `scripts/self_runner.ts` runs as background process. When `.auto-flow/lock.json` is absent, self_runner starts a new pipeline run → calls `.auto-flow/scripts/reset-to-main.sh` → `git checkout -f main && git reset --hard origin/main && git clean -fd`. This DESTROYS all uncommitted changes and switches to main branch mid-session.
- TypeScript `.some((e) => ...)` callbacks need explicit `: string` type annotation to avoid TS7006 implicit `any` error
- "File has been modified since read" appears frequently due to background resets — always re-read before writing when this occurs
- AGENTS.md content may word-wrap agent names across lines (e.g., "Tech Lead\nReview") — normalize \n→space before substring search

## Baseline Metrics

- Run 20260315T003418: ~14 turns, scope sdlc, issue #121 (FR-S29), 7 SKILL.md + 2 memory files — PASS
- Run 20260315T131001: ~38 turns, scope sdlc, issue #86 (FR-S29 impl), 3 files changed — PASS but severely impacted by 3+ self_runner resets during session
- Target: ≤35 turns. Exceeded due to environment resets not code issues.
- Key lesson: commit BEFORE running deno task check, not after.
