---
variant: "Variant A: Prefix-only renumber (keep base names)"
tasks:
  - desc: "Rename artifact filenames in pipeline.yaml"
    files: [".auto-flow/pipeline.yaml"]
  - desc: "Update artifact refs in agent SKILL.md prompts"
    files:
      - ".auto-flow/agents/agent-tech-lead/SKILL.md"
      - ".auto-flow/agents/agent-developer/SKILL.md"
      - ".auto-flow/agents/agent-qa/SKILL.md"
      - ".auto-flow/agents/agent-tech-lead-review/SKILL.md"
      - ".auto-flow/agents/agent-pm/SKILL.md"
      - ".auto-flow/agents/agent-architect/SKILL.md"
  - desc: "Update artifact refs in SRS (requirements-sdlc.md)"
    files: ["documents/requirements-sdlc.md"]
  - desc: "Update artifact refs in SDS (design-sdlc.md)"
    files: ["documents/design-sdlc.md"]
  - desc: "Update artifact refs in other docs (README, memory, rnd)"
    files:
      - "README.md"
      - "documents/requirements-engine.md"
      - "documents/rnd/pipeline-report.md"
      - ".auto-flow/memory/agent-tech-lead-review.md"
  - desc: "Grep-sweep to verify zero remaining old refs"
    files: []
---

## Justification

I selected **Variant A** (prefix-only renumber) for the following reasons:

1. **Smallest blast radius.** ~69 occurrences across 14 files vs ~170+ for
   Variant B. Fewer changes = fewer regression opportunities.

2. **No cross-scope contamination.** Variant B touches engine test fixtures
   (`engine/config_test.ts`, `engine/output_test.ts`, etc.) — violating the
   project vision's strict scope separation: "Engine is domain-agnostic...
   MUST NOT depend on any specific pipeline config" (AGENTS.md). Variant A
   stays entirely within `sdlc` scope.

3. **Preserves established semantics.** Base names `spec`, `plan`,
   `qa-report`, `impl-summary`, `review` carry clear meaning. Variant B's
   node-ID alignment breaks immediately for `tech-lead-review` (too long) and
   loses descriptiveness (`verify` < `qa-report`). Variant C introduces
   ambiguous `changelog` name.

4. **Directly satisfies FR-S32.** The requirement specifies gapless sequential
   prefixes reflecting execution order — nothing about base-name
   standardization. Variant A is the minimal, complete solution.

## Task Descriptions

### Task 1: Rename artifact filenames in pipeline.yaml

Update all `04-decision`, `06-impl-summary`, and `08-review` references in
`.auto-flow/pipeline.yaml` to `03-decision`, `04-impl-summary`, and
`06-review` respectively. This includes `output:`, `validation:`, and any
`task_template:` references. ~15 occurrences.

### Task 2: Update artifact refs in agent SKILL.md prompts

Find-and-replace across all 6 agent SKILL.md files. Primary targets:
- `04-decision.md` → `03-decision.md` (tech-lead, developer, qa, architect)
- `06-impl-summary.md` → `04-impl-summary.md` (developer, tech-lead-review)
- `08-review.md` → `06-review.md` (tech-lead-review)

### Task 3: Update artifact refs in SRS

Update `documents/requirements-sdlc.md`: FR-S5, FR-S11, FR-S25 (Appendix A),
FR-S32, and Appendix C cross-reference table. ~19 occurrences.

### Task 4: Update artifact refs in SDS

Update `documents/design-sdlc.md`: §2.2 Artifact Store naming convention
(already updated by tech-lead decision), any remaining refs in §3.4, §4.1, §5.

### Task 5: Update artifact refs in other docs

Update scattered refs in README.md (2), requirements-engine.md (2 — example
refs to `05-qa-report` which is unchanged, but verify), pipeline-report.md (1),
and agent-tech-lead-review memory file (2).

### Task 6: Grep-sweep verification

Run `grep -r` for all old filenames (`04-decision`, `06-impl-summary`,
`08-review`) across the repository. Zero matches expected. Any remaining
references indicate missed updates.

## Summary

I selected Variant A (prefix-only renumber) — the minimal solution that closes
numbering gaps and fixes the 05/06 ordering inversion with smallest blast
radius (~69 refs, 14 files). 3 filenames change (`04→03`, `06→04`, `08→06`);
3 stay unchanged. 6 tasks ordered by dependency: pipeline config first (source
of truth), then prompts, then docs, then verification sweep. Branch
`sdlc/issue-147` created with draft PR.
