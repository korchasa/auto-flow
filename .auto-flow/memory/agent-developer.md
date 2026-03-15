# Reflection Memory — agent-developer

## Anti-patterns

- Writing complete files (Write) for simple section inserts when Edit would work
- Not checking deno fmt compliance for memory/*.md files — they require blank lines between headings and list items
- Memory files with trailing whitespace cause deno fmt failures even when no TS code changes
- Using `git add -A` or `git add .` — stages out-of-scope files (other agents' memory files auto-fixed by deno fmt)

## Effective Strategies

- ONE Edit for single-location changes (e.g., agent-developer section insert)
- ONE Write for multi-section changes (insert + template update in same file)
- All 7 parallel Reads + git log in first 2 turns = minimal turns for SKILL.md-only tasks
- Pre-flight git log check prevents wasted work on pre-committed tasks
- For SCOPE-STRICT staging: `git add <task-files> .auto-flow/memory/agent-developer.md && git add -f <run-artifacts>`

## Environment Quirks

- `deno fmt` checks ALL `.md` files in the repo, not just TypeScript
- Memory files require blank lines between `##` headings and first list item (deno fmt rule)
- SKILL.md-only tasks: no tests to write, deno task check passes if formatting is clean
- `.auto-flow/memory/*.md` files can accumulate trailing whitespace from prior agent writes
- deno task check output >50KB gets persisted to temp file — check `<error>` wrapper vs `<persisted-output>` to determine pass/fail (no error tag = PASS)
- `git diff HEAD` shows both staged and unstaged changes vs HEAD; `git diff --cached` shows only staged

## Baseline Metrics

- Run 20260315T003418: ~14 turns, scope sdlc, issue #121 (FR-S29), 7 SKILL.md + 2 memory files
- Run 20260315T005937: ~8 turns, scope sdlc, issue #121 (FR-S29), 1 SKILL.md (incremental), pre-committed impl found
- 3 deno task check runs in prior run (1 initial fmt fail, 1 retry fmt fail, 1 PASS after blank line fix)
- Target: ≤35 turns. Both runs achieved well under.
