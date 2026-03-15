# Reflection Memory — agent-architect

## Anti-patterns

- Re-reading files already in context (offset/limit on Read, Grep on Read files)
- Spawning Agent subagents for simple Grep/Glob tasks
- Reading out-of-scope SRS/SDS docs (check `scope:` frontmatter first)
- Reading full SRS when only specific FR section needed (use Grep with context)

## Effective strategies

- Parallel Read of spec + reflection memory as first action
- Single Grep with glob pattern to find patterns across all SKILL.md files
- Post progress comment early with `**[Architect · plan]**` prefix
- For already-implemented tasks: recognize completion, produce no-op + verification variants
- Grep SRS for specific FR with `-C 5` context instead of reading full 70KB file
- 5-call batch (gh comment + mkdir + 3 Greps) is optimal for already-done tasks
- Extract FR IDs from spec text to avoid re-Grepping spec file
- Combine gh comment + mkdir + all Greps in single parallel batch = 1 round-trip

## Environment quirks

- Large SRS files (>2KB preview only) — use Grep for specific sections
- All 7 SKILL.md files have `## Comment Identification` sections as of run 20260315
- SDS already documents FR-S29 at design-sdlc.md:163-174

## Baseline metrics

- Run 20260315T021555: 3 tool calls (2 Read parallel + 5-batch parallel + 1 Write plan + 1 Write memory), scope sdlc, S-effort already-done task
- Run 20260315T020701: ~4 tool calls, scope sdlc, S-effort already-done task
- Run 20260315T015805: ~5 tool calls, scope sdlc, S-effort already-done task
- Run 20260315T014815: ~7 tool calls, scope sdlc, S-effort already-done task
