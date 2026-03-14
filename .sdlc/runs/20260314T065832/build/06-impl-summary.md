## Summary

Files changed:
- `.claude/skills/agent-pm/SKILL.md` — added `## Summary` output section requirement
- `.claude/skills/agent-architect/SKILL.md` — added `## Summary` required final section + example
- `.claude/skills/agent-tech-lead/SKILL.md` — added item 3 (Summary) to Body section
- `.claude/skills/agent-developer/SKILL.md` — added `06-impl-summary.md` artifact to Output section
- `.claude/skills/agent-qa/SKILL.md` — added Summary to required sections list and example
- `.claude/skills/agent-tech-lead-review/SKILL.md` — added `## Summary` to output format template
- `.claude/skills/agent-meta-agent/SKILL.md` — added `## Summary` to both changelog templates
- `.sdlc/pipeline.yaml` — added `contains_section: Summary` validation to all 7 artifact-producing nodes; added `06-impl-summary.md` file_exists + contains_section validation to `build` node; updated build task_template to instruct Developer to write `06-impl-summary.md`

Tests added or modified: none (prompt-only changes, no source code modified)

`deno task check` result: PASS — 490 passed, 0 failed
