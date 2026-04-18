# Agent Architect — Run History

<!-- Append-only. ≤20 entries. Format per reflection-protocol.md §Layer 2. -->

- **20260315T213641** | #128 | ~10 turns | engine scope | 3 variants (A: in-resolve I/O, B: separate post-pass, C: injectable reader) | Recommended A. Key: template.ts `resolve()` extension for `file("path")`, config.ts load-time validation. No anti-patterns triggered.
- **20260315T215901** | #129 | ~9 turns | sdlc scope | 3 variants (A: minimal SKILL.md patch, B: SKILL.md + scaffold comment, C: modular check directory) | Recommended A. Key: QA SKILL.md Allowed File Modifications + new responsibility for check.ts extension. Used Grep for FR section offsets in large SRS — avoided full re-read.
- **20260319T182156** | #147 | ~8 turns | sdlc scope | 3 variants (A: prefix-only renumber, B: node-ID base names, C: semantic rename) | Recommended A. Key: 69 refs across 14 files for 3 filename changes; engine code has zero refs to affected filenames. Used Grep count mode for precise blast-radius per filename.
- **20260320T223114** | #183 | ~8 turns | engine scope | 3 variants (A: single compile script + workflow, B: + smoke test matrix, C: Makefile-based) | Recommended A. Key: `deno compile` for 4 platform targets, new `scripts/compile.ts`, `.github/workflows/release.yml`, README install section. npm:yaml@2 compile compat = main risk.
- **20260418T184929** | #187 | ~8 turns | engine scope | 3 variants (A: inline checks, B: budget.ts module, C: config-time resolution) | Recommended A. Key: FR-E47 budget enforcement — `--budget` CLI flag, per-node `budget.max_usd`/`budget.max_turns`, cascade node→loop→defaults, loop `budget_preempt`. Builds on FR-E17 cost tracking. 3 Explore sub-agents for prior art/architecture/integration.
