---
variant: "Variant A: Minimal SKILL.md patch (permission + docs only)"
tasks:
  - desc: "Add scripts/check.ts to QA SKILL.md Allowed File Modifications"
    files: [".auto-flow/agents/agent-qa/SKILL.md"]
  - desc: "Add check suite extension responsibility with FR-S31 constraints to QA SKILL.md"
    files: [".auto-flow/agents/agent-qa/SKILL.md"]
  - desc: "Update SDS §3.4 agent-qa bullet with check suite extension capability"
    files: ["documents/design-sdlc.md"]
---

## Justification

I selected Variant A for three reasons:

1. **Vision alignment:** AGENTS.md states agents are stateless with all context
   from file artifacts and system prompts. Adding FR-S31 constraints as prose
   instructions in SKILL.md follows this pattern — no structural scaffolding
   needed. The QA agent already reads `scripts/check.ts` during verification,
   giving it the pattern reference it needs.

2. **Complexity trade-off:** Variant A touches 2 files (SKILL.md + SDS) with
   effort S. Variant B adds scaffold comments that become stale if `check.ts`
   evolves. Variant C (modular directory) is over-engineering — dynamic imports,
   module conventions, and test refactoring for a capability used infrequently.

3. **Risk profile:** The Architect correctly identified that Variant A lacks
   structural guardrails. However, the FR-S31 constraints are specific enough
   (standalone function pattern, label to stdout, `Deno.exit(1)`, run extended
   suite post-addition, zero false positives) that prose instructions provide
   sufficient guidance. The existing `check.ts` architecture already follows
   this pattern — QA has a working reference.

## Task Descriptions

### Task 1: Add `scripts/check.ts` to QA Allowed File Modifications

Add `scripts/check.ts` to the `## Allowed File Modifications` section of
`.auto-flow/agents/agent-qa/SKILL.md`. This grants QA write access to the
check suite file.

### Task 2: Add check suite extension responsibility

Add a new responsibility item to QA SKILL.md (after existing verification
responsibilities) documenting the check suite extension capability. Must
include all FR-S31 constraints inline:
- Evidence-only additions (recurring problem detected, not speculative)
- Standalone `async function checkName(): Promise<void>` pattern
- Label to stdout (`console.log("--- Label ---")`)
- `Deno.exit(1)` on failure
- Run extended suite post-addition to confirm zero false positives
- Wire new check call in `main()` sequence

### Task 3: Update SDS §3.4 agent-qa description

Update the `agent-qa` bullet in `documents/design-sdlc.md` §3.4 to mention
check suite extension capability per FR-S31. Minimal addition — one sentence
referencing the new QA responsibility.

## Summary

I selected Variant A (Minimal SKILL.md patch) for its alignment with the
stateless-agent vision and minimal complexity. I defined 3 ordered tasks:
QA permission grant, responsibility documentation with FR-S31 constraints,
and SDS update. I created branch `sdlc/issue-129` and will open a draft PR.
