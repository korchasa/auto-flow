---
variant: "Variant A: Remove heading + shared-rules instruction only"
tasks:
  - desc: "Remove BEFORE YOU DO ANYTHING heading and shared-rules read instruction from 5 agent SKILL.md files (agent-pm, agent-architect, agent-tech-lead, agent-developer, agent-qa)"
    files:
      - ".auto-flow/agents/agent-pm/SKILL.md"
      - ".auto-flow/agents/agent-architect/SKILL.md"
      - ".auto-flow/agents/agent-tech-lead/SKILL.md"
      - ".auto-flow/agents/agent-developer/SKILL.md"
      - ".auto-flow/agents/agent-qa/SKILL.md"
  - desc: "Remove BEFORE YOU DO ANYTHING heading and shared-rules read instruction from agent-tech-lead-review SKILL.md (no first-tool-call line to preserve)"
    files:
      - ".auto-flow/agents/agent-tech-lead-review/SKILL.md"
---

## Justification

I selected Variant A because it satisfies all FR-S39 acceptance criteria with
the smallest blast radius:

1. **Removes the redundant block:** The `# BEFORE YOU DO ANYTHING` heading and
   shared-rules read instruction (lines 7-11) are dead code post FR-S38 —
   `shared-rules.md` is now injected via `{{file(...)}}` in `task_template`.
   Variant A removes exactly this redundancy.
2. **Preserves useful guidance:** The "first tool call MUST be" instruction
   (line 12 in 5 of 6 agents) is agent-specific bootstrapping guidance, not
   a shared-rules read instruction. It remains as a standalone bold paragraph
   before `# Role:`. This aligns with AGENTS.md vision: "Agents are stateless —
   all context from file artifacts and system prompts" — explicit first-action
   guidance helps agents bootstrap correctly from their prompt context.
3. **Cross-references preserved:** Semantic pointers like "per shared-rules.md
   § Scope-Aware Doc Reads" are untouched (per spec scope boundaries).
4. **Minimal change surface:** 6 files, identical deletion pattern in each.
   No structural reorganization (unlike Variant C), no loss of useful directives
   (unlike Variant B).

## Task Descriptions

### Task 1: Remove block from 5 agents with first-tool-call line

In each of the 5 SKILL.md files (agent-pm, agent-architect, agent-tech-lead,
agent-developer, agent-qa), remove lines 7-11:
- `# BEFORE YOU DO ANYTHING` heading
- Blank line
- `**Read .auto-flow/agents/shared-rules.md ...** ` bold paragraph
- Surrounding blank lines

The "first tool call MUST be" bold paragraph (line 12) stays, becoming a
standalone paragraph between frontmatter and `# Role:`.

### Task 2: Remove block from agent-tech-lead-review

In `agent-tech-lead-review/SKILL.md`, remove lines 7-11 (same heading +
shared-rules instruction). This agent has no "first tool call" line, so
`# Role:` becomes the first content after frontmatter.

## Summary

I selected Variant A: remove `# BEFORE YOU DO ANYTHING` heading and
shared-rules read instruction from all 6 SKILL.md files. The "first tool call
MUST be" instruction (present in 5 of 6 agents) is preserved as standalone
guidance. 2 tasks, 6 files, effort S. Branch `sdlc/issue-157` created with
draft PR.
