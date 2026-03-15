# Reflection Memory — agent-architect

## Anti-patterns

- Re-reading files already in context (offset/limit on Read, Grep on Read files)
- Spawning Agent subagents for simple Grep/Glob tasks
- Reading out-of-scope SRS/SDS docs (check `scope:` frontmatter first)
- Reading FR section with offset/limit after full SRS read — content already in context

## Effective strategies

- Parallel Read of spec + reflection memory as first action
- Single Grep with glob pattern for cross-file checks
- Extract FR IDs from requirements immediately after Read — no re-Grep
- Post progress comment early (with self-identification prefix)
- For engine+sdlc scope: read all 4 docs in parallel (2nd batch after spec)
- Use `output_mode: count` for quick tally of stale refs per file
- Use `output_mode: files_with_matches` first, then targeted content checks
- For cleanup tasks: inventory all occurrences before planning variants

## Environment quirks

- Large SRS/SDS files get persisted to disk (>2KB preview only) — content still in context
- FR-E30 ID is reused: JSDoc/why-comments task in SDS AND prepare_command in SRS
- `.claude/skills/agent-*` symlinks still exist (per FR-S26) — both old and new paths resolve
- `config_test.ts` does `Deno.readTextFileSync` on prompt paths — replacement must use valid path

## Baseline metrics

- Run 20260315T193605: 10 tool calls, engine+sdlc scope, path cleanup task, 3 variants
- Run 20260315T183811: 9 tool calls, engine scope, new hook feature, 3 variants
- Run 20260315T153825: 8 tool calls, engine scope, DRY extraction task, 3 variants
- Run 20260315T152252: 7 tool calls, engine scope, test-fix task, 3 variants
- Run 20260315T144221: ~8 tool calls, sdlc scope, evidence-only task
