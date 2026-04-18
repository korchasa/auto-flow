# Reflection Memory — agent-architect

## Anti-patterns

- Re-reading files already in context (offset/limit on Read, Grep on Read files)
- Spawning Agent subagents for simple Grep/Glob tasks
- Reading out-of-scope SRS/SDS docs (check `scope:` frontmatter first)
- Reading FR section with offset/limit after full SRS read — content already in context

## Effective strategies

- Parallel Read of spec + reflection memory as first action
- 3 parallel Explore sub-agents for prior-art / architecture / integration — good coverage with concrete file:line refs
- Extract FR IDs from requirements immediately after Read — no re-Grep
- Post progress comment early (with self-identification prefix)
- For engine+sdlc scope: read all 4 docs in parallel (2nd batch after spec)
- For budget/enforcement features: trace cost flow end-to-end (types → state → engine → loop → agent) before planning
- Read SDS data-and-logic section (04) alongside module sections — contains cascade/algorithm specs needed for enforcement variants

## Environment quirks

- Large SRS/SDS files get persisted to disk (>2KB preview only) — content still in context
- FR-E30 ID is reused: JSDoc/why-comments task in SDS AND prepare_command in SRS
- `config_test.ts` does `Deno.readTextFileSync` on prompt paths — replacement must use valid path
- Engine test files reference `01-spec.md` in fixtures — touching those = cross-scope contamination
- `--max-turns` is Claude CLI-only flag — other runtimes silently ignore (document in risks)
- `extraArgs` in agent.ts is the injection point for runtime CLI flags (line 180 initial, 290 resume)
- `mergeDefaults()` handles loop body node recursion at config.ts:631-643 — budget cascade must follow same pattern

## Baseline metrics

- Run 20260418T184929: ~8 tool calls, engine scope, budget enforcement FR-E47, 3 variants
- Run 20260320T223114: ~8 tool calls, engine scope, binary distribution FR-E39, 3 variants
- Run 20260319T182156: ~8 tool calls, sdlc scope, artifact renumber task, 3 variants
- Run 20260315T215901: ~9 tool calls, sdlc scope, QA check suite extension, 3 variants
- Run 20260315T213641: 10 tool calls, engine scope, template file() function, 3 variants
- Run 20260315T193605: 10 tool calls, engine+sdlc scope, path cleanup task, 3 variants
- Run 20260315T183811: 9 tool calls, engine scope, new hook feature, 3 variants
- Run 20260315T153825: 8 tool calls, engine scope, DRY extraction task, 3 variants
- Run 20260315T152252: 7 tool calls, engine scope, test-fix task, 3 variants
