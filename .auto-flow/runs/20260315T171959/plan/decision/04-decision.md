---
variant: "Variant A: Per-Scope Sequential"
tasks:
  - desc: "Add module-level + function-level JSDoc to engine/cli.ts, engine/state.ts, engine/output.ts"
    files: ["engine/cli.ts", "engine/state.ts", "engine/output.ts"]
  - desc: "Add module-level + function-level JSDoc + why-comments to engine/config.ts (validateNode, mergeDefaults)"
    files: ["engine/config.ts"]
  - desc: "Add module-level + function-level JSDoc + why-comments to engine/validate.ts (checkFrontmatterField)"
    files: ["engine/validate.ts"]
  - desc: "Add module-level + function-level JSDoc + why-comments to engine/agent.ts (runAgent)"
    files: ["engine/agent.ts"]
  - desc: "Add module-level JSDoc to SDLC scripts: check.ts, claude_stream_formatter.ts, generate-dashboard.ts, self_runner.ts"
    files: ["scripts/check.ts", "scripts/claude_stream_formatter.ts", "scripts/generate-dashboard.ts", "scripts/self_runner.ts"]
---

## Justification

I selected Variant A (per-scope sequential) for three reasons:

1. **Vision alignment:** AGENTS.md establishes strict scope separation (engine vs SDLC). Variant A processes FR-E30 (engine, 6 files) then FR-S30 (SDLC, 4 files) as distinct units, matching the project's dual-scope architecture. This produces clean, scope-scoped commits.

2. **No audit overhead:** Variant B's pre-pass audit reads each file twice (audit + edit) for marginal accuracy gain. The Architect's analysis already catalogued existing JSDoc coverage per file (e.g., state.ts has 25 blocks, cli.ts has 1). This eliminates the need for a separate audit step.

3. **Full coverage prevents re-work:** Variant C risks QA rejection by skipping function-level JSDoc on exported functions. The spec explicitly requires "module and function level" JSDoc. Variant A satisfies both without over-documenting internal functions.

## Task Descriptions

**Task 1 — Engine JSDoc: cli.ts, state.ts, output.ts**
Add `/** @module */` docstrings (purpose, responsibility, deps) to each file. Add function-level JSDoc on exported functions missing coverage. state.ts already has 25 JSDoc blocks — minimal additions expected (module-level only). cli.ts (1 block) and output.ts (5 blocks) need more function-level JSDoc. No why-comments needed for these files (no complex functions identified in spec).

**Task 2 — Engine JSDoc + why-comments: config.ts**
Add module-level JSDoc. Add function-level JSDoc on exported functions missing coverage (13 blocks exist, but `validateNode()` and `mergeDefaults()` lack why-comments). Add why-comment on `validateNode()` (lines ~125-270): explain recursive validation with dual input-ID namespace (top-level + body) — the recursion with widened ID set is subtle. Add why-comment on `mergeDefaults()` (lines ~325-379): explain 3-tier cascade order (DEFAULT_SETTINGS → pipeline defaults → node settings) and `run_always` → `run_on` legacy normalization reasoning.

**Task 3 — Engine JSDoc + why-comments: validate.ts**
Add module-level JSDoc. Add function-level JSDoc on exported functions (4 blocks exist, most internals undocumented). Add why-comment on `checkFrontmatterField()` (lines ~167-233): explain regex-over-YAML-parser choice for partial-document handling — the artifact may not be valid YAML, so regex extraction of frontmatter block is intentional.

**Task 4 — Engine JSDoc + why-comments: agent.ts**
Add module-level JSDoc. Add function-level JSDoc on exported functions (6 blocks exist). Add why-comment on `runAgent()` (lines ~97-265): explain continuation loop semantics — non-obvious retry/resume with shared session_id, why the session is reused (context preservation across validation failures), and async CLI invocation pattern.

**Task 5 — SDLC script module JSDoc**
Add `/** @module */` docstrings to all 4 SDLC scripts: `scripts/check.ts` (287 LOC, near-zero coverage), `scripts/claude_stream_formatter.ts` (189 LOC, partial), `scripts/generate-dashboard.ts` (490 LOC, good function coverage but missing module docstring), `scripts/self_runner.ts` (168 LOC, minimal). Module-level only per FR-S30 scope — no function-level or why-comments required for SDLC scripts.

## Summary

- I selected Variant A (per-scope sequential) for its scope-aligned systematic approach, no audit overhead, and full FR coverage preventing QA re-work
- I defined 5 tasks: 4 for FR-E30 engine files (3 JSDoc-only + 1 with why-comments each for config.ts, validate.ts, agent.ts) and 1 for FR-S30 SDLC scripts (module-level JSDoc)
- I created branch `sdlc/issue-94` and opened a draft PR
