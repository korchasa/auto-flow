# Reflection Memory — agent-architect

## Anti-patterns

- Re-reading files already in context (offset/limit on Read, Grep on Read files)
- Spawning Agent subagents for simple Grep/Glob tasks
- Reading out-of-scope SRS/SDS docs (check `scope:` frontmatter first)

## Effective strategies

- Parallel Read of spec + reflection memory as first action
- Single Grep with glob pattern for cross-file checks
- Extract FR IDs from requirements immediately after Read — no re-Grep
- Post progress comment early (with self-identification prefix per FR-S29)
- When implementation already exists, identify evidence-only variant first
- Read affected source files AND their tests to understand full change surface
- For trivial refactors (DRY extraction), all variants S-effort — differentiate by completeness of deduplication
- Read test files to identify which tests need moving/updating

## Environment quirks

- Large SRS files get persisted to disk (>2KB preview only) — content still in context
- AGENTS.md content mirrors CLAUDE.md structure (same preamble)
- Uncommitted changes in git status can affect merge risk assessment

## Baseline metrics

- Run 20260315T153825: 8 tool calls, engine scope, DRY extraction task, 3 variants
- Run 20260315T152252: 7 tool calls, engine scope, test-fix task, 3 variants
- Run 20260315T144221: ~8 tool calls, sdlc scope, evidence-only task
