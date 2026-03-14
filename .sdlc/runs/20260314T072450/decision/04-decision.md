---
variant: "Variant C: Prompts + validation (skip Developer artifact)"
tasks:
  - desc: "Add ## Summary section requirement to 6 agent SKILL.md files (PM, Architect, Tech Lead, QA, Meta-Agent, Tech Lead Review)"
    files:
      - ".claude/skills/agent-pm/SKILL.md"
      - ".claude/skills/agent-architect/SKILL.md"
      - ".claude/skills/agent-tech-lead/SKILL.md"
      - ".claude/skills/agent-qa/SKILL.md"
      - ".claude/skills/agent-meta-agent/SKILL.md"
      - ".claude/skills/agent-tech-lead-review/SKILL.md"
  - desc: "Update Developer SKILL.md to include summary in commit message body (no new artifact file)"
    files:
      - ".claude/skills/agent-developer/SKILL.md"
  - desc: "Add contains_section: Summary validation rules to 6 nodes in pipeline.yaml (specification, design, decision, verify, optimize, tech-lead-review)"
    files:
      - ".sdlc/pipeline.yaml"
---

## Justification

**Selected: Variant C** over A (no enforcement) and B (Developer artifact risk).

1. **Vision alignment:** Project vision demands "fully autonomous, no human
   gates between stages" (AGENTS.md). Validation enforcement via
   `contains_section: Summary` ensures summaries are produced without human
   oversight — the continuation mechanism auto-retries on missing sections,
   maintaining autonomous operation. Variant A's silent failures contradict this.

2. **Developer pragmatism:** Developer agent's output is code commits, not a
   markdown artifact (SDS §4.2). Creating a new `06-dev-summary.md` file
   (Variant B) introduces a non-functional artifact into the implementation
   loop body, risking continuation budget waste on summary formatting instead of
   code quality. The spec itself notes Developer "appends to its output" — its
   output is commits. Summary in commit message body is the natural fit.

3. **Complexity trade-off:** Variant C delivers 6/7 enforced summaries (86%
   coverage) with zero new artifact files and zero new validation dependencies
   in the loop body. The single unenforced agent (Developer) still receives
   prompt instructions. Marginal enforcement gain of Variant B does not justify
   the loop-body complexity and continuation cost risk.

4. **Engine compatibility:** `contains_section` validation already implemented
   in `engine/validate.ts` — no engine changes needed. Pipeline config changes
   are additive (new validation rules only).

## Task Descriptions

### Task 1: Add ## Summary to 6 agent SKILL.md files

Add a `## Summary` output section requirement to the Output section of each
agent's SKILL.md. Content spec: 2-5 bullet points covering actions taken, key
decisions, artifacts produced, issues encountered. Section must appear at the
end of the agent's output artifact. Agents: PM (`01-spec.md`), Architect
(`02-plan.md`), Tech Lead (`04-decision.md`), QA (`05-qa-report.md`),
Meta-Agent (`07-changelog.md`), Tech Lead Review (`08-review.md`).

### Task 2: Update Developer SKILL.md for commit message summary

Add instruction to Developer agent to include a structured summary in each
commit message body. Format: 2-5 line summary block after the commit subject
line. No new artifact file. No pipeline validation rule — summary lives in git
history.

### Task 3: Add contains_section validation to pipeline.yaml

Add `contains_section` validation rule with `value: "Summary"` to the
`validate:` block of 6 nodes: `specification`, `design`, `decision`, `verify`,
`optimize`, `tech-lead-review`. Each rule references the node's existing output
artifact path. Developer (`build` node) excluded — validation stays as-is
(`custom_script: deno task check`).

## Summary

- Selected Variant C: prompt instructions for all 7 agents + pipeline
  validation for 6/7 (Developer excluded from file-based validation).
- 3 atomic tasks ordered by dependency: prompt changes first (agents must know
  what to produce), Developer prompt second (independent but logically grouped),
  pipeline validation last (validates what prompts instruct).
- No engine code changes. No new artifact files. SDS updated to reflect
  FR-40 validation rules and summary requirements.
