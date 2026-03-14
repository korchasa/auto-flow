---
variant: "Variant A: Direct SRS edit only"
tasks:
  - desc: "Mark FR-S1 criteria [x] with evidence + fix FR-S2 regression"
    files: ["documents/requirements-sdlc.md"]
  - desc: "Add FR-S1 evidence status to SDS section 8"
    files: ["documents/design-sdlc.md"]
---

## Justification

I selected Variant A because this is a pure documentation task with zero code
changes. The PM spec provides concrete evidence citations (`engine/cli.ts:36-76`,
`.claude/skills/agent-pm/SKILL.md`) — no verification script (Variant B) is
needed. Variant C's SDS section 8 restructuring risks scope creep; I include
only a minimal traceability note for FR-S1 under issue #100, keeping the
existing #15 convention intact.

Per AGENTS.md: the project follows "fail fast, fail clearly" and avoids
over-engineering. Variant A is the minimal correct change — 4 checkbox flips
with evidence, 1 regression fix, 1 SDS line.

## Task Descriptions

### Task 1: Mark FR-S1 criteria [x] with evidence + fix FR-S2 regression

Update `documents/requirements-sdlc.md`:
- FR-S1 criterion 1: `[ ]` → `[x]`. Evidence: `engine/cli.ts:36-76`,
  `.claude/skills/agent-pm/SKILL.md`.
- FR-S1 criterion 2: `[ ]` → `[x]`. Evidence: `engine/cli.ts:40-42`.
- FR-S1 criterion 3: `[ ]` → `[x]`. Evidence:
  `.claude/skills/agent-pm/SKILL.md` (Output Format section).
- FR-S1 criterion 4: `[ ]` → `[x]`. Evidence: `engine/cli.ts:36-76`
  (`--resume` :43-45, `--dry-run` :47-49, `-v` :50-53, `-q` :58-61,
  `--config` :37-39).
- Fix FR-S2 regression: revert `requirements.md` → `requirements-sdlc.md` on
  line 64.

### Task 2: Add FR-S1 evidence status to SDS section 8

Add a brief paragraph to `documents/design-sdlc.md` section 8 recording that
FR-S1 evidence is complete under issue #100. Keeps traceability without
restructuring the existing #15-scoped entries.

## Summary

I selected Variant A (Direct SRS edit only) for its minimal scope and alignment
with project vision — no over-engineering for a documentation-only change. I
defined 2 tasks: (1) mark 4 FR-S1 criteria with evidence + fix FR-S2
regression in SRS, (2) add FR-S1 traceability note to SDS section 8. I created
branch `sdlc/issue-100` and opened a draft PR.
