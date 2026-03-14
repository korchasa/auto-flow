---
variant: "Variant B: Per-agent tailored Voice section"
tasks:
  - desc: "Add tailored ## Voice section to agent-pm SKILL.md"
    files: [".claude/skills/agent-pm/SKILL.md"]
  - desc: "Add tailored ## Voice section to agent-architect SKILL.md"
    files: [".claude/skills/agent-architect/SKILL.md"]
  - desc: "Add tailored ## Voice section to agent-tech-lead SKILL.md"
    files: [".claude/skills/agent-tech-lead/SKILL.md"]
  - desc: "Add tailored ## Voice section to agent-developer SKILL.md"
    files: [".claude/skills/agent-developer/SKILL.md"]
  - desc: "Add tailored ## Voice section to agent-qa SKILL.md"
    files: [".claude/skills/agent-qa/SKILL.md"]
  - desc: "Add tailored ## Voice section to agent-tech-lead-review SKILL.md"
    files: [".claude/skills/agent-tech-lead-review/SKILL.md"]
  - desc: "Add tailored ## Voice section to agent-meta-agent SKILL.md"
    files: [".claude/skills/agent-meta-agent/SKILL.md"]
---

## Justification

**Selected: Variant B** — per-agent tailored `## Voice` section with core
mandate + 2-3 role-specific correct/incorrect examples.

**Why not A:** Uniform 3-line directive lacks concrete examples. LLM agents
respond better to demonstrations than abstract rules. Generic directive risks
being ignored — agents have no anchor to distinguish correct from incorrect
phrasing in their specific output domain (specs vs verdicts vs changelogs).

**Why not C:** Rewriting existing prompt prose ("You are the X agent" → "I am
the X agent") conflicts with established LLM prompting patterns. Second-person
role assignment is a well-documented technique for role adherence. Changing it
risks degrading agent behavior for marginal voice consistency. Also exceeds
spec scope — FR-40 spec says "add a Voice section," not "rewrite all prose."
Higher diff surface increases review burden without proportional benefit.

**Why B fits:** Provides the mandate (first-person, no passive) with concrete
role-specific examples that anchor each agent's voice in its actual output
types. Low risk — prompt-only, no code changes, no behavioral side effects
from second-person role preambles. Aligns with AGENTS.md vision of
"specialized AI agents each performing a distinct role" — tailored examples
reinforce role specialization. Effort remains S (each file gets ~8-12 lines).

## Task Descriptions

All 7 tasks are independent (no ordering dependency). Each adds a `## Voice`
section after the `# Role:` heading and intro paragraph, before
`## Responsibilities`. Section contains:

1. Core mandate: use first-person ("I"), prohibit passive/third-person in
   narrative output, exclude YAML frontmatter and code blocks.
2. 2-3 correct vs incorrect examples specific to the agent's typical outputs.

Per-agent examples:

- **agent-pm:** "I selected issue #42 as highest priority" vs "Issue #42 was
  selected." "I triaged 5 open issues" vs "5 issues were triaged."
- **agent-architect:** "I identified 3 implementation variants" vs "3 variants
  were identified." "I assessed the risk as low" vs "The risk was assessed."
- **agent-tech-lead:** "I selected Variant B for its lower complexity" vs
  "Variant B was selected." "I created branch sdlc/issue-13" vs "Branch was
  created."
- **agent-developer:** "I implemented the handler function" vs "The handler
  was implemented." "I added tests for edge cases" vs "Tests were added."
- **agent-qa:** "I verified all acceptance criteria pass" vs "All criteria
  were verified." "I found 2 failing tests" vs "2 tests were found failing."
- **agent-tech-lead-review:** "I approved the PR after CI passed" vs "The PR
  was approved." "I merged the branch to main" vs "The branch was merged."
- **agent-meta-agent:** "I diagnosed the root cause as prompt ambiguity" vs
  "The root cause was diagnosed." "I applied 2 prompt fixes" vs "2 fixes were
  applied."
