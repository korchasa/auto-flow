---
name: agent-developer
description: Reflection memory for developer agent — anti-patterns, strategies, environment quirks
type: feedback
---

# Reflection Memory — agent-developer

## Anti-patterns

- Writing complete files (Write) for simple section inserts when Edit would work
- Not checking deno fmt compliance before writing — blank lines between headings and list items required
- Splitting import updates and test additions into separate Edit calls (one Write/Edit per file rule)
- NOT committing immediately after deno task check passes — background self_runner resets to main
- Writing indentation incorrectly in multi-line function call args (matching the wrong reference level)
- Pre-counting indentation levels before writing nested calls (2-space per level in deno fmt)
- Placing import statements at the bottom of a file (TS requires all imports at top)
- Leaving extra trailing blank line at end of file — deno fmt expects exactly one trailing newline

## Effective Strategies

- ONE Edit for single-location changes; ONE Write for multi-location changes (whole file rewrite)
- All parallel Reads + git log in first turn = minimal turns
- Pre-flight git log check prevents wasted work on pre-committed tasks
- COMMIT IMMEDIATELY after writing code — then run deno task check; self_runner can reset during check
- When a pre-existing fmt failure blocks check (out-of-scope file): `git stash push -- <file>`, run check,
  `git stash pop`. Confirms own code is correct without losing another agent's uncommitted work.
- For nested multi-arg calls, count indentation level carefully: `write(` at N → `encode(` at N+2 → arg at N+4 → close at N+2
- When writing processStreamEvent-style extracted helpers: always export them for testability
- For extraction refactors (no behavioral change): existing tests are the acceptance gate — no new tests needed
- When removing imports: trace each symbol to confirm it is truly unused after extraction before deleting

## Environment Quirks

- `deno fmt` checks ALL `.md` files in the repo, not just TypeScript
- Memory files require blank lines between `##` headings and first list item (deno fmt rule)
- deno task check output >50KB persisted to temp file — no `<error>` wrapper = PASS; check tail for "All checks passed!"
- **CRITICAL**: `scripts/self_runner.ts` runs as background process. When `.auto-flow/lock.json` is absent,
  self_runner starts a new pipeline run → calls `.auto-flow/scripts/reset-to-main.sh` →
  `git checkout -f main && git reset --hard origin/main && git clean -fd`. DESTROYS all uncommitted changes.
- TypeScript `.some((e) => ...)` callbacks need explicit `: string` type annotation to avoid TS7006
- "File has been modified since read" appears due to background resets — always re-read before writing
- AGENTS.md content may word-wrap agent names — normalize \n→space before substring search
- **Pre-existing dirty files from other agents can fail deno fmt check**: use `git stash push -- <file>`
  to temporarily clear them, verify own code passes, then `git stash pop` to restore

## Baseline Metrics

- Run 20260315T003418: ~14 turns, scope sdlc, issue #121 (FR-S29), 7 SKILL.md + 2 memory files — PASS
- Run 20260315T131001: ~38 turns, scope sdlc, issue #86 (FR-S29 impl), 3 files changed — PASS but env resets
- Run 20260315T161245: ~15 turns, scope engine, issue #91 (FR-E30), 2 files changed — PASS (stash workaround)
- Run 20260315T165136: ~12 turns, scope engine, issue #92 (FR-E30), 2 files changed — PASS (stash + trailing newline fix)
- Target: ≤35 turns. Key lesson: commit before deno task check; stash pattern for pre-existing fmt issues.
