---
variant: "Variant A: Targeted SKILL.md Patches"
tasks:
  - desc: "Add Codebase Exploration section to Architect SKILL.md (FR-S43)"
    files: [".auto-flow/agents/agent-architect/SKILL.md"]
  - desc: "Add Confidence Scoring section to QA SKILL.md (FR-S44)"
    files: [".auto-flow/agents/agent-qa/SKILL.md"]
  - desc: "Add Multi-Focus Review section and Agent tool allowance to QA SKILL.md (FR-S45)"
    files: [".auto-flow/agents/agent-qa/SKILL.md"]
  - desc: "Add Agent tool allowance to Architect SKILL.md"
    files: [".auto-flow/agents/agent-architect/SKILL.md"]
---

## Justification

I selected Variant A because it aligns with the project vision that "agents
are stateless — all context from file artifacts and system prompts" (AGENTS.md).
Sub-agent invocations are prompt-level instructions within existing agent nodes,
requiring no new pipeline nodes, no shared protocol files, and no engine
changes.

Variant B introduces a shared `subagent-protocol.md` and `pipeline.yaml`
changes for only 2 consumers — premature abstraction per AGENTS.md's principle
of keeping domain workflows in agent prompts, not shared infrastructure.
Variant C rewrites entire SKILL.md files, risking regression in existing
behavior (voice, comment identification, bash whitelist, reflection memory)
with no incremental benefit over additive patches.

The spec explicitly constrains scope to "purely additive prompt-level
improvements." Variant A is the only option with zero files outside the two
target SKILL.md files.

## Task Descriptions

### Task 1: Architect Codebase Exploration (FR-S43)

Add `## Codebase Exploration` section to `agent-architect/SKILL.md` after
responsibility #2 (before "Explore the codebase"). Define parallel Agent
sub-agent launch pattern: 2–3 sub-agents with distinct focus areas (prior art,
architecture layers, integration points). Replace current responsibility #3
with instruction to use exploration findings for concrete file:line references.

### Task 2: QA Confidence Scoring (FR-S44)

Add `## Confidence Scoring` section to `agent-qa/SKILL.md` after
`## Responsibilities`. Define 0–100 scale. Findings ≥ 80 → verdict-affecting.
< 80 → listed in `## Observations` section (non-blocking). Update output
format: add optional `high_confidence_issues: <N>` to frontmatter example.
Add `## Observations` section template.

### Task 3: QA Multi-Focus Review (FR-S45)

Add `## Multi-Focus Review` section to `agent-qa/SKILL.md`. Define 2–3
parallel Agent sub-agents: (1) correctness/bugs, (2) simplicity/DRY,
(3) conventions/abstractions. Update responsibility #4 ("Review changed
files") to delegate to sub-agents. Consolidate findings into per-focus
sections in QA report.

### Task 4: Agent Tool Allowances

Add explicit `Agent` tool override to both SKILL.md files. `shared-rules.md`
line 10–11 says "Agent: FORBIDDEN unless SKILL.md explicitly allows it." Both
architect and QA must add inline Agent tool allowance for sub-agent patterns
to work.

## Summary

I selected Variant A (Targeted SKILL.md Patches) — minimal additive changes
to 2 files (`agent-architect/SKILL.md`, `agent-qa/SKILL.md`). 4 tasks ordered
by dependency: architect exploration first (independent), then QA confidence
scoring (prerequisite for multi-focus), then multi-focus review, then tool
allowances (can be combined with respective tasks). I created branch
`sdlc/issue-178` and opened a draft PR.
