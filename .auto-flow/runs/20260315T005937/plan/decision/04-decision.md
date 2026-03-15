---
variant: "Variant A: Standalone sections + template updates (single pass)"
tasks:
  - desc: "Add ## Comment Identification section to all 7 SKILL.md files"
    files:
      - ".auto-flow/agents/agent-pm/SKILL.md"
      - ".auto-flow/agents/agent-architect/SKILL.md"
      - ".auto-flow/agents/agent-tech-lead/SKILL.md"
      - ".auto-flow/agents/agent-developer/SKILL.md"
      - ".auto-flow/agents/agent-qa/SKILL.md"
      - ".auto-flow/agents/agent-tech-lead-review/SKILL.md"
      - ".auto-flow/agents/agent-meta-agent/SKILL.md"
  - desc: "Update existing hardcoded gh issue comment and gh pr review --body strings with agent prefix"
    files:
      - ".auto-flow/agents/agent-pm/SKILL.md"
      - ".auto-flow/agents/agent-architect/SKILL.md"
      - ".auto-flow/agents/agent-tech-lead/SKILL.md"
      - ".auto-flow/agents/agent-developer/SKILL.md"
      - ".auto-flow/agents/agent-qa/SKILL.md"
      - ".auto-flow/agents/agent-tech-lead-review/SKILL.md"
      - ".auto-flow/agents/agent-meta-agent/SKILL.md"
  - desc: "Post-edit verification: grep all SKILL.md files for gh issue comment and gh pr review body strings without prefix"
    files: []
---

## Justification

I selected Variant A for the following reasons:

1. **Simplicity aligns with project vision (AGENTS.md):** The project emphasizes
   "avoid over-engineering" and "keep solutions simple and focused." FR-S29 is
   purely additive prompt text — no code logic, no runtime behavior. A single
   pass over 7 SKILL.md files is the minimum viable approach.

2. **Variant B adds unnecessary indirection:** Defining a "shared template" for
   a 3-line section that varies only by one string (prefix value) is premature
   abstraction. The template is informal (not code), so consistency depends on
   developer discipline regardless — no mechanical advantage over copy-paste
   with substitution.

3. **Variant C is overkill:** A regex-based validation script for SKILL.md
   comment prefixes adds maintenance burden (brittle parsing) for a convention
   that agents self-enforce via prompt instructions. The `deno task check` AC
   in FR-S29 requires only no regressions, not a new validation rule. The effort
   bump from S to M is unjustified.

4. **Risk mitigation is built into the task:** Task 3 (post-edit grep
   verification) catches missed templates without the overhead of a permanent
   validation script.

## Task Descriptions

### Task 1: Add ## Comment Identification section to all 7 SKILL.md files

Insert a `## Comment Identification` section into each agent's SKILL.md.
Location: after `## Voice` section (consistent placement). Each section states
the prefix rule and provides the agent-specific prefix value:

- PM: `**[PM · specify]**`
- Architect: `**[Architect · plan]**`
- Tech Lead: `**[Tech Lead · decide]**`
- Developer: `**[Developer · implement]**`
- QA: `**[QA · verify]**`
- Tech Lead Review: `**[Tech Lead Review · review]**`
- Meta-Agent: `**[Meta-Agent · optimize]**`

Section template (3 lines): rule statement, prefix value, example.

### Task 2: Update existing hardcoded --body strings with agent prefix

Scan each SKILL.md for existing `gh issue comment --body` and `gh pr review
--body` templates/examples. Prepend the agent's prefix to the body string.
Developer has no existing templates — section serves as instruction for future
`gh` calls. Focus on PM, Architect, Tech Lead, QA, Tech Lead Review, and
Meta-Agent which have hardcoded templates.

### Task 3: Post-edit verification

Grep all 7 SKILL.md files for `gh issue comment` and `gh pr review` body
strings. Verify every instance starts with the correct `**[<Agent> · <phase>]**`
prefix. This is a developer verification step, not a permanent script.

## Summary

I selected Variant A (standalone sections + template updates, single pass) for
its minimal complexity — purely additive prompt text requiring no code, no
validation scripts, no template indirection. I defined 3 tasks: (1) add
`## Comment Identification` section to all 7 SKILL.md files, (2) update existing
hardcoded `--body` strings with agent prefixes, (3) post-edit grep verification.
SDS already documents FR-S29 in §3.4 — no SDS update needed. I will create a
draft PR on `sdlc/issue-121`.
