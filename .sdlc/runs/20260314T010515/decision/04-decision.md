---
variant: "Variant A: Minimal — SRS update + directory cleanup"
tasks:
  - desc: "Mark FR-37 acceptance criteria as [x] with commit evidence in SRS"
    files: ["documents/requirements.md"]
  - desc: "Mark FR-26, FR-36, FR-19 pending criteria resolved by rename as [x]"
    files: ["documents/requirements.md"]
  - desc: "Replace stale 'executor' text in agent-role contexts within SRS"
    files: ["documents/requirements.md"]
  - desc: "Delete legacy .claude/skills/agent-executor/ directory"
    files: [".claude/skills/agent-executor/SKILL.md"]
---

## Justification

**Variant A** selected over B and C for these reasons:

1. **SDS already clean.** Architect confirmed `documents/design.md` contains
   zero agent-role `executor` references. All occurrences ("DAG executor",
   "pipeline executor", "DAG-based executor") are domain-agnostic engine
   terminology per FR-29 (engine is domain-agnostic). Variant B's SDS review
   pass would produce zero changes — wasted effort.

2. **Variant C risks semantic errors.** `engine/dag.ts:9` comment "loop
   executor" refers to the engine's execution role, not the agent. Renaming
   would be semantically wrong. `deno.json` and `README.md` refs are
   contextual/historical. Per AGENTS.md vision ("engine is domain-agnostic"),
   engine terminology must remain independent of agent naming.

3. **Minimal scope = minimal risk.** The rename implementation is complete
   (commit `f0085df`). Remaining work is purely documentary: update SRS
   acceptance criteria with evidence, clean stale text, delete orphaned
   directory. Variant A covers exactly this scope with effort S.

4. **Vision alignment.** AGENTS.md states engine must not contain domain-
   specific logic. Keeping "executor" in engine context (Variant A's approach)
   respects this boundary. Variants B/C blur the line between agent-role naming
   and engine-internal terminology.

## Task Descriptions

### Task 1: Mark FR-37 acceptance criteria as [x]

Update all 7 `[ ]` criteria in FR-37 section of `documents/requirements.md` to
`[x]` with evidence referencing commit `f0085df`. Each criterion covers a
specific rename artifact (pipeline.yaml, SKILL.md, stage scripts, etc.).

### Task 2: Mark FR-26, FR-36, FR-19 pending criteria

Three FRs have pending criteria tagged `(FR-37)` or related to the rename:
- FR-26: 3 criteria (agent-developer/SKILL.md exists, pipeline happy path,
  Developer commits)
- FR-36: 2 criteria (agent-developer frontmatter compliance, requirements.md
  path refs)
- FR-19: 1 criterion (7 canonical skill directories)

Mark each `[x]` with commit evidence.

### Task 3: Replace stale 'executor' text in SRS agent-role contexts

Find and replace remaining `executor` references in SRS that refer to the agent
role (not engine). Targets: FR-7 legacy script name, FR-8 stage label, FR-10
loop body node names, FR-14 commit ownership, FR-24 YAML example node IDs,
FR-26 role description, Section 6 AC #4, Appendix A table row.

### Task 4: Delete legacy agent-executor directory

Remove `.claude/skills/agent-executor/` (contains stale SKILL.md copy kept as
safety during rename). Safe to delete: `pipeline.yaml` already points to
`agent-developer`, engine reads paths from config at runtime.
