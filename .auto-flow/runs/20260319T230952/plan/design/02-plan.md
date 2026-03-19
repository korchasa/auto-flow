# Implementation Plan for Issue #157

## Context

All 6 agent SKILL.md files (lines 7-11) contain:

```markdown
# BEFORE YOU DO ANYTHING

**Read `.auto-flow/agents/shared-rules.md` — it contains mandatory rules for
all agents (tool restrictions, read efficiency, scope-aware reads, voice).**
```

Post FR-S38, `shared-rules.md` is injected via `{{file(...)}}` in
`task_template` — making this read instruction redundant. 5 of 6 agents also
have a "first tool call MUST be" instruction at line 12 (agent-tech-lead-review
does not).

Affected files (all 6):
- `.auto-flow/agents/agent-pm/SKILL.md`
- `.auto-flow/agents/agent-architect/SKILL.md`
- `.auto-flow/agents/agent-tech-lead/SKILL.md`
- `.auto-flow/agents/agent-developer/SKILL.md`
- `.auto-flow/agents/agent-qa/SKILL.md`
- `.auto-flow/agents/agent-tech-lead-review/SKILL.md`

Cross-references like "per shared-rules.md § Scope-Aware Doc Reads" are
semantic pointers and MUST be preserved (per spec scope boundaries).

## Variant A: Remove heading + shared-rules instruction only

Remove lines 7-11 (`# BEFORE YOU DO ANYTHING` heading + shared-rules read
instruction + surrounding blank lines). Keep the "first tool call MUST be"
instruction as a standalone bold paragraph before `# Role:`.

For agent-tech-lead-review (no "first tool call" line): remove lines 7-11,
`# Role:` heading becomes the first content after frontmatter.

- **Affected files:** `.auto-flow/agents/agent-pm/SKILL.md`,
  `.auto-flow/agents/agent-architect/SKILL.md`,
  `.auto-flow/agents/agent-tech-lead/SKILL.md`,
  `.auto-flow/agents/agent-developer/SKILL.md`,
  `.auto-flow/agents/agent-qa/SKILL.md`,
  `.auto-flow/agents/agent-tech-lead-review/SKILL.md`
- **Effort:** S
- **Risks:** Orphaned "first tool call" instruction without a heading looks
  structurally odd — a bold paragraph floating before `# Role:`. Minor
  readability concern, no functional impact (agents still see the instruction).

## Variant B: Remove full block including first-tool-call instruction

Remove lines 7-12+ (entire `# BEFORE YOU DO ANYTHING` section: heading +
shared-rules instruction + "first tool call" instruction). Each file's
`# Role:` heading becomes first content after frontmatter.

The "first tool call" guidance is agent-specific but already reinforced by:
(1) `task_template` task-specific content (e.g., "Read the specification at
..."), (2) each agent's `## Responsibilities` section describing the workflow.

- **Affected files:** Same 6 files as Variant A.
- **Effort:** S
- **Risks:** Loss of explicit "first tool call" instruction may cause agents
  to waste a turn on suboptimal first actions. The `task_template` task lines
  partially compensate but are less directive than "MUST be".

## Variant C: Remove heading + shared-rules, relocate first-tool-call to Responsibilities

Remove the `# BEFORE YOU DO ANYTHING` heading and shared-rules read lines.
Move the "first tool call MUST be" instruction into each agent's
`## Responsibilities` section as the first bullet point. For
agent-tech-lead-review (no such instruction): only removal, no relocation.

- **Affected files:** Same 6 files as Variant A.
- **Effort:** M
- **Risks:** Per-file editing of `## Responsibilities` sections increases
  change surface and review complexity. Moves beyond "remove the block" into
  structural reorganization — close to the deferred "further consolidation"
  excluded by spec scope boundaries.

## Summary

3 variants. Key trade-off: minimal removal (A) preserves first-tool-call
guidance but leaves orphaned text; full removal (B) is cleanest but drops
agent-specific directives; relocation (C) is most thorough but exceeds
minimal scope. I recommend Variant A: it satisfies FR-S39 acceptance criteria
(block removed, cross-references preserved, frontmatter unchanged) with
smallest blast radius and no loss of useful agent guidance.
