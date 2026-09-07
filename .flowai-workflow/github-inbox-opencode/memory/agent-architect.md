# Reflection Memory — agent-architect

## Anti-patterns

- Re-reading files already in context (offset/limit on Read, Grep on Read files)
- Spawning Agent subagents for simple Grep/Glob tasks
- Reading out-of-scope SRS/SDS docs (check `scope:` frontmatter first)
- Treating `loadConfig` as the config chokepoint — `parseConfig` is the real one (loadConfig delegates; MCP/tests/embedders bypass loadConfig)
- Assuming "logged to run output" works everywhere: MCP in-process runs default quiet, detached runs have null stdio — scope such ACs to interactive CLI/dry-run surface

## Effective strategies

- Parallel Read of spec + reflection memory as first action
- 3 parallel Explore sub-agents for prior-art / architecture / integration — concrete file:line refs in every variant
- Post progress comment early (batched with sub-agent launch — 1 fewer turn)
- For engine scope: read SRS index + SDS index, then only sections the FR-ID map names (03-config-and-validation + 01-modules-core + 04-data-and-logic covered this task)
- Distinguish same-named concepts: YAML `version: "1"` doc-format gate vs new `schemaVersion` migration pointer — collision check before naming new fields
- Variant discriminator via test seam: injectable registry makes multi-step-chain ACs pure fixtures; private registry forces ugly test-only exports

## Environment quirks

- Write tool may report exit 1 with file fully written — verify with `tail -c` before retrying (duplicate-content risk)
- `.gitignore:3-4`: `.flowai-workflow/*/runs/` and `/*/memory/agent-*.md` gitignored — memory commits need `git add -f`
- `ConfigWarnSink` (config.ts:30-32) is the only config-load output channel; engine wires it to `OutputManager.warn`; `status()` is the prefix-free default-verbosity channel
- `extractWorktreeDisabled` raw-parses YAML BEFORE parseConfig — migrations can't touch `defaults.worktree_disabled`
- Journal `schema_version: 1` is an inline literal (run-journal.ts:116), not a named constant
- config_test.ts convention: inline YAML via `parseConfig(yamlString)`, temp dirs only for file()-reference tests
- Large SRS/SDS files may persist to disk (>2KB preview only) — content still in context

## Baseline metrics

- Run 20260907T032722: ~11 tool calls, engine scope, config migration FR-E101, 3 variants
- Run 20260418T184929: ~8 tool calls, engine scope, budget enforcement FR-E47, 3 variants
- Run 20260320T223114: ~8 tool calls, engine scope, binary distribution FR-E39, 3 variants
- Run 20260319T182156: ~8 tool calls, sdlc scope, artifact renumber task, 3 variants
- Run 20260315T215901: ~9 tool calls, sdlc scope, QA check suite extension, 3 variants
- Run 20260315T213641: 10 tool calls, engine scope, template file() function, 3 variants
