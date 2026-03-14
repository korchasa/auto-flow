# Implementation Plan for Issue #13

## Current State

Voice sections (`## Voice`) already exist in all 7 agent SKILL.md files
(committed in `9c7a905`, FR-40). Each section mandates first-person ("I") for
"all narrative output" with 2 correct/incorrect examples.

**Gap:** Hardcoded `gh issue comment --body "..."` templates within the same
SKILL.md files still use passive/third-person constructions, contradicting the
Voice section:

- `agent-pm`: `"Pipeline started — specification phase"` (impersonal)
- `agent-architect`: `"Architect: producing implementation plan"` (third-person label)
- `agent-tech-lead`: `"Tech Lead: selected <variant>, opened draft PR"` (third-person label)

The Voice sections say "all narrative output" but don't explicitly list GitHub
comments/PR descriptions as in-scope, making enforcement ambiguous for agents.

FR-43 is added to SRS (`documents/requirements.md`) but all 3 acceptance
criteria are `[ ]`.

## Variant A: Fix hardcoded templates only

Update the `gh issue comment --body` examples in SKILL.md files to use
first-person voice. No structural changes to Voice sections — rely on existing
"all narrative output" wording to cover GitHub interactions.

Changes:
- `agent-pm/SKILL.md:87` — `"I started the specification phase for this issue"`
- `agent-architect/SKILL.md:80` — `"I am producing the implementation plan"`
- `agent-tech-lead/SKILL.md:74` — `"I selected <variant> and opened a draft PR"`
- Mark FR-43 acceptance criteria with evidence paths

- **Affected files:** `.claude/skills/agent-pm/SKILL.md`, `.claude/skills/agent-architect/SKILL.md`, `.claude/skills/agent-tech-lead/SKILL.md`, `documents/requirements.md`
- **Effort:** S
- **Risks:** Voice sections don't explicitly mention GitHub comments — agents may
  still produce passive GitHub output if they don't connect "all narrative
  output" to `gh issue comment` bodies. Implicit coverage may be insufficient.

## Variant B: Fix templates + strengthen Voice sections

Same template fixes as Variant A, plus: add an explicit sentence to each agent's
`## Voice` section stating that GitHub comments, PR descriptions, and status
updates are in-scope. Add a third correct/incorrect example pair per agent
targeting GitHub interactions specifically.

Changes per SKILL.md:
1. Fix hardcoded `gh issue comment` template strings (same as Variant A)
2. Add to Voice section: "Includes GitHub issue comments, PR descriptions, and
   status updates."
3. Add third example pair, e.g.:
   - PM: Correct: `"I started the specification phase"` / Incorrect: `"Specification phase started"`
   - Architect: Correct: `"I am analyzing 3 variants"` / Incorrect: `"3 variants are being analyzed"`
4. Mark FR-43 acceptance criteria with evidence paths

- **Affected files:** `.claude/skills/agent-pm/SKILL.md`, `.claude/skills/agent-architect/SKILL.md`, `.claude/skills/agent-tech-lead/SKILL.md`, `.claude/skills/agent-developer/SKILL.md`, `.claude/skills/agent-qa/SKILL.md`, `.claude/skills/agent-tech-lead-review/SKILL.md`, `.claude/skills/agent-meta-agent/SKILL.md`, `documents/requirements.md`
- **Effort:** M
- **Risks:** Slightly increases SKILL.md size (1-2 lines per file). Risk is
  minimal — the added clarity eliminates ambiguity about GitHub interaction
  voice requirements.

## Variant C: Centralized Voice reference + per-agent overrides

Create a shared Voice reference section in `CLAUDE.md` or a new
`.claude/skills/shared-voice.md`, then reference it from each SKILL.md with
agent-specific example overrides only.

- **Affected files:** `CLAUDE.md` or new `.claude/skills/shared-voice.md`, all 7 `SKILL.md` files, `documents/requirements.md`
- **Effort:** M
- **Risks:** Adds indirection — agents must resolve a cross-file reference to
  understand voice rules. Claude Code may not reliably follow `## Voice: see
  shared-voice.md` references. Contradicts the existing per-agent tailored
  approach chosen in FR-40 (commit `09a9667`). Higher risk of regression if
  shared file is modified without updating all consumers.

## Summary

3 variants: A (template fix only), B (templates + explicit Voice strengthening),
C (centralized shared Voice). Key trade-off: A is minimal but leaves implicit
coverage gap; B eliminates ambiguity with modest effort; C adds indirection
that conflicts with the FR-40 per-agent tailoring decision.

I recommend Variant B: it directly addresses the spec's requirement that all
GitHub interactions use first-person, makes the Voice section unambiguous for
each agent, and stays consistent with the per-agent tailored approach from FR-40.
