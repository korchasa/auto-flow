---
variant: "Variant A: Single-pass batch replacement"
tasks:
  - desc: "Replace `.sdlc/` → `.auto-flow/` in engine docs"
    files: ["documents/design-engine.md", "documents/requirements-engine.md"]
  - desc: "Replace `.sdlc/` → `.auto-flow/` in SDLC docs, scripts, and config"
    files: ["documents/requirements-sdlc.md", "scripts/generate-dashboard.ts", "scripts/generate-dashboard_test.ts", ".gitignore", ".gitleaks.toml", ".auto-flow/tasks/fr-18-verbose-output.md"]
  - desc: "Replace `.claude/skills/agent-` → `.auto-flow/agents/agent-` in docs"
    files: ["documents/requirements-engine.md", "documents/requirements-sdlc.md", "documents/design-sdlc.md"]
  - desc: "Replace `.claude/skills/agent-` → `.auto-flow/agents/agent-` in engine test fixtures"
    files: ["engine/config_test.ts", "engine/pipeline_integrity_test.ts", "engine/agent_test.ts", "engine/hitl_test.ts"]
  - desc: "Mark FR-S23 ACs `[x]` and FR-S26 cleanup ACs `[x]`"
    files: ["documents/requirements-sdlc.md"]
  - desc: "Verify: run `deno task test:engine` + `deno task check`"
    files: []
---

## Justification

I selected Variant A (single-pass batch replacement) for three reasons:

1. **Mechanical predictability.** All ~80 replacements follow two deterministic
   rules: `.sdlc/` → `.auto-flow/` and `.claude/skills/agent-` →
   `.auto-flow/agents/agent-`. No logic changes, no ambiguity in target paths.

2. **Atomicity.** A single commit keeps the cleanup reviewable as one diff.
   Variant B's two-phase split adds commit overhead without reducing risk — if a
   test fixture breaks, it's immediately visible in the same CI run. Variant C
   (scripted approach) over-engineers a disposable tool for ~80 replacements
   across ~15 files.

3. **Vision alignment.** Per AGENTS.md, the SDLC pipeline is both development
   method and reference example. Stale path references undermine doc
   trustworthiness and contributor onboarding — the dogfooding value is lost if
   evidence links hit "file not found."

**Key risk mitigation:** Engine test fixtures (`config_test.ts` lines 690-736)
do `Deno.readTextFileSync()` on prompt paths. Replacement must use
`.auto-flow/agents/agent-*/SKILL.md` which exist on disk. Symlinks from
`.claude/skills/agent-*` also resolve, but canonical paths are the goal.
Developer MUST run `deno task test:engine` after fixture changes.

**Context-sensitivity note for design-sdlc.md:** References to
`.claude/skills/agent-*` in §3.4 describe the symlink structure (FR-S26) and
are intentionally correct. Developer should preserve symlink documentation while
replacing any refs that imply `.claude/skills/` as canonical location.

## Task Descriptions

### Task 1: Replace `.sdlc/` → `.auto-flow/` in engine docs

Replace all `.sdlc/` path prefixes in `design-engine.md` (14 refs: mermaid
diagram, Artifact Store, Interfaces, Data, HITL config, Logs) and
`requirements-engine.md` (6 refs). Context check: all are path references
(pipeline config, runs dir, scripts dir) — straight replacement.

### Task 2: Replace `.sdlc/` → `.auto-flow/` in SDLC docs, scripts, config

Replace `.sdlc/` in: `requirements-sdlc.md` (6 refs), `generate-dashboard.ts`
(1 CLI help example), `generate-dashboard_test.ts` (1 test fixture),
`.gitignore` (1 ignore rule), `.gitleaks.toml` (1 allowlist regex),
`.auto-flow/tasks/fr-18-verbose-output.md` (9 task doc refs).

### Task 3: Replace `.claude/skills/agent-` → `.auto-flow/agents/agent-` in docs

Replace stale refs in `requirements-engine.md` (6), `requirements-sdlc.md` (6),
`design-sdlc.md` (4 — evaluate each: preserve symlink descriptions, fix only
refs implying `.claude/skills/` as canonical). All documentation-only, no
runtime impact.

### Task 4: Replace `.claude/skills/agent-` → `.auto-flow/agents/agent-` in engine test fixtures

Replace in `config_test.ts` (5), `pipeline_integrity_test.ts` (4),
`agent_test.ts` (2), `hitl_test.ts` (1). These tests do
`Deno.readTextFileSync()` — replacement path `.auto-flow/agents/agent-*/SKILL.md`
must resolve to real files. Run `deno task test:engine` after changes.

### Task 5: Mark FR-S23 ACs `[x]` and FR-S26 cleanup ACs `[x]`

In `requirements-sdlc.md`: mark 3 FR-S23 ACs `[x]` with evidence from
`design-sdlc.md` §2.1 and §3.2. Mark 2 FR-S26 cleanup ACs `[x]` ("Zero
`.sdlc/` path references" and "Zero `.claude/skills/agent-*` path references")
with evidence from this commit's diff.

### Task 6: Verify

Run `deno task test:engine` (confirms test fixtures resolve correctly) and
`deno task check` (confirms pipeline integrity, linting, gitleaks). Zero
failures expected.

## Summary

I selected Variant A (single-pass batch replacement) for its mechanical
predictability, atomicity, and alignment with the dogfooding vision. I defined
6 tasks: 4 replacement passes (engine docs, SDLC docs/config, doc agent-path
refs, test fixture agent-path refs), 1 AC bookkeeping pass, and 1 verification
step. I created branch `sdlc/issue-119` and opened draft PR #140.
