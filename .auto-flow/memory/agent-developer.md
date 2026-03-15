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
- For evidence-only tasks: Grep SKILL.md files for section headers + template lines → single Edit with all evidence inline
- Check `git diff <file>` when git status shows M (modified) — prior agent may have already made partial changes
- No-op tasks: run check, fix any pre-existing fmt issues, write summary, commit run artifact only
- No-op detection: read decision + git log in parallel on first turn; if tasks=[] and sdlc(impl) commit exists, skip all source reads
- When deno task check shows formatting issue in an out-of-scope memory file: fix it (single Write), stage it alongside memory file
- When multiple headings in a memory file lack blank lines: rewrite whole file once (single Write call)

## Environment Quirks

- `deno fmt` checks ALL `.md` files in the repo, not just TypeScript
- Memory files require blank lines between `##` headings and first list item (deno fmt rule)
- SKILL.md-only tasks: no tests to write, deno task check passes if formatting is clean
- `.auto-flow/memory/*.md` files can accumulate missing blank lines from prior agent writes
- deno task check output >50KB gets persisted to temp file — check `<error>` wrapper vs `<persisted-output>` to determine pass/fail (no error tag = PASS)
- `git diff HEAD` shows both staged and unstaged changes vs HEAD; `git diff --cached` shows only staged
- PM agent may add FR sections with unchecked ACs — developer's job is to mark them with evidence
- No-op tasks (tasks[].files empty): still need to fix pre-existing fmt issues before check passes
- Trailing space AND missing blank lines in memory/*.md are recurring patterns — check git status M files before running check

## Baseline Metrics

- Run 20260315T003418: ~14 turns, scope sdlc, issue #121 (FR-S29), 7 SKILL.md + 2 memory files
- Run 20260315T005937: ~8 turns, scope sdlc, issue #121 (FR-S29), 1 SKILL.md (incremental), pre-committed impl found
- Run 20260315T011256: ~7 turns, scope sdlc, issue #121 (FR-S29), evidence-only AC marking in requirements-sdlc.md
- Run 20260315T012827: ~6 turns, scope sdlc, issue #121 (FR-S29), no-op pass-through + fmt fix
- Run 20260315T013850: ~4 turns, scope sdlc, issue #121 (FR-S29), no-op pass-through (tasks=[])
- Run 20260315T014815: ~4 turns, scope sdlc, issue #121 (FR-S29), no-op pass-through (tasks=[])
- Run 20260315T020701: ~4 turns, scope sdlc, issue #121 (FR-S29), no-op pass-through (tasks=[])
- Run 20260315T021555: ~6 turns, scope sdlc, issue #121 (FR-S29), no-op + fmt fix in agent-architect.md
- Run 20260315T025139: ~4 turns, scope sdlc, issue #121 (FR-S29), no-op pass-through (tasks=[])
- Run 20260315T030805: ~6 turns, scope sdlc, issue #121 (FR-S29), no-op + fmt fix in agent-meta-agent.md
- Target: ≤35 turns. All runs achieved well under target.
