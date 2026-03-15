# Reflection Memory — agent-architect

## Anti-patterns

- Re-reading files already in context (offset/limit on Read, Grep on Read files)
- Spawning Agent subagents for simple Grep/Glob tasks
- Reading out-of-scope SRS/SDS docs (check `scope:` frontmatter first)

## Effective strategies

- Parallel Read of spec + reflection memory as first action
- Single Grep with glob pattern across all SKILL.md files to find comment templates
- Extract FR-S IDs from requirements immediately after Read — no re-Grep
- Post progress comment early (with self-identification prefix per FR-S29)

## Environment quirks

- Large SRS files get persisted to disk (>2KB preview only) — content still in context
- Developer SKILL.md has no `gh issue comment`/`gh pr review` templates
- 7 SKILL.md files, ~8 hardcoded comment body strings total across 6 agents

## Baseline metrics

- Run 20260315: ~8 tool calls, spec was SDLC-only scope (simple prompt update task)
- All variants S-effort for prompt-only changes
