## Summary

### Files Changed

- `.auto-flow/agents/agent-architect/SKILL.md` — Added `## Codebase Exploration`
  section defining parallel Agent sub-agent launch pattern (prior art,
  architecture layers, integration points); replaced responsibility #3 with
  "Use exploration findings" to incorporate `file:line` refs from sub-agents;
  added explicit Agent tool allowance per FR-S43.
- `.auto-flow/agents/agent-qa/SKILL.md` — Added `## Confidence Scoring` section
  (0–100 scale; ≥80 verdict-affecting, <80 → Observations); added `## Multi-Focus
  Review` section with 3 parallel sub-agents (correctness/bugs, simplicity/DRY,
  conventions/abstractions); updated responsibility #4 to delegate to sub-agents;
  updated output frontmatter example with optional `high_confidence_issues: <N>`;
  added `## Observations` required section; added explicit Agent tool allowance
  per FR-S44 + FR-S45.

### Tests Added or Modified

None — all 4 tasks are doc-only SKILL.md additions. Per "DO NOT test
constants/templates" rule, no new tests needed.

### deno task check

PASS — 569 tests, 0 failed, all checks passed.
